// =====================================================
//  ZIVORA - Servidor (Node + Express + MySQL)
//  Uso:  npm install  ->  npm start  ->  http://localhost:3000
// =====================================================
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

// Carga simple del archivo .env (si existe)
try {
    fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/).forEach((l) => {
        const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    })
} catch (e) { /* sin .env: se usan los valores por defecto */ }

const express = require("express")
const mysql = require("mysql2/promise")

const PUERTO = process.env.PORT || 3000
const DOMICILIO = 3000
const ESTADOS = ["Confirmado", "Preparando", "En camino", "Entregado"]
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ""
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "zivora",
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",
    // bases en la nube (Railway, Aiven, etc.) suelen exigir SSL: DB_SSL=true
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
})

const app = express()
app.use(express.json())

/* ---------- utilidades ---------- */
const ruta = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((e) => {
        console.error(e)
        res.status(500).json({ error: "Error del servidor" })
    })
const fallo = (res, codigo, mensaje) => res.status(codigo).json({ error: mensaje })

const intentos = new Map()
const limitar = (max, ventanaMs) => (req, res, next) => {
    const k = req.ip + req.baseUrl
    const ahora = Date.now()
    const r = intentos.get(k) || { n: 0, desde: ahora }
    if (ahora - r.desde > ventanaMs) { r.n = 0; r.desde = ahora }
    r.n++
    intentos.set(k, r)
    if (r.n > max) return fallo(res, 429, "Demasiados intentos. Espera unos minutos")
    next()
}
app.use("/api/login", limitar(10, 15 * 60 * 1000))
app.use("/api/recuperar", limitar(10, 15 * 60 * 1000))
app.use("/api/registro", limitar(10, 15 * 60 * 1000))

/* ---------- correo (códigos de verificación) ---------- */
let nodemailer = null
try { nodemailer = require("nodemailer") } catch (e) { /* sin nodemailer: modo de prueba */ }
const transporte = nodemailer && process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
    : null

async function enviarCorreo(para, asunto, texto) {
    if (!transporte) {
        // Modo de prueba: el código solo se imprime en la terminal. En producción es obligatorio configurar SMTP.
        if (process.env.NODE_ENV === "production") throw new Error("SMTP no configurado")
        console.log("\n[CORREO DE PRUEBA] Para: " + para + "\n" + asunto + "\n" + texto + "\n")
        return
    }
    await transporte.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: para, subject: asunto, text: texto })
}

const ahoraTexto = () => new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "full", timeStyle: "short" })

// Envía un aviso por correo sin esperar y sin romper nada si falla
function avisar(para, asunto, texto) {
    enviarCorreo(para, asunto, texto).catch((e) => console.error("No se pudo enviar el aviso a " + para + ": " + e.message))
}
const textoBienvenida = (nombre) =>
    "Hola " + nombre + ",\n\n¡Bienvenido a ZIVORA! Tu cuenta quedó creada y ya puedes pedir tus antojos.\n\nConectamos tus antojos con tu hogar. 🛵"
const textoInicio = (nombre) =>
    "Hola " + nombre + ",\n\nIniciaste sesión en ZIVORA el " + ahoraTexto() + " (hora de Colombia).\n\n" +
    "Si fuiste tú, no tienes que hacer nada. Si no fuiste tú, cambia tu contraseña desde \"¿Olvidaste tu contraseña?\"."

const hashCodigo = (codigo, correo) => crypto.createHash("sha256").update(codigo + ":" + correo).digest("hex")

// Genera un código de 6 dígitos para el correo y lo envía. Devuelve un mensaje de error o null.
async function enviarCodigo(correo, tipo, datos) {
    const [prev] = await pool.query(
        "SELECT id FROM verificaciones WHERE correo = ? AND tipo = ? AND creado > NOW() - INTERVAL 60 SECOND", [correo, tipo])
    if (prev.length) return "Espera un minuto antes de pedir otro código"
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, "0")
    await pool.query(
        `INSERT INTO verificaciones (correo, tipo, codigo, datos, intentos, expira, creado)
         VALUES (?, ?, ?, ?, 0, NOW() + INTERVAL 10 MINUTE, NOW())
         ON DUPLICATE KEY UPDATE codigo = VALUES(codigo), datos = VALUES(datos), intentos = 0,
                                 expira = VALUES(expira), creado = VALUES(creado)`,
        [correo, tipo, hashCodigo(codigo, correo), datos ? JSON.stringify(datos) : null])
    await enviarCorreo(correo, "Tu código de verificación de ZIVORA",
        "Tu código es: " + codigo + "\n\nVence en 10 minutos. Si no lo pediste tú, ignora este mensaje.")
    return null
}

