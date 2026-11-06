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

Mantener `PAYMENTS_ENABLED=false` y dejar `WEBHOOK_SECRET` y `PAYMENTS_CHECKOUT_BASE_URL` vacíos. `PAYMENTS_PROVIDER=SIMULADOR` describe configuración y no habilita un proveedor externo. El comando de arranque y la prueba aislada de entorno no sustituyen la evidencia PostgreSQL, Redis, navegador y revisión cruzada de la versión final.

## Preparar una versión

1. Integrar contratos y dependencias en el orden de [VICTOR_DELIVERY.md](../../docs/VICTOR_DELIVERY.md). Actualizar la rama y obtener la revisión delegada del código final; Nicolás decide su aceptación.
2. Ejecutar en instalación limpia:

   ```bash
   npm ci
   npm run typecheck
   npm run lint
   npm test
   npm run build
   npx playwright install --with-deps chromium
   npm run test:e2e
   ```

   Las pruebas backend requieren PostgreSQL con PostGIS y Redis aislados. El job navegador usa respuestas controladas explícitas y no necesita una base compartida. Si falta un servicio o comando, registrar **no ejecutado/fallido**, no sustituirlo con un health fijo.
   En una construcción candidata de staging, establecer antes `GANADITO_RELEASE_SHA` al resultado de `git rev-parse HEAD` en el entorno del proceso de build. Construir y registrar el mismo checkout revisado; no etiquetar un árbol con cambios pendientes como si correspondiera al SHA publicado.
3. Registrar la identidad del artefacto desde un checkout sin cambios pendientes:

   ```bash
   git status --short
   git rev-parse HEAD
   git log -1 --format=%cI
   node --version
   npm --version
   ```

   En PowerShell, inventariar migraciones y su contenido sin ejecutarlas:

   ```powershell
   Get-ChildItem -LiteralPath infrastructure/database/migrations -Filter '*.sql' |
     Sort-Object Name | Select-Object Name
   Get-ChildItem -LiteralPath infrastructure/database/migrations -Filter '*.sql' |
     Sort-Object Name | Get-FileHash -Algorithm SHA256
   Get-FileHash -LiteralPath package-lock.json -Algorithm SHA256
   ```

   En Bash:

   ```bash
   git ls-files infrastructure/database/migrations
   sha256sum infrastructure/database/migrations/*.sql package-lock.json
   ```
4. Copiar [release-record.example.md](release-record.example.md) a un registro de versión sin secretos. Registrar SHA web, SHA API, contrato, hashes, migraciones realmente aplicadas, resultados y versión anterior recuperable. Nicolás confirma el estado real de la base; la lista de archivos no demuestra aplicación.
5. Confirmar host, entorno, base ficticia aislada, origen REST y ruta WS. Usar el arranque N01 anterior y coordinar con Nicolás migraciones y workers. Registrar la API como operativa únicamente después de verificar el recorrido real del SHA revisado.
6. El responsable de staging despliega únicamente el artefacto revisado en el entorno autorizado. Este runbook no autoriza producción ni crea un despliegue automático en CI.

## Recorrido real sobre web compilada

El job `browser-real` usa web 4180, API 4181, PostGIS 16-3.4 y Redis 7 recién creados por CI. Usa cuentas ficticias, pagos apagados y transporte WS web apagado. `npm run test:e2e:real` exige las guardias de [DEVELOPMENT.md](../../docs/DEVELOPMENT.md) y un `GANADITO_RELEASE_SHA` de 40 caracteres que CI inyecta desde `github.sha`. Nunca ejecutarlo contra PostgreSQL local existente, una base compartida o Neon; el nombre de una base por sí solo no acredita que sea efímera.

`tests/e2e/real/web.mjs` aplica las guardias antes de importar Vite. Construye adapter-node con las mismas dependencias de la web, sin evaluar el archivo Vite que carga `.env`: tanto Vite como SvelteKit usan un directorio temporal vacío para las variables. El proceso web recibe solo la configuración permitida y el upstream `http://127.0.0.1:4181`, sin credenciales API/DB. El launcher verifica el SHA generado en `build/client/_app/version.json`, registra únicamente `release_sha` en `test-results/real/release.json` y ejecuta `build/index.js`. La prueba compara ese registro con `/_app/version.json` servido. La API usa su launcher aislado con `logger: false`; capturas, vídeos y trazas permanecen desactivados y el job no sube artefactos de autenticación.

El recorrido autorizado utiliza únicamente las rutas HTTP existentes para crear datos ficticios. No inserta SQL, no ejecuta seeds y no intercepta respuestas de negocio. Bloquea solamente las teselas externas del mapa. Cubre:

- Registro/acceso, publicación web, puja persistida e idempotencia, cierre automático por el worker y orden `PENDIENTE_PAGO`, todos sobre el mismo lote publicado desde la interfaz.
- Recuperación de sesión, precio y secuencia oficiales mediante HTTP tras una recarga real; rechazo opaco 404 de una orden frente a otra organización y checkout 503 mientras los pagos están desactivados.
- Dos organizaciones ficticias, un ESTABLO fuera de la rejilla y un establecimiento público con cotizaciones. Consultas anónimas, ajenas y propietarias verifican coordenadas aproximadas y dirección null para el establo ajeno, precisión y dirección propias, y precisión pública para el otro establecimiento. El navegador verifica avisos, área del mapa, lista, popup y selección Spot.
- Pasaporte propietario COMPLETA con metadata privada y hashes encadenados, y verificación de integridad del servidor. La API PUBLICA anónima/ajena devuelve autor y organización null, metadata permitida o redactada y omite ambos hashes; se comprueban también 401 y 404. La ruta pública web sigue desactivada y no consulta pasaportes.

La suite con fixtures cubre además errores, ausencias y respuestas malformadas. La prueba real y la compilación acreditan exclusivamente el artefacto y las rutas probadas del SHA final en servicios efímeros. No acreditan un host de staging, recuperación del host ni un rollback externo: esas acciones requieren host y autorización separados, y su evidencia se anota en el [registro de versión](release-record.example.md).

La API integrada incluye tickets de un solo uso, validación de membresía vigente y supervisión de revocación; esa implementación no habilita automáticamente el consumidor WS del navegador. Su adaptación y aceptación con expiración, cambio de contexto, Bearer/ticket según el cliente y revocación siguen fuera de este recorrido HTTP. No usar la antigua observación sobre logs como descripción del estado actual.

La entrega se cuenta sobre **24 criterios: 18 técnicos y 6 aceptaciones humanas**. Una CI verde puede sustentar criterios técnicos según la matriz, pero no registra las seis aceptaciones ni declara 24/24. El resultado del SHA final y la decisión de Nicolás se documentan por separado.

## Recuperación sin pérdida de datos

1. Registrar incidente, entorno, SHA afectado, último SHA aceptado y síntomas. Suspender promoción de la versión y coordinar escrituras/worker con Nicolás si el fallo afecta transacciones.
2. Identificar el artefacto anterior y sus migraciones compatibles en el registro de versión. Verificar si el cambio es solo web o también API/esquema. No ejecutar SQL inverso ni reiniciar una base para arreglar una pantalla.
3. Si el esquema es compatible, el responsable del host vuelve a desplegar el artefacto anterior identificado por SHA y conserva las variables del entorno. Anotar ID del despliegue y hora. No usar `git reset --hard`, force-push ni borrado de volúmenes como recuperación operativa.
4. Si el esquema es incompatible o se sospecha pérdida de datos, Nicolás prepara una corrección hacia adelante o restauración coordinada sobre una copia aislada. Un snapshot de Neon no se restaura ni sobrescribe sin autorización explícita. No alterar migraciones ya aplicadas.
5. Verificar acceso, recuperación HTTP y recarga del snapshot, lectura de órdenes y privacidad en la versión recuperada, además de una operación PostgreSQL coordinada con Nicolás. Confirmar que órdenes y efectos no se duplicaron y que pagos siguen desactivados. Validar WS por separado cuando esté autorizado y habilitado.
6. Registrar responsable, resultado, SHA recuperado, impacto y acciones pendientes. Reabrir promoción solo tras checks y revisión cruzada.

## Migraciones presentes en la base dde293b

1. `0001_initial_schema.sql`
2. `0002_ordenes_compra.sql`
3. `0003_pagos_transacciones.sql`
4. `0004_liquidaciones_vendedores.sql`
5. `0005_trazabilidad_bovina.sql`
6. `0006_compras_mayoristas_pools.sql`
7. `0007_gmx_ordenes_matching.sql`
8. `0008_logistica_fletes.sql`
9. `0009_integraciones_tributarias_financieras.sql`

Este inventario es de archivos versionados, no un registro de ejecución. Nicolás mantiene migraciones y seeds, identifica versiones aplicadas y coordina cualquier cambio en staging.

La integración N01–N05 añade `0010_contexto_activo_unico.sql` y `0011_pujas_organizacion_postora.sql`, incluidas sin modificaciones desde la rama de Nicolás. La CI real usa el arranque versionado sobre DB efímera; confirmar por separado el historial aplicado en staging.
