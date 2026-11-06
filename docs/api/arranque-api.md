# Arranque de la API (N01)

## Requisitos
- PostgreSQL 16 + PostGIS 3.4 y Redis 7 en ejecución (`infrastructure/docker/compose.yaml`).
- Variables de entorno (ver `.env.example`):
  - `DATABASE_URL` o `DATABASE_*`
  - `REDIS_URL` o `REDIS_*`
  - `API_PORT` (por defecto 4000, igual que `.env.example` y `PUBLIC_API_URL`) y `API_HOST` (por defecto `0.0.0.0`)
  - `JWT_SECRET`: **obligatorio en producción**, mínimo 32 caracteres. Fuera de producción, si falta, se usa un valor de desarrollo.
  - `RUN_MIGRATIONS_ON_START`: por defecto `true` fuera de producción y `false` en producción.
  - `START_WORKERS`: por defecto `true`.

## Comandos
Desde `apps/api`:
```bash
npx tsx src/server.ts
```
Comprobación:
```bash
curl http://localhost:4000/health
```
- `200`: `{ "status": "ok", "db": "ok", ... }`
- `503`: la base de datos no responde.

**Pedido a Víctor (manifiestos):** en `apps/api/package.json`, `"dev": "tsx watch src/server.ts"` y `"start": "tsx src/server.ts"`.

## Interruptores de módulos simulados
| Variable | Por defecto | Efecto |
|---|---|---|
| `PAYMENTS_ENABLED` | `false` | Pagos apagados: `/pagos/checkout` responde 503. |
| `TAX_INTEGRATIONS_ENABLED` | `false` | SUNAT y CAVALI son **simuladores**: sus escrituras (`POST /tributario/*`, `POST /fintech/cavali/*`) responden `503 INTEGRACION_DESHABILITADA`. Las lecturas siguen activas. |

## Qué hace al iniciar
1. Valida la configuración. Si falta `JWT_SECRET` en producción, o pagos está habilitado sin `WEBHOOK_SECRET`, **no arranca**.
2. Ejecuta `SELECT 1` contra PostgreSQL. Si falla, sale con código 1.
3. Aplica las migraciones pendientes. Quedan registradas en `schema_migrations` con su checksum SHA-256. Si una migración ya aplicada fue modificada, el arranque falla: hay que crear una migración nueva. Un advisory lock serializa varias réplicas.
4. Escucha HTTP y WebSocket.
5. Arranca los workers:
   - **Outbox:** publica los eventos confirmados en Redis.
   - **Cierre de subastas:** cada 5 s cierra los lotes vencidos y genera las órdenes `PENDIENTE_PAGO`.

## Parada
Con `SIGINT` o `SIGTERM`:
1. Detiene los workers y espera a que termine el lote en curso.
2. Cierra HTTP y WebSocket.
3. Cierra Redis y el pool de PostgreSQL.

Si tarda más de 10 s, fuerza la salida con código 1.

## Invariantes
- Redis no es fuente de verdad. Si Redis cae, las pujas y los cierres se confirman igual en PostgreSQL. Los eventos quedan en `outbox_events` y se reintentan con backoff.
- Varias réplicas pueden correr los workers a la vez: el outbox usa leases con fencing token, y el cierre usa `FOR UPDATE SKIP LOCKED`.