// Revisa el código. Devuelve { fila } si es correcto o { error }.
async function revisarCodigo(correo, tipo, codigo) {
    const [filas] = await pool.query(
        "SELECT * FROM verificaciones WHERE correo = ? AND tipo = ? AND expira > NOW()", [correo, tipo])
    const v = filas[0]
    if (!v) return { error: "El código venció o no existe. Pide uno nuevo" }
    if (v.intentos >= 5) return { error: "Demasiados intentos. Pide un código nuevo" }
    if (v.codigo !== hashCodigo(String(codigo || "").trim(), correo)) {
        await pool.query("UPDATE verificaciones SET intentos = intentos + 1 WHERE id = ?", [v.id])
        return { error: "Código incorrecto" }
    }
    await pool.query("DELETE FROM verificaciones WHERE id = ?", [v.id])
    return { fila: v }
}

function hashPass(p) {
    const salt = crypto.randomBytes(16).toString("hex")
    return salt + ":" + crypto.scryptSync(p, salt, 64).toString("hex")
}
function checkPass(p, guardada) {
    const [salt, clave] = String(guardada).split(":")
    if (!salt || !clave) return false
    const k = crypto.scryptSync(p, salt, 64)
    const g = Buffer.from(clave, "hex")
    return k.length === g.length && crypto.timingSafeEqual(k, g)
}
async function crearSesion(usuarioId) {
    const token = crypto.randomBytes(32).toString("hex")
    await pool.query("INSERT INTO sesiones (token, usuario_id) VALUES (?, ?)", [token, usuarioId])
    return token
}

const autenticar = ruta(async (req, res, next) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "")
    if (!token) return fallo(res, 401, "Sesión no iniciada")
    const [filas] = await pool.query(
        `SELECT u.id, u.nombre, u.correo, u.telefono, u.rol
           FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.token = ? AND s.creado > NOW() - INTERVAL 30 DAY`, [token])
    if (!filas.length) return fallo(res, 401, "Sesión expirada")
    req.usuario = filas[0]
    next()
})
const soloAdmin = (req, res, next) =>
    req.usuario.rol === "admin" ? next() : fallo(res, 403, "Solo administradores")

/* ---------- cuenta ---------- */
// Paso 1: valida los datos y envía un código al correo (la cuenta todavía no se crea)
app.post("/api/registro/codigo", ruta(async (req, res) => {
    const { nombre, correo, telefono, contrasena } = req.body || {}
    if (!nombre || !correo || !telefono || !contrasena) return fallo(res, 400, "Completa todos los campos")
    const mail = String(correo).trim().toLowerCase()
    if (!EMAIL_OK.test(mail)) return fallo(res, 400, "Escribe un correo válido")
    if (String(contrasena).length < 6) return fallo(res, 400, "La contraseña debe tener mínimo 6 caracteres")
    const [existe] = await pool.query("SELECT id FROM usuarios WHERE correo = ?", [mail])
    if (existe.length) return fallo(res, 409, "Ya existe una cuenta con ese correo")
    let error
    try {
        error = await enviarCodigo(mail, "registro", {
            nombre: String(nombre).trim(), telefono: String(telefono).trim(), contrasena: hashPass(String(contrasena))
        })
    } catch (e) {
        console.error(e)
        return fallo(res, 500, "No se pudo enviar el correo. Revisa que esté bien escrito")
    }
    if (error) return fallo(res, 429, error)
    res.json({})
}))

// Paso 2: con el código correcto se crea la cuenta y se inicia sesión
app.post("/api/registro", ruta(async (req, res) => {
    const mail = String((req.body && req.body.correo) || "").trim().toLowerCase()
    const r = await revisarCodigo(mail, "registro", req.body && req.body.codigo)
    if (r.error) return fallo(res, 400, r.error)
    const d = JSON.parse(r.fila.datos)
    const [existe] = await pool.query("SELECT id FROM usuarios WHERE correo = ?", [mail])
    if (existe.length) return fallo(res, 409, "Ya existe una cuenta con ese correo")
    const [ins] = await pool.query(
        "INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol) VALUES (?, ?, ?, ?, 'cliente')",
        [d.nombre, mail, d.telefono, d.contrasena])
    avisar(mail, "¡Bienvenido a ZIVORA!", textoBienvenida(d.nombre))
    res.json({
        token: await crearSesion(ins.insertId),
        usuario: { id: ins.insertId, nombre: d.nombre, correo: mail, telefono: d.telefono, rol: "cliente" }
    })
}))

