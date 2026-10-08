# Fried Chunks UI

PWA mobile-first construida con React, TypeScript y Vite.

```sh
docker compose --env-file .env.local up --build
```

La página `/` queda disponible en `http://localhost:3000`. Lee el catálogo de
la API y ofrece navegación con React Router por `/menu`, `/menu/:productId`,
`/cart`, `/orders` y `/orders/:orderId`. El carrito y los identificadores de los
pedidos realizados desde el dispositivo se conservan en IndexedDB; precios,
disponibilidad y estados siempre se confirman contra la API.

Las rutas `/payment/success`, `/payment/failure` y `/payment/pending` procesan el
regreso desde Mercado Pago. Si el usuario vuelve sin pagar, el checkout se
muestra como no completado y permanece visible en Mis pedidos.

La imagen final usa Nginx y lee `PORT` al iniciar. Las llamadas del navegador a
`/api` se reenvían mediante `API_UPSTREAM`; esto mantiene la cookie de sesión en
el mismo dominio de la PWA. En Railway, el valor predeterminado apunta a
`http://fried-chunks-api.railway.internal:8000` y puede sobrescribirse si cambia
el nombre del servicio. Railway puede inyectar su puerto dinámico sin ejecutar
Node en producción.

Para producción local:

```sh
docker compose --env-file .env.prod up --build
```
