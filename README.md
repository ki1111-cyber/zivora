# ZIVORA

Tienda de domicilios con **Node + Express + MySQL**.

## Cómo ponerlo a funcionar

1. Instala [Node.js](https://nodejs.org) y MySQL (o XAMPP/MariaDB) y deja MySQL encendido.
2. Crea las tablas (una sola vez):
   ```
   mysql -u root -p < schema.sql
   ```
3. Copia `.env.example` como `.env` y pon tu usuario/contraseña de MySQL.
4. Instala y arranca:
   ```
   npm install
   npm start
   ```
5. Abre http://localhost:3000

Al primer arranque el servidor crea los 32 productos y estos usuarios:

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@zivora.com | 38863671admin |
| Cliente demo | usuario@gmail.com | 1234abc |

(Cambia la contraseña del admin antes de publicar el sitio.)

## Estructura

- `server.js` – API y servidor web.
- `schema.sql` – tablas: usuarios, sesiones, productos, carrito, pedidos, pedido_items, pedido_historial.
- `public/` – el sitio (HTML, CSS, `db.js` = cliente de la API, `app.js`, `admin.js`).
- `seed.json` – productos iniciales.

## Notas

- Las contraseñas se guardan cifradas (scrypt), no en texto plano.
- El domicilio cuesta $3.000 (constante `DOMICILIO` en `server.js`).
- `recuperar.html` cambia la contraseña con solo el correo (como estaba en tu diseño); para un sitio real habría que verificar por email.
