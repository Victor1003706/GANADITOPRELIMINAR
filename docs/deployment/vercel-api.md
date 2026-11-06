# Despliegue piloto de la API en Vercel

El proyecto raíz se despliega como una función HTTP bajo `/api/*`. La ruta `/health`
se reescribe a `/api/health`. El adaptador envía el flujo HTTP directamente a Fastify,
sin levantar el servidor de larga duración ni los workers de `src/server.ts`.

## Configuración del proyecto

- Repositorio: `Victor1003706/GANADITOPRELIMINAR`
- Directorio raíz: `.` (raíz del monorepo)
- Runtime: Node.js 24
- Build: `npm run build`
- Región de función sugerida: `gru1` (São Paulo), próxima a Neon `aws-sa-east-1`

## Variables de entorno

Configurar como secretos de Vercel, en Preview y Production:

- `DATABASE_URL`: URL TLS de Neon usando el rol de runtime de privilegios limitados.
- `DATABASE_POOL_MAX=1`: restringe conexiones por instancia.
- `JWT_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `PAYMENTS_ENABLED=false`: mantiene pagos desactivados.

No configurar `DATABASE_MIGRATION_URL` ni ejecutar migraciones al iniciar la función. Las
migraciones se aplican por separado con un rol de migración cuando corresponda. Nunca
incluir URLs ni contraseñas en este archivo o en el repositorio.

## Límites de esta publicación gratuita

Esta función sirve las rutas HTTP/REST. No inicia Redis, workers de outbox ni el cierre
programado de subastas. El WebSocket de subastas en vivo y el procesamiento en segundo
plano necesitan un servicio persistente y Redis/pub-sub. El plan gratuito puede tener
límites de uso y no ofrece garantía de disponibilidad continua. Confirmar el uso permitido
por el plan antes de operar comercialmente.
