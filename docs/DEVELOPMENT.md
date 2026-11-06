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
npm run dev:web -- --host 127.0.0.1 --port 4173 --strictPort
```

En Bash:

```bash
PUBLIC_API_URL='' API_INTERNAL_URL=http://127.0.0.1:4000 npm run dev:web -- --host 127.0.0.1 --port 4173 --strictPort
```

Abrir `http://127.0.0.1:4173`. Una API no disponible debe mostrarse como error con reintento. No habilitar datos demo como fallback ni completar resultados de negocio localmente. Los módulos de etapas posteriores que aún usan simulación no acreditan una integración real.

## PostgreSQL/PostGIS y Redis de desarrollo

Si Docker está instalado, los servicios locales definidos por Nicolás se administran con:

```bash
docker compose -f infrastructure/docker/compose.yaml up -d
docker compose -f infrastructure/docker/compose.yaml ps
docker compose -f infrastructure/docker/compose.yaml logs -f
```

Para detener sin borrar volúmenes:

```bash
docker compose -f infrastructure/docker/compose.yaml down
```

Nicolás mantiene Docker, migraciones y seeds. No ejecutar cambios de esquema o `npm run seed` contra una base compartida o un proyecto Neon sin confirmar entorno, permiso y datos ficticios. No usar `down -v` para solucionar una pantalla. Si Docker o PostgreSQL/Redis no están disponibles, registrar esa limitación; el navegador aislado sigue siendo una verificación distinta.

## API y workers: arranque N01 de integración

Desde la raíz, con Node 24 y después de confirmar los destinos de PostgreSQL/PostGIS y Redis con datos ficticios:

```bash
npm run dev:api
```

Ejecuta `apps/api/src/server.ts` mediante `tsx` y reinicia al cambiar archivos. Para arrancar sin vigilancia:

```bash
npm run start:api
```

Ambos scripts trabajan desde `apps/api` y usan `--env-file-if-exists=../../.env`: no exigen el archivo y las variables inyectadas por el host prevalecen. El ejemplo fija `API_HOST=127.0.0.1` y `API_PORT=4000`, coherentes con `API_INTERNAL_URL=http://127.0.0.1:4000`; configurar ambos explícitamente al cambiar el destino. La actualización N01 `ba8eb8d` también fija `4000` por defecto; el host sin configurar es `0.0.0.0`.

| Variable | Arranque y precaución |
|---|---|
| `RUN_MIGRATIONS_ON_START=false` | El ejemplo impide aplicar migraciones al arrancar. Activarla solo en local ficticio o staging coordinado, tras confirmar destino y autorización con Nicolás. Si falta, N01 migra fuera de producción. |
| `START_WORKERS=false` | El ejemplo impide iniciar outbox y cierre automático. Activarla solo en local ficticio o staging coordinado con Nicolás; si falta, N01 inicia ambos workers. Sin ellos no se acredita entrega de eventos ni cierre automático. |
| `PAYMENTS_ENABLED=false` | Mantener los pagos desactivados, `PAYMENTS_PROVIDER=SIMULADOR` y dejar `PAYMENTS_CHECKOUT_BASE_URL` y `WEBHOOK_SECRET` vacíos. Estos valores no habilitan cobros. |

N01 verifica PostgreSQL antes de escuchar y falla si no responde. Los workers y conexiones se cierran con `SIGINT`/`SIGTERM`. No ejecutar estos comandos con una base compartida o Neon sin autorización; no ejecutar seeds como parte del arranque. La prueba `node --test tests/e2e/runtime-config.test.mjs` usa una sonda TypeScript y `.env` ficticios en un directorio temporal para verificar carga, precedencia y ausencia del archivo, sin conectar servicios. Esa prueba no acredita una operación PostgreSQL; el recorrido real de aceptación sigue siendo una verificación separada.

## Calidad y navegador

