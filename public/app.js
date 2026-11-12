/* =========================================================
   ZIVORA - lógica del sitio (login, productos, carrito, pedidos)
   Requiere db.js cargado antes que este archivo.
   ========================================================= */
const { formato, esc, ESTADOS } = ZivoraDB
const $ = (s) => document.querySelector(s)
const paginaActual = location.pathname.split("/").pop() || "index.html"
const paginasPublicas = ["index.html", "registro.html", "recuperar.html"]
const sesionActual = ZivoraDB.usuarioActual()

// Si la imagen de un producto no carga, se muestra su emoji
document.addEventListener("error", (e) => {
    if (e.target.tagName === "IMG" && e.target.dataset.emoji) {
        const s = document.createElement("span")
        s.className = "emoji"
        s.textContent = e.target.dataset.emoji
        e.target.replaceWith(s)
    }
}, true)

function aviso(msg) {
    const t = document.createElement("div")
    t.className = "toast"
    t.textContent = msg
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 2000)
}

function imagenProducto(p) {
    return p.imagen
        ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" data-emoji="${esc(p.emoji || "🍽️")}">`
        : `<span class="emoji">${esc(p.emoji || "🍽️")}</span>`
}

function pintarBadge(n) {
    const b = document.getElementById("badge-carrito")
    if (!b) return
    b.textContent = n
    b.classList.toggle("oculto", n === 0)
}

async function actualizarBadge() {
    const c = await ZivoraDB.obtenerCarrito()
    if (c.ok) pintarBadge(c.cantidad)
}

// Carrito con contador + icono de usuario (menú con cerrar sesión)
function montarHeader() {
    const header = document.querySelector("header")
    if (!header || !sesionActual) return
    const carro = document.getElementById("btn-carrito")
    const acciones = document.createElement("div")
    acciones.className = "acciones"
    if (carro) {
        carro.parentNode.insertBefore(acciones, carro)
        acciones.appendChild(carro)
        const badge = document.createElement("span")
        badge.id = "badge-carrito"
        badge.className = "badge oculto"
        carro.appendChild(badge)
    } else {
        header.appendChild(acciones)
    }
    const perfil = document.createElement("button")
    perfil.className = "perfil"
    perfil.type = "button"
    perfil.textContent = "👤"
    const menu = document.createElement("div")
    menu.className = "menu-perfil oculto"
    menu.innerHTML = `<p><strong>${esc(sesionActual.nombre)}</strong></p><small>${esc(sesionActual.correo)}${sesionActual.rol === "admin" ? " · Admin" : ""}</small>` +
        (paginaActual !== "perfil.html" ? `<a href="perfil.html">Mi perfil</a>` : "") +
        (sesionActual.rol === "admin" && paginaActual !== "admin.html" ? `<a href="admin.html">Panel de administración</a>` : "") +
        `<button type="button" id="btn-salir">Cerrar sesión</button>`
    acciones.appendChild(perfil)
    acciones.appendChild(menu)
    perfil.addEventListener("click", () => menu.classList.toggle("oculto"))
    menu.querySelector("#btn-salir").addEventListener("click", async () => {
        await ZivoraDB.cerrarSesion()
        window.location.href = "index.html"
    })
    // enlace al panel admin en la navegación
    const nav = header.querySelector("nav")
    if (nav && sesionActual.rol === "admin" && paginaActual !== "admin.html") {
        const a = document.createElement("a")
        a.href = "admin.html"
        a.textContent = "Admin"
        nav.appendChild(a)
    }
    document.querySelectorAll("header nav a").forEach(a =>
        a.classList.toggle("activo", a.getAttribute("href") === paginaActual))
    if (carro) actualizarBadge()
}

function lineaTiempo(p) {
    const actual = ESTADOS.indexOf(p.estado)
    return '<ul class="timeline">' + ESTADOS.map((est, i) => {
        const h = p.historial.find(x => x.estado === est)
        const clase = i < actual || (i === actual && actual === ESTADOS.length - 1) ? "hecho" : i === actual ? "actual" : "pendiente"
        return `<li class="paso ${clase}"><span class="punto">${clase === "hecho" ? "✓" : ""}</span>
            <div><strong>${est}</strong><small>${h ? ZivoraDB.hora(h.fecha) : ""}</small></div></li>`
    }).join("") + "</ul>"
}

