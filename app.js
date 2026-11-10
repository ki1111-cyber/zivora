let botonEntrar = document.getElementById("btn-entrar")

botonEntrar.addEventListener("click", ()=>{
    let correo = document.getElementById("correo")
    let contraseña = document.getElementById("contraseña")

    if (correo.value === "" || contraseña.value === "") {
        alert("Escribe tu correo y contraseña")
    } else if (correo.value === "usuario@gmail.com" && contraseña.value === "1234abc"){
        window.location.href = "home.html"
    }else {
        alert("Correo o contraseña incorrecta")
    }
     
})

let botonReg = document.getElementById("btn-registrarse")

botonReg.addEventListener("click", ()=> {
    alert("hola")
})


let btnInicio = document.getElementById("btn-inicio")
btnInicio.addEventListener("click", ()=>{
    window.location.href = "home.html"
})

let btnCat = document.getElementById("btn-cat")
btnCat.addEventListener("click", ()=>{
    window.location.href = "productos.html"
})

let btnPedi = document.getElementById("btn-pedidos")
btnPedi.addEventListener("click", ()=>{
    window.location.href = "pedidos.html" 
})

let btnCar = document.getElementById("btn-carrito")
btnCar.addEventListener("click", ()=>{
    window.location.href = "carrito.html"
})





/* =========================================================
   FUNCIONES AGREGADAS (base de datos, roles, carrito, pedidos)
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

function actualizarBadge() {
    const b = document.getElementById("badge-carrito")
    if (!b || !sesionActual) return
    const n = ZivoraDB.contarCarrito(sesionActual.id)
    b.textContent = n
    b.classList.toggle("oculto", n === 0)
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
        (sesionActual.rol === "admin" && paginaActual !== "admin.html" ? `<a href="admin.html">Panel de administración</a>` : "") +
        `<button type="button" id="btn-salir">Cerrar sesión</button>`
    acciones.appendChild(perfil)
    acciones.appendChild(menu)
    perfil.addEventListener("click", () => menu.classList.toggle("oculto"))
    menu.querySelector("#btn-salir").addEventListener("click", () => {
        ZivoraDB.cerrarSesion()
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
    actualizarBadge()
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
$("#btn-google")?.addEventListener("click", () => alert("El inicio de sesión con Google estará disponible próximamente"))

$("#form-registro")?.addEventListener("submit", (e) => {
    e.preventDefault()
    const nombre = $("#reg-nombre").value.trim(), correo = $("#reg-correo").value.trim()
    const tel = $("#reg-telefono").value.trim(), p1 = $("#reg-pass").value, p2 = $("#reg-pass2").value
    if (!nombre || !correo || !tel || !p1) return alert("Completa todos los campos")
    if (p1.length < 6) return alert("La contraseña debe tener mínimo 6 caracteres")
    if (p1 !== p2) return alert("Las contraseñas no coinciden")
    const r = ZivoraDB.registrar({ nombre, correo, telefono: tel, contraseña: p1 })
    if (!r.ok) return alert(r.error)
    ZivoraDB.iniciarSesion(r.usuario.id)
    window.location.href = "home.html"
})

$("#form-recuperar")?.addEventListener("submit", (e) => {
    e.preventDefault()
    const pass = $("#rec-pass").value
    if (pass.length < 6) return alert("La contraseña debe tener mínimo 6 caracteres")
    if (ZivoraDB.recuperar($("#rec-correo").value, pass)) {
        alert("Contraseña actualizada. Ya puedes iniciar sesión")
        window.location.href = "index.html"
    } else {
        alert("No existe una cuenta con ese correo")
    }
})

/* ---------- Inicio ---------- */
$(".btn-expl")?.addEventListener("click", () => { window.location.href = "productos.html" })

