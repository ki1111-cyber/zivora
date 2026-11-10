/* =========================================================
   ZivoraDB - cliente de la API (los datos viven en MySQL)
   Solo la sesión (token + datos del usuario) se guarda en el
   navegador; usuarios, carrito y pedidos están en la base de datos.
   ========================================================= */
const ZivoraDB = (() => {
    const ESTADOS = ["Confirmado", "Preparando", "En camino", "Entregado"]
    const CLAVE = "zivora_sesion"

    const leer = () => {
        try { return JSON.parse(localStorage.getItem(CLAVE)) } catch (e) { return null }
    }

    async function api(ruta, { method = "GET", body } = {}) {
        const s = leer()
        const headers = { "Content-Type": "application/json" }
        if (s) headers.Authorization = "Bearer " + s.token
        let res
        try {
            res = await fetch("/api" + ruta, { method, headers, body: body ? JSON.stringify(body) : undefined })
        } catch (e) {
            return { ok: false, error: "No se pudo conectar con el servidor" }
        }
        let data = {}
        try { data = await res.json() } catch (e) { /* sin cuerpo */ }
        if (res.status === 401 && s) {
            localStorage.removeItem(CLAVE)
            location.replace("index.html")
        }
        return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || "Ocurrió un error" }
    }

    const guardarSesion = (r) => {
        if (r.ok) localStorage.setItem(CLAVE, JSON.stringify({ token: r.token, usuario: r.usuario }))
        return r
    }

    return {
        ESTADOS,

        /* ---------- ayudas de formato ---------- */
        formato: (n) => "$" + Number(n).toLocaleString("es-CO"),
        esc: (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
        fecha: (f) => new Date(f).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }),
        hora: (f) => new Date(f).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),

        /* ---------- sesión ---------- */
        usuarioActual: () => (leer() || {}).usuario || null,
        login: async (usuario, contrasena) => guardarSesion(await api("/login", { method: "POST", body: { usuario, contrasena } })),
        registrar: async (datos) => guardarSesion(await api("/registro", { method: "POST", body: datos })),
        recuperar: (correo, contrasena) => api("/recuperar", { method: "POST", body: { correo, contrasena } }),
        cerrarSesion: async () => {
            await api("/logout", { method: "POST" })
            localStorage.removeItem(CLAVE)
        },

        /* ---------- productos ---------- */
        listarProductos: async () => (await api("/productos")).productos || [],

        /* ---------- carrito (cada llamada devuelve el carrito actualizado) ---------- */
        obtenerCarrito: () => api("/carrito"),
        agregarAlCarrito: (productoId) => api("/carrito", { method: "POST", body: { productoId } }),
        cambiarCantidad: (productoId, delta) => api("/carrito/" + productoId, { method: "PATCH", body: { delta } }),
        quitarDelCarrito: (productoId) => api("/carrito/" + productoId, { method: "DELETE" }),

        /* ---------- pedidos ---------- */
        crearPedido: (entrega, metodo) => api("/pedidos", { method: "POST", body: { entrega, metodo } }),
        obtenerPedido: (id) => api("/pedidos/" + id),
        pedidosDe: async () => (await api("/pedidos")).pedidos || [],

        /* ---------- administración ---------- */
        admin: {
            stats: () => api("/admin/stats"),
            pedidos: async () => (await api("/admin/pedidos")).pedidos || [],
            cambiarEstado: (id, estado) => api("/admin/pedidos/" + id, { method: "PATCH", body: { estado } }),
            productos: async () => (await api("/admin/productos")).productos || [],
            guardarProducto: (p) => p.id
                ? api("/admin/productos/" + p.id, { method: "PUT", body: p })
                : api("/admin/productos", { method: "POST", body: p }),
            borrarProducto: (id) => api("/admin/productos/" + id, { method: "DELETE" }),
            usuarios: async () => (await api("/admin/usuarios")).usuarios || [],
            crearUsuario: (u) => api("/admin/usuarios", { method: "POST", body: u }),
            borrarUsuario: (id) => api("/admin/usuarios/" + id, { method: "DELETE" })
        }
    }
})()