/* ---------- Login / registro / recuperar ---------- */
async function entrar() {
    const usuario = $("#correo").value.trim(), pass = $("#contraseña").value
    if (!usuario || !pass) return alert("Escribe tu correo y contraseña")
    const r = await ZivoraDB.login(usuario, pass)
    if (!r.ok) return alert(r.error)
    window.location.href = "home.html"
}
$("#btn-entrar")?.addEventListener("click", entrar)
$("#contraseña")?.addEventListener("keydown", (e) => { if (e.key === "Enter") entrar() })
$("#btn-registrarse")?.addEventListener("click", () => { window.location.href = "registro.html" })

/* ---------- Registro con código al correo ---------- */
let datosRegistro = null
$("#form-registro")?.addEventListener("submit", async (e) => {
    e.preventDefault()
    const nombre = $("#reg-nombre").value.trim(), correo = $("#reg-correo").value.trim()
    const tel = $("#reg-telefono").value.trim(), p1 = $("#reg-pass").value, p2 = $("#reg-pass2").value
    if (!nombre || !correo || !tel || !p1) return alert("Completa todos los campos")
    if (p1.length < 8) return alert("La contraseña debe tener mínimo 8 caracteres")
    if (p1 !== p2) return alert("Las contraseñas no coinciden")
    datosRegistro = { nombre, correo, telefono: tel, contrasena: p1 }
    const r = await ZivoraDB.pedirCodigoRegistro(datosRegistro)
    if (!r.ok) return alert(r.error)
    $("#form-registro").classList.add("oculto")
    $("#form-codigo").classList.remove("oculto")
    $("#texto-codigo").textContent = "Te enviamos un código de 6 dígitos a " + correo + ". Revisa también la carpeta de spam."
})

$("#form-codigo")?.addEventListener("submit", async (e) => {
    e.preventDefault()
    const r = await ZivoraDB.registrar({ correo: datosRegistro.correo, codigo: $("#reg-codigo").value.trim() })
    if (!r.ok) return alert(r.error)
    window.location.href = "home.html"
})

$("#btn-reenviar")?.addEventListener("click", async () => {
    const r = await ZivoraDB.pedirCodigoRegistro(datosRegistro)
    alert(r.ok ? "Te enviamos un código nuevo" : r.error)
})

/* ---------- Recuperar contraseña con código ---------- */
let correoRec = ""
$("#form-correo")?.addEventListener("submit", async (e) => {
    e.preventDefault()
    correoRec = $("#rec-correo").value.trim()
    if (!correoRec) return alert("Escribe tu correo")
    const r = await ZivoraDB.pedirCodigoRecuperar(correoRec)
    if (!r.ok) return alert(r.error)
    $("#form-correo").classList.add("oculto")
    $("#form-recuperar").classList.remove("oculto")
})

$("#form-recuperar")?.addEventListener("submit", async (e) => {
    e.preventDefault()
    const pass = $("#rec-pass").value
    if (pass.length < 8) return alert("La contraseña debe tener mínimo 8 caracteres")
    const r = await ZivoraDB.recuperar(correoRec, $("#rec-codigo").value.trim(), pass)
    if (!r.ok) return alert(r.error)
    alert("Contraseña actualizada. Ya puedes iniciar sesión")
    window.location.href = "index.html"
})

