# Fried Chunks UI

PWA mobile-first construida con React, TypeScript y Vite.

```sh
docker compose --env-file .env.local up --build
```

La página `/` queda disponible en `http://localhost:3000`. Lee el catálogo de
la API, crea el checkout desde cada producto y maneja las rutas
`/payment/success`, `/payment/failure` y `/payment/pending`. Si el usuario vuelve
a `/` sin pagar, muestra el checkout como no completado.

La imagen final usa Nginx y lee `PORT` al iniciar. Railway puede inyectar su
puerto dinámico sin ejecutar Node en producción.

Para producción local:

```sh
docker compose --env-file .env.prod up --build
```