Desde la raíz:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:e2e:http
npm run test:config
```

- `npm test` ejecuta pruebas backend y requiere servicios locales/CI aislados. No usar una base de producción para pasar tests.
- `npm run lint` coordina scripts presentes; un paquete sin script no queda validado por omisión.
- `npm run test:e2e` usa `tests/e2e/playwright.config.ts` y arranca la web en `127.0.0.1:4173`. Sus respuestas controladas están identificadas como fixtures y no conectan Neon ni staging.
- `npm run test:e2e:http` prueba por separado el transporte HTTP predeterminado en `4174`. `test:config` comprueba los scripts con un `.env` ficticio y el rechazo de destinos inseguros sin conectar a la API.
- La evidencia de navegador se escribe en `playwright-report/` y `test-results/`. CI conserva esos artefactos durante siete días; no adjuntar secretos o datos reales.
- Las pruebas con fixtures verifican interfaz y solicitudes. La concurrencia, idempotencia persistida, separación entre organizaciones y generación real de órdenes requieren tests de Nicolás y un recorrido conjunto con la API.

Ver comandos, registro de versión, inventario de migraciones y recuperación en el [runbook de staging](../infrastructure/deployment/README.md). Los resultados reales pertenecen al PR y al registro de versión, no se deducen de esta lista.

### Navegador con API y persistencia reales en CI

`npm run test:e2e:real` usa una configuración separada (`tests/e2e/real/playwright.config.ts`), web `4180` y API `4181`. El job `browser-real` crea PostGIS 16-3.4 y Redis 7 efímeros. El launcher rechaza el destino antes de importar backend si falta `GANADITO_ALLOW_REAL_E2E=isolated-local-fixtures`, `NODE_ENV=test`, `PAYMENTS_ENABLED=false`, DATABASE_URL literal loopback con base exacta `ganadito_e2e_test` o Redis loopback `/15`. No admite query, fragmentos ni hosts remotos, y no carga `.env` del desarrollador.

La web real se construye con adapter-node, no con Vite dev. El launcher exige además `GANADITO_RELEASE_SHA` de 40 caracteres hexadecimales; CI inyecta `${{ github.sha }}` y verifica `_app/version.json`. Se aísla el entorno de build y se carga únicamente una lista permitida en el proceso web, sin credenciales de API/DB ni `.env` locales. `web.mjs --build-only` permite comprobar solo ese artefacto con un entorno ficticio que satisfaga las mismas guardias, sin arrancar API ni conectar PostgreSQL/Redis. La suite incluye privacidad mapa/Spot por actor, pasaporte privado y API pública sin hashes; no activa la ruta pública web ni WS.

La suite crea cuentas ficticias por API/UI, publica desde la web, envía una puja desde el navegador, comprueba el reintento persistido, espera al worker real y consulta la orden autorizada. Verifica 404 indistinguible para otra organización y pagos 503. No usa seeds, SQL de preparación ni cierre administrativo. Las migraciones versionadas las ejecuta N01 únicamente contra el servicio efímero de ese job. No ejecutar el comando contra bases de desarrollo existentes, compartidas o Neon. Trazas, vídeo, capturas y subida de artefactos del recorrido real están apagados para no conservar credenciales.

## Diagnóstico

| Síntoma | Comprobación y respuesta |
|---|---|
| Web muestra error de API | Comprobar el origen configurado y que N01 esté disponible; no activar demo automáticamente. |
| 401 o sesión expirada | Mostrar expiración y volver a acceder; no renovar ni fabricar permisos localmente. |
| 403 o contexto cambió | Mostrar falta de acceso/contexto; comprobar sesión y membresía con la API. |
| WS desconectado | Revisar origen y Upgrade del proxy; recuperar snapshot oficial tras conectar antes de reanudar la interacción. |
| Órdenes no disponibles | La integración N04 ya incluye GET de lista/detalle. Revisar sesión, organización, estado HTTP y destino API; un 404 no revela pertenencia. Conservar error o ausencia sin inventar órdenes. |
| Puerto 4173 ocupado | Detener el proceso propio o acordar otro puerto y actualizar su configuración; no terminar procesos ajenos. |
| Fallan tests de DB/Redis | Confirmar servicios y variables del entorno de pruebas; registrar fallo completo. |

La aceptación final exige CI del SHA final, revisión de Nicolás y pruebas web + API real con datos ficticios. Ver [VICTOR_DELIVERY.md](VICTOR_DELIVERY.md).