app.post("/api/login", ruta(async (req, res) => {
    const { usuario: ident, contrasena } = req.body || {}
    if (!ident || !contrasena) return fallo(res, 400, "Escribe tu correo y contraseña")
    const texto = String(ident).trim()
    const [filas] = texto.includes("@")
        ? await pool.query("SELECT * FROM usuarios WHERE correo = ?", [texto.toLowerCase()])
        : await pool.query("SELECT * FROM usuarios WHERE REGEXP_REPLACE(telefono, '[^0-9]', '') = ?", [texto.replace(/\D/g, "")])
    const u = filas[0]
    if (!u || !checkPass(String(contrasena), u.contrasena)) return fallo(res, 401, "Correo o contraseña incorrecta")
    avisar(u.correo, "Nuevo inicio de sesión en ZIVORA", textoInicio(u.nombre))
    res.json({
        token: await crearSesion(u.id),
        usuario: { id: u.id, nombre: u.nombre, correo: u.correo, telefono: u.telefono, rol: u.rol }
    })
}))

app.post("/api/logout", autenticar, ruta(async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "")
    await pool.query("DELETE FROM sesiones WHERE token = ?", [token])
    res.json({})
}))

app.post("/api/recuperar/codigo", ruta(async (req, res) => {
    const mail = String((req.body && req.body.correo) || "").trim().toLowerCase()
    if (!EMAIL_OK.test(mail)) return fallo(res, 400, "Escribe un correo válido")
    const [u] = await pool.query("SELECT id FROM usuarios WHERE correo = ?", [mail])
    if (u.length) {
        try {
            const error = await enviarCodigo(mail, "recuperar", null)
            if (error) return fallo(res, 429, error)
        } catch (e) {
            console.error(e)
            return fallo(res, 500, "No se pudo enviar el correo")
        }
    }
    res.json({}) // misma respuesta exista o no la cuenta
}))

app.post("/api/recuperar", ruta(async (req, res) => {
    const { correo, codigo, contrasena } = req.body || {}
    const mail = String(correo || "").trim().toLowerCase()
    if (String(contrasena || "").length < 6) return fallo(res, 400, "La contraseña debe tener mínimo 6 caracteres")
    const r = await revisarCodigo(mail, "recuperar", codigo)
    if (r.error) return fallo(res, 400, r.error)
    await pool.query("UPDATE usuarios SET contrasena = ? WHERE correo = ?", [hashPass(String(contrasena)), mail])
    await pool.query("DELETE s FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE u.correo = ?", [mail])
    res.json({})
}))

/* ---------- Google ---------- */
app.get("/api/config", (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }))

app.post("/api/google", ruta(async (req, res) => {
    if (!GOOGLE_CLIENT_ID) return fallo(res, 503, "El inicio con Google no está configurado")
    const credential = req.body && req.body.credential
    if (!credential) return fallo(res, 400, "Falta la credencial de Google")
    let info
    try {
        const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential))
        info = await r.json()
        if (!r.ok) throw new Error(info.error_description || "token inválido")
    } catch (e) {
        return fallo(res, 401, "No se pudo verificar tu cuenta de Google")
    }
    if (info.aud !== GOOGLE_CLIENT_ID || String(info.email_verified) !== "true" || !info.email)
        return fallo(res, 401, "Cuenta de Google no válida")
    const mail = String(info.email).toLowerCase()
    const [filas] = await pool.query("SELECT * FROM usuarios WHERE correo = ?", [mail])
    let u = filas[0]
    const esNuevo = !u
    if (!u) {
        const [ins] = await pool.query(
            "INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol) VALUES (?, ?, '', ?, 'cliente')",
            [String(info.name || mail.split("@")[0]).slice(0, 100), mail, hashPass(crypto.randomBytes(24).toString("hex"))])
        const [nuevo] = await pool.query("SELECT * FROM usuarios WHERE id = ?", [ins.insertId])
        u = nuevo[0]
    }
    avisar(u.correo, esNuevo ? "¡Bienvenido a ZIVORA!" : "Nuevo inicio de sesión en ZIVORA",
        esNuevo ? textoBienvenida(u.nombre) : textoInicio(u.nombre))
    res.json({
        token: await crearSesion(u.id),
        usuario: { id: u.id, nombre: u.nombre, correo: u.correo, telefono: u.telefono, rol: u.rol }
    })
}))