/* ---------- Iniciar sesión con Google ---------- */
async function iniciarGoogle() {
    const cont = $("#google-boton")
    if (!cont) return
    const cfg = await ZivoraDB.config()
    if (!cfg.googleClientId) {
        cont.innerHTML = '<button type="button" id="btn-google">Continuar con Google</button>'
        $("#btn-google").addEventListener("click", () =>
            alert("Falta configurar GOOGLE_CLIENT_ID en el servidor (mira el README)"))
        return
    }
    await new Promise((ok, mal) => {
        const s = document.createElement("script")
        s.src = "https://accounts.google.com/gsi/client"
        s.onload = ok
        s.onerror = mal
        document.head.appendChild(s)
    }).catch(() => null)
    if (!window.google) { cont.textContent = "No se pudo cargar Google"; return }
    google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async (resp) => {
            const r = await ZivoraDB.loginGoogle(resp.credential)
            if (!r.ok) return alert(r.error)
            window.location.href = "home.html"
        }
    })
    google.accounts.id.renderButton(cont, { theme: "filled_black", size: "large", text: "continue_with", width: 320 })
}
iniciarGoogle()

/* ---------- Inicio ---------- */
$(".btn-expl")?.addEventListener("click", () => { window.location.href = "productos.html" })

/* ---------- Productos ---------- */
async function pintarProductos() {
    const lista = $(".list")
    if (!lista) return
    let cat = "Todos", texto = ""
    const [todos, categorias] = await Promise.all([ZivoraDB.listarProductos(), ZivoraDB.listarCategorias()])
    document.querySelectorAll(".lat .cat").forEach(b => b.remove()) // quita los botones escritos a mano en el HTML
    $(".lat").insertAdjacentHTML("beforeend",
        ["Todos", ...categorias].map(c => `<button class="cat">${esc(c)}</button>`).join(""))
    const botones = document.querySelectorAll(".lat .cat")
    const tarjeta = (p) => `<div class="tj">
            <div class="foto">${imagenProducto(p)}</div>
            <h4>${esc(p.nombre)}</h4>
            <p class="precio">${formato(p.precio)}</p>
            <button class="btn-add" data-id="${p.id}">Agregar +</button>
        </div>`
    function dibujar() {
        const prods = todos.filter(p =>
            (cat === "Todos" || p.categoria === cat) && p.nombre.toLowerCase().includes(texto))
        lista.innerHTML = prods.length ? prods.map(tarjeta).join("") : '<p class="msg-vacio">No hay productos para mostrar.</p>'
    }
    lista.addEventListener("click", async (e) => {
        const b = e.target.closest(".btn-add")
        if (!b) return
        b.disabled = true
        const r = await ZivoraDB.agregarAlCarrito(Number(b.dataset.id))
        b.disabled = false
        if (!r.ok) return alert(r.error)
        pintarBadge(r.cantidad)
        aviso("Producto agregado al carrito 🛒")
    })
    botones.forEach(b => b.addEventListener("click", () => {
        cat = b.textContent.trim()
        botones.forEach(x => x.classList.toggle("activo", x === b))
        dibujar()
    }))
    $(".search")?.addEventListener("input", (e) => { texto = e.target.value.trim().toLowerCase(); dibujar() })
    botones[0]?.classList.add("activo")
    dibujar()
}

/* ---------- Carrito ---------- */
function dibujarCarrito(c) {
    const lista = $("#lista-carrito")
    $("#carrito-vacio").classList.toggle("oculto", c.items.length > 0)
    $("#carrito-contenido").classList.toggle("oculto", c.items.length === 0)
    lista.innerHTML = c.items.map(i => `<div class="item">
            <div class="item-foto">${imagenProducto(i.producto)}</div>
            <div class="item-info"><strong>${esc(i.producto.nombre)}</strong><span>${formato(i.producto.precio)}</span></div>
            <div class="cantidad">
                <button data-accion="menos" data-id="${i.producto.id}">−</button>
                <span>${i.cantidad}</span>
                <button data-accion="mas" data-id="${i.producto.id}">+</button>
            </div>
            <button class="quitar" data-accion="quitar" data-id="${i.producto.id}" title="Quitar">🗑️</button>
        </div>`).join("")
    $("#subtotal").textContent = formato(c.subtotal)
    $("#domicilio").textContent = formato(c.domicilio)
    $("#total").textContent = formato(c.total)
    pintarBadge(c.cantidad)
}

