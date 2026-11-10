/* =========================================================
   ZIVORA - Panel de administración (pedidos, productos, usuarios)
   ========================================================= */
(() => {
    const yo = ZivoraDB.usuarioActual()
    if (!yo || yo.rol !== "admin") return
    const { formato, esc, ESTADOS } = ZivoraDB
    const $ = (s) => document.querySelector(s)
    const CATEGORIAS = ["Desayunos", "Almuerzos", "Bebidas", "Otros"]
    let productos = []

    /* ---------- pestañas ---------- */
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("activo", x === t))
        document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("oculto", p.id !== "tab-" + t.dataset.tab))
    }))

    /* ---------- estadísticas ---------- */
    async function pintarStats() {
        const s = await ZivoraDB.admin.stats()
        if (!s.ok) return
        const tarjetas = [
            ["Pedidos", s.pedidos], ["Ventas", formato(s.ventas)], ["En proceso", s.pendientes],
            ["Productos", s.productos], ["Usuarios", s.usuarios]
        ]
        $("#stats").innerHTML = tarjetas.map(([t, v]) => `<div class="stat"><small>${t}</small><strong>${v}</strong></div>`).join("")
    }

    /* ---------- pedidos ---------- */
    async function pintarPedidos() {
        const lista = await ZivoraDB.admin.pedidos()
        if (!lista.length) { $("#tab-pedidos").innerHTML = '<p class="msg-vacio">Aún no hay pedidos.</p>'; return }
        $("#tab-pedidos").innerHTML = `<div class="tabla-wrap"><table>
            <tr><th>Pedido</th><th>Cliente</th><th>Productos</th><th>Entrega y pago</th><th>Total</th><th>Estado</th></tr>
            ${lista.map((p) => `<tr>
                <td><strong>#${esc(p.codigo)}</strong><br><small>${ZivoraDB.fecha(p.creado)} ${ZivoraDB.hora(p.creado)}</small></td>
                <td>${esc(p.usuario.nombre)}<br><small>${esc(p.usuario.correo)}</small></td>
                <td>${p.items.map((i) => `${i.cantidad} × ${esc(i.nombre)}`).join("<br>")}</td>
                <td>${esc(p.entrega.direccion)}<br><small>${esc(p.entrega.telefono)} · ${esc(p.metodoPago)}</small></td>
                <td>${formato(p.total)}</td>
                <td><select data-pedido="${p.id}">${ESTADOS.map((e) => `<option${e === p.estado ? " selected" : ""}>${e}</option>`).join("")}</select></td>
            </tr>`).join("")}
        </table></div>`
    }
    $("#tab-pedidos").addEventListener("change", async (e) => {
        const sel = e.target.closest("select[data-pedido]")
        if (!sel) return
        const r = await ZivoraDB.admin.cambiarEstado(Number(sel.dataset.pedido), sel.value)
        if (!r.ok) alert(r.error)
        pintarPedidos()
        pintarStats()
    })

    /* ---------- productos ---------- */
    $("#prod-categoria").innerHTML = CATEGORIAS.map((c) => `<option>${c}</option>`).join("")

    function limpiarFormProducto() {
        $("#form-producto").reset()
        $("#prod-id").value = ""
        $("#prod-activo").checked = true
        $("#prod-guardar").textContent = "Agregar producto"
        $("#prod-cancelar").classList.add("oculto")
    }

    async function pintarProductos() {
        productos = await ZivoraDB.admin.productos()
        $("#tabla-productos").innerHTML = `<div class="tabla-wrap"><table>
            <tr><th></th><th>Nombre</th><th>Categoría</th><th>Precio</th><th>Visible</th><th></th></tr>
            ${productos.map((p) => `<tr>
                <td class="mini">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" data-emoji="${esc(p.emoji || "🍽️")}">` : `<span class="emoji">${esc(p.emoji || "🍽️")}</span>`}</td>
                <td>${esc(p.nombre)}</td><td>${esc(p.categoria)}</td><td>${formato(p.precio)}</td>
                <td>${p.activo ? "Sí" : "No"}</td>
                <td><button class="btn peq" data-editar="${p.id}">Editar</button> <button class="btn peq sec" data-borrar="${p.id}">Eliminar</button></td>
            </tr>`).join("")}
        </table></div>`
    }

    $("#form-producto").addEventListener("submit", async (e) => {
        e.preventDefault()
        const id = Number($("#prod-id").value) || undefined
        const r = await ZivoraDB.admin.guardarProducto({
            id,
            nombre: $("#prod-nombre").value,
            precio: Number($("#prod-precio").value),
            categoria: $("#prod-categoria").value,
            emoji: $("#prod-emoji").value,
            imagen: $("#prod-imagen").value,
            activo: $("#prod-activo").checked
        })
        if (!r.ok) return alert(r.error)
        limpiarFormProducto()
        pintarProductos()
        pintarStats()
    })
    $("#prod-cancelar").addEventListener("click", limpiarFormProducto)

    $("#tabla-productos").addEventListener("click", async (e) => {
        const ed = e.target.closest("[data-editar]"), bo = e.target.closest("[data-borrar]")
        if (ed) {
            const p = productos.find((x) => x.id === Number(ed.dataset.editar))
            $("#prod-id").value = p.id
            $("#prod-nombre").value = p.nombre
            $("#prod-precio").value = p.precio
            $("#prod-categoria").value = p.categoria
            $("#prod-emoji").value = p.emoji || ""
            $("#prod-imagen").value = p.imagen || ""
            $("#prod-activo").checked = p.activo
            $("#prod-guardar").textContent = "Guardar cambios"
            $("#prod-cancelar").classList.remove("oculto")
            window.scrollTo({ top: 0, behavior: "smooth" })
        }
        if (bo && confirm("¿Eliminar este producto? Los pedidos anteriores se conservan.")) {
            const r = await ZivoraDB.admin.borrarProducto(Number(bo.dataset.borrar))
            if (!r.ok) return alert(r.error)
            pintarProductos()
            pintarStats()
        }
    })

    /* ---------- usuarios ---------- */
    async function pintarUsuarios() {
        const lista = await ZivoraDB.admin.usuarios()
        $("#tabla-usuarios").innerHTML = `<div class="tabla-wrap"><table>
            <tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Rol</th><th>Pedidos</th><th></th></tr>
            ${lista.map((u) => `<tr>
                <td>${esc(u.nombre)}</td><td>${esc(u.correo)}</td><td>${esc(u.telefono)}</td>
                <td>${u.rol === "admin" ? "Administrador" : "Cliente"}</td><td>${u.pedidos}</td>
                <td>${u.id === yo.id ? "<small>(tú)</small>" : `<button class="btn peq sec" data-borrar-usuario="${u.id}">Eliminar</button>`}</td>
            </tr>`).join("")}
        </table></div>`
    }

    $("#form-usuario").addEventListener("submit", async (e) => {
        e.preventDefault()
        const r = await ZivoraDB.admin.crearUsuario({
            nombre: $("#usr-nombre").value, correo: $("#usr-correo").value, telefono: $("#usr-telefono").value,
            contrasena: $("#usr-pass").value, rol: $("#usr-rol").value
        })
        if (!r.ok) return alert(r.error)
        $("#form-usuario").reset()
        pintarUsuarios()
        pintarStats()
    })

    $("#tabla-usuarios").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-borrar-usuario]")
        if (!b || !confirm("¿Eliminar este usuario?")) return
        const r = await ZivoraDB.admin.borrarUsuario(Number(b.dataset.borrarUsuario))
        if (!r.ok) return alert(r.error)
        pintarUsuarios()
        pintarStats()
    })

    pintarStats()
    pintarPedidos()
    pintarProductos()
    pintarUsuarios()
})()