/* ---------- perfil ---------- */
app.put("/api/perfil", autenticar, ruta(async (req, res) => {
    const nombre = String((req.body && req.body.nombre) || "").trim().slice(0, 100)
    const telefono = String((req.body && req.body.telefono) || "").trim().slice(0, 30)
    const nueva = String((req.body && req.body.nuevaClave) || "")
    if (!nombre) return fallo(res, 400, "Escribe tu nombre")
    if (nueva && nueva.length < 6) return fallo(res, 400, "La contraseña debe tener mínimo 6 caracteres")
    await pool.query("UPDATE usuarios SET nombre = ?, telefono = ? WHERE id = ?", [nombre, telefono, req.usuario.id])
    if (nueva) {
        await pool.query("UPDATE usuarios SET contrasena = ? WHERE id = ?", [hashPass(nueva), req.usuario.id])
        // cierra las demás sesiones de esta cuenta; se mantiene la actual
        const token = (req.headers.authorization || "").replace("Bearer ", "")
        await pool.query("DELETE FROM sesiones WHERE usuario_id = ? AND token <> ?", [req.usuario.id, token])
    }
    res.json({ usuario: { ...req.usuario, nombre, telefono } })
}))

/* ---------- productos ---------- */
app.get("/api/categorias", autenticar, ruta(async (req, res) => {
    const [filas] = await pool.query("SELECT nombre FROM categorias WHERE activa = 1 ORDER BY id")
    res.json({ categorias: filas.map((f) => f.nombre) })
}))

app.get("/api/productos", autenticar, ruta(async (req, res) => {
    const [productos] = await pool.query(
        "SELECT id, nombre, precio, categoria, emoji, imagen FROM productos WHERE activo = 1 ORDER BY id")
    res.json({ productos })
}))

/* ---------- carrito ---------- */
async function resumenCarrito(uid) {
    const [filas] = await pool.query(
        `SELECT c.cantidad, p.id, p.nombre, p.precio, p.emoji, p.imagen
           FROM carrito c JOIN productos p ON p.id = c.producto_id
          WHERE c.usuario_id = ? AND p.activo = 1 ORDER BY c.producto_id`, [uid])
    const items = filas.map((f) => ({
        cantidad: f.cantidad,
        producto: { id: f.id, nombre: f.nombre, precio: f.precio, emoji: f.emoji, imagen: f.imagen }
    }))
    const subtotal = items.reduce((s, i) => s + i.cantidad * i.producto.precio, 0)
    const domicilio = items.length ? DOMICILIO : 0
    return { items, subtotal, domicilio, total: subtotal + domicilio, cantidad: items.reduce((s, i) => s + i.cantidad, 0) }
}

app.get("/api/carrito", autenticar, ruta(async (req, res) => res.json(await resumenCarrito(req.usuario.id))))

app.post("/api/carrito", autenticar, ruta(async (req, res) => {
    const id = Number(req.body && req.body.productoId)
    const [p] = await pool.query("SELECT id FROM productos WHERE id = ? AND activo = 1", [id])
    if (!p.length) return fallo(res, 404, "Producto no disponible")
    await pool.query(
        `INSERT INTO carrito (usuario_id, producto_id, cantidad) VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE cantidad = cantidad + 1`, [req.usuario.id, id])
    res.json(await resumenCarrito(req.usuario.id))
}))

app.patch("/api/carrito/:id", autenticar, ruta(async (req, res) => {
    const delta = Number(req.body && req.body.delta)
    if (delta !== 1 && delta !== -1) return fallo(res, 400, "Cambio inválido")
    await pool.query("UPDATE carrito SET cantidad = cantidad + ? WHERE usuario_id = ? AND producto_id = ?",
        [delta, req.usuario.id, Number(req.params.id)])
    await pool.query("DELETE FROM carrito WHERE usuario_id = ? AND cantidad <= 0", [req.usuario.id])
    res.json(await resumenCarrito(req.usuario.id))
}))

app.delete("/api/carrito/:id", autenticar, ruta(async (req, res) => {
    await pool.query("DELETE FROM carrito WHERE usuario_id = ? AND producto_id = ?", [req.usuario.id, Number(req.params.id)])
    res.json(await resumenCarrito(req.usuario.id))
}))

