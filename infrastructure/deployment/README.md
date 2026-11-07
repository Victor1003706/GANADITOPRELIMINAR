# Preparación de staging y recuperación

Este directorio prepara V06. No activa producción, no provisiona servicios ni ejecuta migraciones en una base compartida. Un despliegue requiere un host autorizado, contratos revisados y la revisión del código final conforme a [OWNERSHIP.md](../../docs/OWNERSHIP.md). Nicolás conserva la decisión final y Claude revisa cada PR por su encargo. Ver [solicitudes de integración](../../docs/CONTRACT_REVIEW.md).

## Configuración por entorno

| Variable / recurso | Desarrollo | Staging |
|---|---|---|
| `PUBLIC_API_URL` | Vacío: REST al mismo origen y proxy Svelte. | Vacío para proxy del servidor; si se define un origen público, debe estar autorizado y soportar las peticiones de sesión. Nunca contiene secretos. |
| `API_INTERNAL_URL` | `http://127.0.0.1:4000`, solo servidor. | Origen privado/autorizado de la API; configurar en el host del servidor web. No exponer credenciales en variables `PUBLIC_*`. |
| `PUBLIC_WS_URL` | Opcional: origen `ws://` o `wss://`; sin él se usa el origen web. El proxy Vite de desarrollo reenvía WS a `API_INTERNAL_URL`. | Origen `wss://` autorizado o reverse proxy que admita Upgrade de `/api/v1/subastas/:id/live`. El proxy REST de Svelte no sustituye el proxy WS. |
| `PUBLIC_LIVE_AUCTIONS_ENABLED` | `false`: snapshots HTTP y pujas REST. | Conservar `false` hasta integrar y aceptar el consumidor web del contrato de tickets, membresía vigente y revocación. Bearer es la alternativa del contrato para clientes que pueden enviar cabeceras de Upgrade. |
| `DATABASE_URL` o `DATABASE_*` | Solo API/servicios locales con datos ficticios. | Secretos del host de API, base de staging aislada confirmada por Nicolás. No reutilizar por coincidencia un proyecto Neon existente. |
| `REDIS_URL` o `REDIS_*` | Solo API/workers locales. | Redis de staging; PostgreSQL conserva la autoridad de estado. |
| `JWT_SECRET` | Valor ficticio de desarrollo. | Secreto propio del entorno administrado fuera de Git; N01 debe rechazar configuración insegura. |
| `GANADITO_RELEASE_SHA` | Opcional, `development` si falta. | SHA completo del código revisado, inyectado al construir la web y registrado junto al artefacto. |
| Pagos y servicios externos | Desactivados en este recorrido. | Desactivados hasta habilitación, contrato y pruebas separadas. No inferir que una variable habilita el cobro. |

El servidor web usa `@sveltejs/adapter-node` `6.0.1` con SvelteKit `3.1.1`. `npm run start --workspace=@ganadito/web` ejecuta el artefacto `build/index.js` desde la web; el host debe configurar el entorno del proceso y enrutar REST/WS. El `build` por sí solo no demuestra que el host soporte proxy REST, secretos de servidor ni WebSocket. No usar el servidor Vite de desarrollo como servidor de staging.

## Arranque API de integración

Con Node 24, `npm run start:api` ejecuta `apps/api/src/server.ts` mediante `tsx`; `npm run dev:api` añade vigilancia para desarrollo. Los scripts cargan el `.env` de la raíz si existe y conservan las variables inyectadas por el host. No copiar un `.env` local a staging: inyectar la configuración del entorno autorizado.

El ejemplo local fija `API_HOST=127.0.0.1`, `API_PORT=4000` y `API_INTERNAL_URL=http://127.0.0.1:4000`. Ajustar el host privado de escucha y el destino del proxy de forma coordinada en staging. Establecer expresamente `RUN_MIGRATIONS_ON_START=false` hasta que Nicolás confirme el destino y la estrategia de migración; N01 migra por defecto fuera de producción. El ejemplo también fija `START_WORKERS=false`: Nicolás coordina su activación para outbox y cierre automático, que por defecto N01 inicia si falta esa variable. Activar ambos flags solo en local ficticio o staging coordinado. El servidor comprueba PostgreSQL antes de escuchar y cierra conexiones y workers con `SIGINT`/`SIGTERM`.

Mantener `PAYMENTS_ENABLED=false` y dejar `WEBHOOK_SECRET` y `PAYMENTS_CHECKOUT_BASE_URL` vacíos. `PAYMENTS_PROVIDER=SIMULADOR` describe configuración y no 