async function pintarCarrito() {
    if (!$("#lista-carrito")) return
    const c = await ZivoraDB.obtenerCarrito()
    if (!c.ok) return alert(c.error)
    dibujarCarrito(c)
    $("#lista-carrito").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-accion]")
        if (!b) return
        const id = Number(b.dataset.id)
        let r
        if (b.dataset.accion === "mas") r = await ZivoraDB.cambiarCantidad(id, 1)
        if (b.dataset.accion === "menos") r = await ZivoraDB.cambiarCantidad(id, -1)
        if (b.dataset.accion === "quitar") r = await ZivoraDB.quitarDelCarrito(id)
        if (r && !r.ok) return alert(r.error)
        if (r) dibujarCarrito(r)
    })
}

document.querySelectorAll("[data-ir]").forEach(b =>
    b.addEventListener("click", () => { window.location.href = b.dataset.ir + ".html" }))

/* ---------- Datos de entrega y pago ---------- */
async function iniciarCheckout() {
    const form = $("#form-checkout")
    if (!form) return
    const c = await ZivoraDB.obtenerCarrito()
    if (!c.ok || !c.items.length) { window.location.replace("carrito.html"); return }
    $("#ent-nombre").value = sesionActual.nombre
    $("#ent-telefono").value = sesionActual.telefono || ""
    $("#total-pagar").textContent = formato(c.total)
    form.addEventListener("submit", async (e) => {
        e.preventDefault()
        const entrega = { nombre: $("#ent-nombre").value.trim(), direccion: $("#ent-direccion").value.trim(), telefono: $("#ent-telefono").value.trim() }
        if (!entrega.nombre || !entrega.direccion || !entrega.telefono) return alert("Completa los datos de entrega")
        const metodo = form.querySelector('input[name="metodo"]:checked').value
        const r = await ZivoraDB.crearPedido(entrega, metodo)
        if (!r.ok) return alert(r.error)
        window.location.href = "confirmacion.html?id=" + r.pedido.id
    })
}

/* ---------- Pedido confirmado ---------- */
async function pintarConfirmacion() {
    if (!$("#conf-linea")) return
    const r = await ZivoraDB.obtenerPedido(Number(new URLSearchParams(location.search).get("id")))
    if (!r.ok) { window.location.replace("pedidos.html"); return }
    const p = r.pedido
    $("#conf-codigo").textContent = "#" + p.codigo
    $("#conf-texto").textContent = p.estado === "Entregado" ? "fue entregado." : p.estado === "En camino" ? "está en camino." : "fue confirmado."
    $("#conf-linea").innerHTML = lineaTiempo(p)
    $("#btn-detalles").addEventListener("click", () => { window.location.href = "pedidos.html" })
}

/* ---------- Mis pedidos (historial) ---------- */
async function pintarPedidos() {
    const cont = $("#lista-pedidos")
    if (!cont) return
    const pedidos = await ZivoraDB.pedidosDe()
    if (!pedidos.length) {
        cont.innerHTML = `<div class="vacio"><p>Aún no has hecho pedidos.</p><button class="btn" data-ir="productos">Explorar productos →</button></div>`
        cont.querySelector("[data-ir]").addEventListener("click", () => { window.location.href = "productos.html" })
        return
    }
    cont.innerHTML = pedidos.map(p => `<article class="pedido-card">
            <div class="pedido-top">
                <div><h3>#${esc(p.codigo)}</h3><small>${ZivoraDB.fecha(p.creado)} · ${ZivoraDB.hora(p.creado)}</small></div>
                <span class="estado e-${ESTADOS.indexOf(p.estado)}">${esc(p.estado)}</span>
            </div>
            <div class="pedido-cuerpo">
                <div>
                    <ul class="detalle">${p.items.map(i => `<li><span>${i.cantidad} × ${esc(i.nombre)}</span><span>${formato(i.precio * i.cantidad)}</span></li>`).join("")}</ul>
                    <div class="linea"><span>Domicilio</span><span>${formato(p.domicilio)}</span></div>
                    <div class="linea total"><span>Total</span><span>${formato(p.total)}</span></div>
                    <small>Entrega: ${esc(p.entrega.direccion)} · Pago: ${esc(p.metodoPago)}</small>
                </div>
                ${lineaTiempo(p)}
            </div>
        </article>`).join("")
}