/* ---------- pedidos ---------- */
async function cargarPedidos(where, params) {
    const [peds] = await pool.query(
        `SELECT p.*, u.nombre AS u_nombre, u.correo AS u_correo, u.telefono AS u_telefono
           FROM pedidos p JOIN usuarios u ON u.id = p.usuario_id
          ${where} ORDER BY p.creado DESC, p.id DESC`, params)
    if (!peds.length) return []
    const ids = peds.map((p) => p.id)
    const [items] = await pool.query(
        "SELECT pedido_id, nombre, precio, cantidad FROM pedido_items WHERE pedido_id IN (?) ORDER BY id", [ids])
    const [hist] = await pool.query(
        "SELECT pedido_id, estado, fecha FROM pedido_historial WHERE pedido_id IN (?) ORDER BY id", [ids])
    return peds.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        usuarioId: p.usuario_id,
        estado: p.estado,
        subtotal: p.subtotal,
        domicilio: p.domicilio,
        total: p.total,
        entrega: { nombre: p.entrega_nombre, direccion: p.entrega_direccion, telefono: p.entrega_telefono },
        metodoPago: p.metodo_pago,
        creado: p.creado,
        usuario: { nombre: p.u_nombre, correo: p.u_correo, telefono: p.u_telefono },
        items: items.filter((i) => i.pedido_id === p.id).map((i) => ({ nombre: i.nombre, precio: i.precio, cantidad: i.cantidad })),
        historial: hist.filter((h) => h.pedido_id === p.id).map((h) => ({ estado: h.estado, fecha: h.fecha }))
    }))
}