/* ---------- Productos ---------- */
function pintarProductos() {
    const lista = $(".list")
    if (!lista) return
    let cat = "Todos", texto = ""
    const botones = document.querySelectorAll(".lat .cat")
    const tarjeta = (p) => `<div class="tj">
            <div class="foto">${imagenProducto(p)}</div>
            <h4>${esc(p.nombre)}</h4>
            <p class="precio">${formato(p.precio)}</p>
            <button class="btn-add" data-id="${p.id}">Agregar +</button>
        </div>`
    function dibujar() {
        const prods = ZivoraDB.listarProductos(true).filter(p =>
            (cat === "Todos" || p.categoria === cat) && p.nombre.toLowerCase().includes(texto))
        lista.innerHTML = prods.length ? prods.map(tarjeta).join("") : '<p class="msg-vacio">No hay productos para mostrar.</p>'
    }
    lista.addEventListener("click", (e) => {
        const b = e.target.closest(".btn-add")
        if (!b) return
        ZivoraDB.agregarAlCarrito(sesionActual.id, Number(b.dataset.id))
        actualizarBadge()
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
function pintarCarrito() {
    const lista = $("#lista-carrito")
    if (!lista) return
    const items = ZivoraDB.obtenerCarrito(sesionActual.id)
    $("#carrito-vacio").classList.toggle("oculto", items.length > 0)
    $("#carrito-contenido").classList.toggle("oculto", items.length === 0)
    lista.innerHTML = items.map(i => `<div class="item">
            <div class="item-foto">${imagenProducto(i.producto)}</div>
            <div class="item-info"><strong>${esc(i.producto.nombre)}</strong><span>${formato(i.producto.precio)}</span></div>
            <div class="cantidad">
                <button data-accion="menos" data-id="${i.producto.id}">−</button>
                <span>${i.cantidad}</span>
                <button data-accion="mas" data-id="${i.producto.id}">+</button>
            </div>
            <button class="quitar" data-accion="quitar" data-id="${i.producto.id}" title="Quitar">🗑️</button>
        </div>`).join("")
    const t = ZivoraDB.totales(sesionActual.id)
    $("#subtotal").textContent = formato(t.subtotal)
    $("#domicilio").textContent = formato(t.domicilio)
    $("#total").textContent = formato(t.total)
    actualizarBadge()
}
$("#lista-carrito")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-accion]")
    if (!b) return
    const id = Number(b.dataset.id)
    if (b.dataset.accion === "mas") ZivoraDB.cambiarCantidad(sesionActual.id, id, 1)
    if (b.dataset.accion === "menos") ZivoraDB.cambiarCantidad(sesionActual.id, id, -1)
    if (b.dataset.accion === "quitar") ZivoraDB.quitarDelCarrito(sesionActual.id, id)
    pintarCarrito()
})
document.querySelectorAll("[data-ir]").forEach(b =>
    b.addEventListener("click", () => { window.location.href = b.dataset.ir + ".html" }))

/* ---------- Datos de entrega y pago ---------- */
function iniciarCheckout() {
    const form = $("#form-checkout")
    if (!form) return
    if (!ZivoraDB.obtenerCarrito(sesionActual.id).length) { window.location.replace("carrito.html"); return }
    $("#ent-nombre").value = sesionActual.nombre
    $("#ent-telefono").value = sesionActual.telefono || ""
    $("#total-pagar").textContent = formato(ZivoraDB.totales(sesionActual.id).total)
    form.addEventListener("submit", (e) => {
        e.preventDefault()
        const entrega = { nombre: $("#ent-nombre").value.trim(), direccion: $("#ent-direccion").value.trim(), telefono: $("#ent-telefono").value.trim() }
        if (!entrega.nombre || !entrega.direccion || !entrega.telefono) return alert("Completa los datos de entrega")
        const metodo = form.querySelector('input[name="metodo"]:checked').value
        const pedido = ZivoraDB.crearPedido(sesionActual.id, entrega, metodo)
        if (!pedido) return alert("Tu carrito está vacío")
        window.location.href = "confirmacion.html?id=" + pedido.id
    })
}

/* ---------- Pedido confirmado ---------- */
function pintarConfirmacion() {
    if (!$("#conf-linea")) return
    const p = ZivoraDB.obtenerPedido(Number(new URLSearchParams(location.search).get("id")))
    if (!p || (p.usuarioId !== sesionActual.id && sesionActual.rol !== "admin")) { window.location.replace("pedidos.html"); return }
    $("#conf-codigo").textContent = "#" + p.codigo
    $("#conf-texto").textContent = p.estado === "Entregado" ? "fue entregado." : p.estado === "En camino" ? "está en camino." : "fue confirmado."
    $("#conf-linea").innerHTML = lineaTiempo(p)
    $("#btn-detalles").addEventListener("click", () => { window.location.href = "pedidos.html" })
}

/* ---------- Mis pedidos ---------- */
function pintarPedidos() {
    const cont = $("#lista-pedidos")
    if (!cont) return
    const pedidos = ZivoraDB.pedidosDe(sesionActual.id)
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

/* ---------- Arranque con control de acceso ---------- */
if (!paginasPublicas.includes(paginaActual) && !sesionActual) {
    window.location.replace("index.html")
} else if (paginaActual === "admin.html" && sesionActual?.rol !== "admin") {
    window.location.replace(sesionActual ? "home.html" : "index.html")
} else {
    montarHeader()
    pintarProductos()
    pintarCarrito()
    iniciarCheckout()
    pintarConfirmacion()
    pintarPedidos()
}



let botonesCat = document.querySelectorAll(".lat .cat")
let tarjetas = document.querySelectorAll(".tj")

botonesCat.forEach((boton)=>{
    boton.addEventListener("click", ()=>{
        let categoria = boton.textContent.trim()

        botonesCat.forEach((b)=> b.classList.remove("activo"))
        boton.classList.add("activo")

        tarjetas.forEach((tarjeta)=>{
            if (categoria === "Todos" || tarjeta.dataset.categoria === categoria) {
                tarjeta.style.display = ""
            } else {
                tarjeta.style.display = "none"
            }
        })
    })
})