/* ---------- Botón volver (flecha sutil) ---------- */
function montarVolver() {
    const destinos = {
        "carrito.html": "productos.html",
        "checkout.html": "carrito.html",
        "pedidos.html": "home.html",
        "perfil.html": "home.html",
        "admin.html": "home.html",
        "registro.html": "index.html"
    }
    const destino = destinos[paginaActual]
    const cont = document.querySelector("main, .login")
    if (!destino || !cont) return
    const a = document.createElement("a")
    a.href = destino
    a.className = "btn-volver"
    a.textContent = "←"
    a.setAttribute("aria-label", "Volver")
    cont.prepend(a)
}

/* ---------- Arranque con control de acceso ---------- */
if (!paginasPublicas.includes(paginaActual) && !sesionActual) {
    window.location.replace("index.html")
} else if (paginaActual === "admin.html" && sesionActual?.rol !== "admin") {
    window.location.replace(sesionActual ? "home.html" : "index.html")
} else if (paginaActual === "index.html" && sesionActual) {
    window.location.replace("home.html")
} else {
    montarHeader()
    montarVolver()
    pintarProductos()
    pintarCarrito()
    iniciarCheckout()
    pintarConfirmacion()
    pintarPedidos()
    // el historial se refresca solo para ver cuando el admin cambia el estado
    if ($("#lista-pedidos")) setInterval(pintarPedidos, 15000)
}

// === PARCHE RÁPIDO SUSTENTACIÓN - NO MANDA CORREO REAL ===
const formCorreoFix = document.getElementById('form-correo');
if (formCorreoFix) {
  formCorreoFix.addEventListener('submit', function(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    const correo = document.getElementById('rec-correo').value.trim();
    if(!correo){ alert('Escribe tu correo'); return; }
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    localStorage.setItem('codigo_recuperacion', codigo);
    localStorage.setItem('correo_recuperacion', correo);
    // Para que el otro formulario lo pueda validar
    window.codigoRecuperacion = codigo;
    alert('Código de demostración: ' + codigo);
    document.getElementById('form-correo').classList.add('oculto');
    document.getElementById('form-recuperar').classList.remove('oculto');
  }, true);
}



// === PARCHE 2 - VALIDAR CÓDIGO Y CAMBIAR CONTRASEÑA SIN VENCIMIENTO ===
const formRecuperarFix = document.getElementById('form-recuperar');
if (formRecuperarFix) {
  formRecuperarFix.addEventListener('submit', function(e){
    e.preventDefault();
    e.stopImmediatePropagation();

    const codigoIngresado = document.getElementById('rec-codigo').value.trim();
    const codigoReal = localStorage.getItem('codigo_recuperacion');
    const correo = localStorage.getItem('correo_recuperacion');
    const nuevaPass = document.getElementById('rec-pass').value.trim();

    if(codigoIngresado !== codigoReal){
      alert('Código incorrecto, intenta de nuevo ');
      return;
    }
    if(nuevaPass.length < 8){
      alert('La contraseña debe tener mínimo 8 caracteres');
      return;
    }

    // Buscar usuario en localStorage y cambiarle la clave
    let encontrado = false;
    for(let i=0; i<localStorage.length; i++){
      const clave = localStorage.key(i);
      try{
        const valor = JSON.parse(localStorage.getItem(clave));
        if(Array.isArray(valor)){
          valor.forEach(u => {
            if(u && (u.correo === correo || u.email === correo)){
              u.password = nuevaPass;
              u.contrasena = nuevaPass;
              u.pass = nuevaPass;
              u.clave = nuevaPass;
              encontrado = true;
            }
          });
          if(encontrado) localStorage.setItem(clave, JSON.stringify(valor));
        }
      }catch(err){}
    }

    alert('Contraseña cambiada con éxito. Ya puedes iniciar sesión.');
    localStorage.removeItem('codigo_recuperacion');
    window.location.href = 'index.html';
  }, true);
}