app.post("/api/pedidos", autenticar, ruta(async (req, res) => {
    const { entrega, metodo } = req.body || {}
    if (!entrega || !entrega.nombre || !entrega.direccion || !entrega.telefono) return fallo(res, 400, "Completa los datos de entrega")
    if (!metodo) return fallo(res, 400, "Elige un método de pago")
    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()
        const [filas] = await conn.query(
            `SELECT c.cantidad, p.id, p.nombre, p.precio
               FROM carrito c JOIN productos p ON p.id = c.producto_id
              WHERE c.usuario_id = ? AND p.activo = 1`, [req.usuario.id])
        if (!filas.length) { await conn.rollback(); return fallo(res, 400, "Tu carrito está vacío") }
        const subtotal = filas.reduce((s, f) => s + f.cantidad * f.precio, 0)
        const [r] = await conn.query(
            `INSERT INTO pedidos (codigo, usuario_id, estado, subtotal, domicilio, total,
                                  entrega_nombre, entrega_direccion, entrega_telefono, metodo_pago)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ["T" + crypto.randomBytes(5).toString("hex"), req.usuario.id, ESTADOS[0], subtotal, DOMICILIO, subtotal + DOMICILIO,
             String(entrega.nombre).trim(), String(entrega.direccion).trim(), String(entrega.telefono).trim(), String(metodo)])
        const id = r.insertId
        await conn.query("UPDATE pedidos SET codigo = CONCAT('ZV', LPAD(id, 4, '0')) WHERE id = ?", [id])
        await conn.query("INSERT INTO pedido_items (pedido_id, producto_id, nombre, precio, cantidad) VALUES ?",
            [filas.map((f) => [id, f.id, f.nombre, f.precio, f.cantidad])])
        await conn.query("INSERT INTO pedido_historial (pedido_id, estado) VALUES (?, ?)", [id, ESTADOS[0]])
        await conn.query("DELETE FROM carrito WHERE usuario_id = ?", [req.usuario.id])
        await conn.commit()
        const [pedido] = await cargarPedidos("WHERE p.id = ?", [id])
        res.json({ pedido })
    } catch (e) {
        await conn.rollback()
        throw e
    } finally {
        conn.release()
    }
}))

app.get("/api/pedidos", autenticar, ruta(async (req, res) =>
    res.json({ pedidos: await cargarPedidos("WHERE p.usuario_id = ?", [req.usuario.id]) })))

app.get("/api/pedidos/:id", autenticar, ruta(async (req, res) => {
    const [pedido] = await cargarPedidos("WHERE p.id = ?", [Number(req.params.id)])
    if (!pedido || (pedido.usuarioId !== req.usuario.id && req.usuario.rol !== "admin")) return fallo(res, 404, "Pedido no encontrado")
    res.json({ pedido })
}))

/* ---------- administración ---------- */
const admin = express.Router()
admin.use(autenticar, soloAdmin)

admin.get("/stats", ruta(async (req, res) => {
    const [[a]] = await pool.query(
        "SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS ventas, COALESCE(SUM(estado <> 'Entregado'), 0) AS pendientes FROM pedidos")
    const [[p]] = await pool.query("SELECT COUNT(*) AS n FROM productos")
    const [[u]] = await pool.query("SELECT COUNT(*) AS n FROM usuarios")
    res.json({ pedidos: Number(a.pedidos), ventas: Number(a.ventas), pendientes: Number(a.pendientes), productos: p.n, usuarios: u.n })
}))

admin.get("/pedidos", ruta(async (req, res) => res.json({ pedidos: await cargarPedidos("", []) })))

admin.patch("/pedidos/:id", ruta(async (req, res) => {
    const id = Number(req.params.id)
    const nuevo = req.body && req.body.estado
    const idx = ESTADOS.indexOf(nuevo)
    if (idx < 0) return fallo(res, 400, "Estado inválido")
    const [r] = await pool.query("UPDATE pedidos SET estado = ? WHERE id = ?", [nuevo, id])
    if (!r.affectedRows) return fallo(res, 404, "Pedido no encontrado")
    const posteriores = ESTADOS.slice(idx + 1)
    if (posteriores.length) await pool.query("DELETE FROM pedido_historial WHERE pedido_id = ? AND estado IN (?)", [id, posteriores])
    const [ya] = await pool.query("SELECT id FROM pedido_historial WHERE pedido_id = ? AND estado = ?", [id, nuevo])
    if (!ya.length) await pool.query("INSERT INTO pedido_historial (pedido_id, estado) VALUES (?, ?)", [id, nuevo])
    res.json({})
}))

async function datosProducto(b) {
    const nombre = String((b && b.nombre) || "").trim()
    const precio = Number(b && b.precio)
    if (!nombre) return { error: "Escribe el nombre del producto" }
    if (!Number.isInteger(precio) || precio < 0) return { error: "El precio debe ser un número entero válido" }
    const [cat] = await pool.query("SELECT id FROM categorias WHERE nombre = ?", [b && b.categoria])
    if (!cat.length) return { error: "Categoría inválida" }
    return {
        valores: [nombre, precio, b.categoria, String(b.emoji || "").trim().slice(0, 16) || null,
                  String(b.imagen || "").trim() || null, b.activo ? 1 : 0]
    }
}

admin.get("/categorias", ruta(async (req, res) => {
    const [categorias] = await pool.query(
        `SELECT c.id, c.nombre, c.activa, (SELECT COUNT(*) FROM productos p WHERE p.categoria = c.nombre) AS productos
           FROM categorias c ORDER BY c.id`)
    res.json({ categorias: categorias.map((c) => ({ ...c, activa: !!c.activa })) })
}))

admin.post("/categorias", ruta(async (req, res) => {
    const nombre = String((req.body && req.body.nombre) || "").trim().slice(0, 30)
    if (!nombre) return fallo(res, 400, "Escribe el nombre de la categoría")
    const [ya] = await pool.query("SELECT id FROM categorias WHERE nombre = ?", [nombre])
    if (ya.length) return fallo(res, 409, "Esa categoría ya existe")
    await pool.query("INSERT INTO categorias (nombre, activa) VALUES (?, ?)", [nombre, req.body.activa === false ? 0 : 1])
    res.json({})
}))

admin.put("/categorias/:id", ruta(async (req, res) => {
    const id = Number(req.params.id)
    const nombre = String((req.body && req.body.nombre) || "").trim().slice(0, 30)
    if (!nombre) return fallo(res, 400, "Escribe el nombre de la categoría")
    const [filas] = await pool.query("SELECT nombre FROM categorias WHERE id = ?", [id])
    if (!filas.length) return fallo(res, 404, "Categoría no encontrada")
    const [dup] = await pool.query("SELECT id FROM categorias WHERE nombre = ? AND id <> ?", [nombre, id])
    if (dup.length) return fallo(res, 409, "Ya existe otra categoría con ese nombre")
    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()
        await conn.query("UPDATE categorias SET nombre = ?, activa = ? WHERE id = ?", [nombre, req.body.activa ? 1 : 0, id])
        // si cambió el nombre, los productos siguen con su categoría
        await conn.query("UPDATE productos SET categoria = ? WHERE categoria = ?", [nombre, filas[0].nombre])
        await conn.commit()
    } catch (e) {
        await conn.rollback()
        throw e
    } finally {
        conn.release()
    }
    res.json({})
}))

admin.delete("/categorias/:id", ruta(async (req, res) => {
    const id = Number(req.params.id)
    const [filas] = await pool.query("SELECT nombre FROM categorias WHERE id = ?", [id])
    if (!filas.length) return fallo(res, 404, "Categoría no encontrada")
    const [[uso]] = await pool.query("SELECT COUNT(*) AS n FROM productos WHERE categoria = ?", [filas[0].nombre])
    if (uso.n) return fallo(res, 409, "Tiene " + uso.n + " producto(s). Cámbialos de categoría o desactívala en lugar de eliminarla")
    await pool.query("DELETE FROM categorias WHERE id = ?", [id])
    res.json({})
}))

admin.get("/productos", ruta(async (req, res) => {
    const [productos] = await pool.query("SELECT * FROM productos ORDER BY id")
    res.json({ productos: productos.map((p) => ({ ...p, activo: !!p.activo })) })
}))

admin.post("/productos", ruta(async (req, res) => {
    const d = await datosProducto(req.body)
    if (d.error) return fallo(res, 400, d.error)
    await pool.query("INSERT INTO productos (nombre, precio, categoria, emoji, imagen, activo) VALUES (?, ?, ?, ?, ?, ?)", d.valores)
    res.json({})
}))

admin.put("/productos/:id", ruta(async (req, res) => {
    const d = await datosProducto(req.body)
    if (d.error) return fallo(res, 400, d.error)
    await pool.query("UPDATE productos SET nombre = ?, precio = ?, categoria = ?, emoji = ?, imagen = ?, activo = ? WHERE id = ?",
        [...d.valores, Number(req.params.id)])
    res.json({})
}))

admin.delete("/productos/:id", ruta(async (req, res) => {
    await pool.query("DELETE FROM productos WHERE id = ?", [Number(req.params.id)])
    res.json({})
}))

admin.get("/usuarios", ruta(async (req, res) => {
    const [usuarios] = await pool.query(
        `SELECT u.id, u.nombre, u.correo, u.telefono, u.rol, u.creado,
                (SELECT COUNT(*) FROM pedidos p WHERE p.usuario_id = u.id) AS pedidos
           FROM usuarios u ORDER BY u.id`)
    res.json({ usuarios })
}))

admin.post("/usuarios", ruta(async (req, res) => {
    const { nombre, correo, telefono, contrasena, rol } = req.body || {}
    if (!nombre || !correo || !telefono || !contrasena) return fallo(res, 400, "Completa todos los campos")
    if (String(contrasena).length < 6) return fallo(res, 400, "La contraseña debe tener mínimo 6 caracteres")
    const mail = String(correo).trim().toLowerCase()
    const [existe] = await pool.query("SELECT id FROM usuarios WHERE correo = ?", [mail])
    if (existe.length) return fallo(res, 409, "Ya existe una cuenta con ese correo")
    await pool.query("INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol) VALUES (?, ?, ?, ?, ?)",
        [String(nombre).trim(), mail, String(telefono).trim(), hashPass(String(contrasena)), rol === "admin" ? "admin" : "cliente"])
    res.json({})
}))

admin.delete("/usuarios/:id", ruta(async (req, res) => {
    const id = Number(req.params.id)
    if (id === req.usuario.id) return fallo(res, 400, "No puedes eliminar tu propia cuenta")
    try {
        await pool.query("DELETE FROM usuarios WHERE id = ?", [id])
    } catch (e) {
        if (e.code === "ER_ROW_IS_REFERENCED_2") return fallo(res, 409, "Ese usuario tiene pedidos y no se puede eliminar")
        throw e
    }
    res.json({})
}))

app.use("/api/admin", admin)
app.use("/api", (req, res) => fallo(res, 404, "Ruta no encontrada"))

/* ---------- sitio web ---------- */
app.use(express.static(path.join(__dirname, "public")))

/* ---------- arranque ---------- */
async function semillas() {
    const [[prod]] = await pool.query("SELECT COUNT(*) AS n FROM productos")
    if (!prod.n) {
        const lista = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"))
        await pool.query("INSERT INTO productos (nombre, precio, categoria, emoji, imagen, activo) VALUES ?",
            [lista.map((p) => [p.nombre, p.precio, p.categoria, p.emoji, p.imagen, 1])])
        console.log("Productos iniciales creados: " + lista.length)
    }
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM usuarios")
    if (n) return
    const correoAdmin = (process.env.ADMIN_CORREO || "admin@zivora.com").toLowerCase()
    const passAdmin = process.env.ADMIN_CONTRASENA || "admin123"
    await pool.query("INSERT INTO usuarios (nombre, correo, telefono, contrasena, rol) VALUES (?, ?, ?, ?, 'admin')",
        ["Administrador", correoAdmin, "", hashPass(passAdmin)])
    console.log("Administrador creado: " + correoAdmin + " / " + passAdmin + "  (cámbialo en producción con ADMIN_CORREO y ADMIN_CONTRASENA)")
}

// Crea las tablas nuevas si no existen (así no hace falta volver a importar schema.sql)
async function migrar() {
    // Tablas principales (se crean solas la primera vez; así no hace falta importar schema.sql en el hosting)
    const tablas = [
        `CREATE TABLE IF NOT EXISTS usuarios (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nombre     VARCHAR(100) NOT NULL,
  correo     VARCHAR(120) NOT NULL UNIQUE,
  telefono   VARCHAR(30)  NOT NULL,
  contrasena VARCHAR(255) NOT NULL,
  rol        ENUM('cliente','admin') NOT NULL DEFAULT 'cliente',
  creado     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
        `CREATE TABLE IF NOT EXISTS sesiones (
  token      CHAR(64) PRIMARY KEY,
  usuario_id INT NOT NULL,
  creado     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
)`,
        `CREATE TABLE IF NOT EXISTS productos (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  nombre    VARCHAR(120) NOT NULL,
  precio    INT NOT NULL,
  categoria VARCHAR(30)  NOT NULL,
  emoji     VARCHAR(16),
  imagen    TEXT,
  activo    TINYINT(1) NOT NULL DEFAULT 1
)`,
        `CREATE TABLE IF NOT EXISTS carrito (
  usuario_id  INT NOT NULL,
  producto_id INT NOT NULL,
  cantidad    INT NOT NULL DEFAULT 1,
  PRIMARY KEY (usuario_id, producto_id),
  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)  ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
)`,
        `CREATE TABLE IF NOT EXISTS pedidos (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(12) NOT NULL UNIQUE,
  usuario_id        INT NOT NULL,
  estado            ENUM('Confirmado','Preparando','En camino','Entregado') NOT NULL DEFAULT 'Confirmado',
  subtotal          INT NOT NULL,
  domicilio         INT NOT NULL,
  total             INT NOT NULL,
  entrega_nombre    VARCHAR(100) NOT NULL,
  entrega_direccion VARCHAR(200) NOT NULL,
  entrega_telefono  VARCHAR(30)  NOT NULL,
  metodo_pago       VARCHAR(60)  NOT NULL,
  creado            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
)`,
        `CREATE TABLE IF NOT EXISTS pedido_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id   INT NOT NULL,
  producto_id INT NULL,
  nombre      VARCHAR(120) NOT NULL,
  precio      INT NOT NULL,
  cantidad    INT NOT NULL,
  FOREIGN KEY (pedido_id)   REFERENCES pedidos(id)   ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL
)`,
        `CREATE TABLE IF NOT EXISTS pedido_historial (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT NOT NULL,
  estado    ENUM('Confirmado','Preparando','En camino','Entregado') NOT NULL,
  fecha     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
)`
    ]
    for (const sql of tablas) await pool.query(sql)
    await pool.query(`CREATE TABLE IF NOT EXISTS categorias (
        id     INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(30) NOT NULL UNIQUE,
        activa TINYINT(1) NOT NULL DEFAULT 1
    )`)
    await pool.query(`CREATE TABLE IF NOT EXISTS verificaciones (
        id      INT AUTO_INCREMENT PRIMARY KEY,
        correo  VARCHAR(120) NOT NULL,
        tipo    ENUM('registro','recuperar') NOT NULL,
        codigo  CHAR(64) NOT NULL,
        datos   TEXT NULL,
        intentos INT NOT NULL DEFAULT 0,
        expira  DATETIME NOT NULL,
        creado  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_correo_tipo (correo, tipo)
    )`)
    const [[c]] = await pool.query("SELECT COUNT(*) AS n FROM categorias")
    if (!c.n) {
        await pool.query("INSERT INTO categorias (nombre) VALUES ('Desayunos'), ('Almuerzos'), ('Bebidas'), ('Otros')")
        await pool.query("INSERT IGNORE INTO categorias (nombre) SELECT DISTINCT categoria FROM productos")
    }
}

pool.query("SELECT 1")
    .then(migrar)
    .then(semillas)
    .then(() => app.listen(PUERTO, () => console.log("ZIVORA listo en http://localhost:" + PUERTO)))
    .catch((e) => {
        console.error("No se pudo conectar a MySQL:", e.message)
        console.error("Revisa que MySQL esté encendido, que hayas ejecutado schema.sql y los datos de .env")
        process.exit(1)
    })