# Desarrollo local de Ganadito

Base de revisión: `dde293bc977ac090d631b6c90a2cb4bb6efcb40e`. Las instrucciones siguientes distinguen web, pruebas aisladas y API real. El reparto está en [OWNERSHIP.md](OWNERSHIP.md).

## Instalar desde un clon

```bash
git clone https://github.com/Nicolas923-source/Ganadito.git
cd Ganadito
node --version
npm --version
git --version
npm ci
```

Usar Node fijado en `.nvmrc` y npm compatible con `package.json`; registrar las versiones realmente ejecutadas. No actualizar dependencias o borrar el lockfile para resolver una instalación: Víctor mantiene manifiestos/lockfile en un PR separado. Si la descarga falla, revisar conectividad, versión y error exacto; repetir `npm ci` con el mismo lockfile una vez resuelta la causa.

### Bootstrap de SvelteKit 3

La integración web usa las versiones resueltas del lockfile: SvelteKit `3.1.1`, adaptador Node `6.0.1`, TypeScript `6.0.3` y Playwright `1.64.1`. SvelteKit `3.1.1` declara TypeScript `^6.0.0` como peer; el TypeScript `^5.7.3` de la base era incompatible. El cambio de manifiestos y lockfile debe revisarse en el PR de dependencias separado.

`apps/web/src/env.ts` declara las variables mediante `defineEnvVars`; el código usa `$app/env/public` y `$app/env/private`. `vite.config.ts` configura SvelteKit y el adaptador Node; `svelte-kit sync` se ejecuta antes de `svelte-check` para generar tipos y configuración. No copiar convenciones de SvelteKit anteriores para resolver un error de esta versión.

Para construir un artefacto web Node y arrancarlo después de configurar el entorno del proceso:

```bash
npm run build --workspace=@ganadito/web
npm run start --workspace=@ganadito/web
```

El segundo comando ejecuta `node build/index.js` desde `apps/web`. Para staging se necesita la configuración de host/proxy y los secretos del entorno descritos en el runbook; no equivale a habilitar producción. El arranque API y workers de la integración N01 se describe abajo; su aceptación requiere el recorrido real y revisión cruzada.

## Variables locales

PowerShell:

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
```

Bash:

```bash
cp .env.example .env
```

No sobrescribir un `.env` existente. Mantenerlo ignorado por Git. Los scripts API de esta integración cargan el `.env` de la raíz si existe y respetan los valores ya inyectados en el proceso; copiar el archivo no acredita conectividad ni autoriza migraciones.

| Variable | Consumidor / comportamiento |
|---|---|
| `PUBLIC_API_URL` | Navegador. Vacío usa REST del mismo origen. Si se configura, es un origen público autorizado, sin secretos. |
| `API_INTERNAL_URL` | Servidor web/proxy de desarrollo; origen API, por defecto `http://127.0.0.1:4000`. No es variable pública. |
| `PUBLIC_WS_URL` | Origen WS opcional para el transporte habilitado explícitamente; sin él se usa el origen web. |
| `PUBLIC_LIVE_AUCTIONS_ENABLED` | `false` por defecto: snapshots HTTP periódicos y pujas REST. No habilitar WS hasta corregir la exposición del token en logs descrita en la revisión de N04. Los fixtures prueban también el modo opt-in. |
| `DATABASE_URL` o `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` | API y pruebas backend; PostgreSQL/PostGIS ficticio aislado. No exponer al navegador. |
| `REDIS_URL` o `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | API y workers; Redis auxiliar. |
| `JWT_SECRET` | API; secreto del entorno, nunca en Git. N01 debe confirmar validación segura de configuración. |
| `GANADITO_RELEASE_SHA` | Build web; configura el nombre de versión SvelteKit con el SHA revisado. Sin valor, la versión se identifica como `development`. |

La aplicación web puede leer variables desde su entorno SvelteKit. Para una prueba explícita en PowerShell, definir el entorno del proceso que arranca la web:

```powershell
$env:PUBLIC_API_URL=''
$env:API_INTERNAL_URL='http://127.0.0.1:4000'
npm run dev:web -- --host 127.0.0.1 --port 4173 --strictP