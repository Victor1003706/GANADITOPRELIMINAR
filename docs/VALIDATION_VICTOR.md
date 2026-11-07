# Evidencia de la entrega de Víctor

> **Documento histórico.** Su estado fue reemplazado por [ACTA_ACEPTACION_V01_V06.md](ACTA_ACEPTACION_V01_V06.md) (PR #53) y por los PR #54–#58. Se conserva como evidencia; no describe el estado actual.

Base: `Nicolas923-source/Ganadito`, commit `dde293bc977ac090d631b6c90a2cb4bb6efcb40e`. Validación inicial del 3 de noviembre de 2026 y repetición completa el 4 de noviembre de 2026 (America/Bogota).

## Corte vigente — 5 de noviembre de 2026

[#51](https://github.com/Nicolas923-source/Ganadito/pull/51), código `cce1957` sobre main `5b73e470`, [CI 42029557812](https://github.com/Nicolas923-source/Ganadito/actions/runs/42029557812): cuatro jobs correctos. 208 API, 5 web, 39 configuración, 2 proxy, 85 fixtures más 2 HTTP, 49 Python, 2 recorridos reales. Web adapter-node compilada con SHA verificado, mismo lote UI→puja→worker→orden, recarga/aislamiento y privacidad mapa/Spot/pasaporte. Ninguna prueba real usó Neon ni PostgreSQL local existente. Una revisión independiente detectó y confirmó corregido el rechazo de eventos históricos y el lookup heredado en su visualización; no sustituye la revisión de Nicolás.

Los [24 hitos](HITOS_VICTOR_2026-11-05.md) tienen ahora 18 criterios con evidencia técnica y seis aceptaciones pendientes. Allí figuran los hallazgos nuevos de Nicolás #47/#48/#49/#50 y el tipo nullable #46 corregido bajo transferencia V05. No se repiten defectos ya resueltos ni se declara ausencia universal de fallos. Staging/producción, aceptación WS y pagos reales siguen separados; web WS y ruta pública web permanecen apagados. Los apartados siguientes son registros históricos. El PR enlaza la CI del HEAD final tras el commit documental.

## Ejecución programada: mismo lote publicado desde la web

La prueba real se amplió tras leer la foto y el PDF originales: el lote creado por el formulario web es ahora exactamente el mismo que se puja, cierra mediante worker y consulta como orden. Se retiró la segunda publicación API usada por la prueba histórica. Se añadió recuperación de sesión/snapshot tras recarga y rechazo opaco del detalle de la orden al ingresar desde la web con otra organización.

No se cambiaron reglas de negocio ni contratos: se conserva el anti-sniping predeterminado, se programa desde el formulario un cierre a dos o tres minutos y se espera al worker. La suite dispone de 270 segundos para este caso. Validación local sin DB: TypeScript focal correcto, un caso detectado, 30 guardias y 5 unitarios web correctos. Evidencia de CI del código final en [#37](https://github.com/Nicolas923-source/Ganadito/pull/37); el estado histórico de los apartados siguientes no sustituye esa comprobación.

La auditoría de propiedad, nuevas revisiones de Nicolás y límites están en [SEGUIMIENTO_FOTO_2026-11-04.md](SEGUIMIENTO_FOTO_2026-11-04.md). La revisión cruzada de Nicolás y los hallazgos de backend pendientes siguen siendo necesarios para aceptar la entrega.

Resultado posterior: [CI 41931985620](https://github.com/Nicolas923-source/Ganadito/actions/runs/41931985620) correcta en sus tres jobs, cabeza web `3a349f3` y merge de prueba `ca56977` con la nueva N05 `e657d77`. Backend 113/113, web 5/5, configuración 36/36, proxy 2/2, fixtures 58/58, HTTP 2/2 y recorrido real 1/1 (2.5 minutos). Este último ya publica, puja, recupera, cierra por worker y consulta la orden del mismo lote UI; también comprueba aislamiento API y navegador frente a organización ajena. Después se incorporó N05 original sin modificaciones; el HEAD final y su CI se fijan en #37. Las [recomendaciones](DECISIONES_PENDIENTES_FOTO_2026-11-04.md) se documentaron después de esta comprobación y siguen sin acuerdo.

## Seguimiento: instancia destruida y aprobación delegada

El propietario autorizó posteriormente que Codex registre aprobaciones de cambios de Nicolás revisados y comprobados. #27 ya estaba aprobado personalmente; #25 y #28 se aprobaron por delegación en los mismos SHA con CI exacta verde. #31 continúa sin aprobar por sus dependencias y falta de CI individual. Los PR con defectos y los propios de Víctor permanecen sin aprobación automática ni fusión.

Se reprodujo un defecto V03/V04: enviar una puja en A, navegar a B y regresar a A antes del recibo HTTP permitía que una instancia destruida del panel añadiera una puja al historial de la nueva visita. La regresión falló con una fila inesperada; navegar A→B sin regresar ya era correcto. La guardia `onDestroy` ahora descarta resultados tardíos de instancias destruidas sin cambiar decisiones de la API ni reintentos de un panel activo.

Checks locales del cambio: typecheck completo (web sin errores/advertencias), build completo, 5/5 unitarios web, 2/2 proxy compilado, 58/58 navegador con fixtures y 2/2 modo HTTP. Las dos regresiones esperan la entrega completa del recibo y navegación SPA. Revisión independiente sin bloqueantes; `git diff --check` correcto. La CI del HEAD publicado y el recorrido real se enlazan en [#37](https://github.com/Nicolas923-source/Ganadito/pull/37). No se probaron servicios reales contra PostgreSQL local existente ni Neon.

CI: las ramas de trabajo se verifican por `pull_request`, sin filtro de base; `push` se conserva para `main` y `workflow_dispatch` para ejecución manual. Esto evita disparar dos suites del mismo SHA por push y PR, que dejaban una ejecución cancelada y un resumen visual confuso. Se conservan los tres jobs y sus guardias de aislamiento.

## Integración posterior con N01–N05 — 4 de noviembre de 2026

Contrato #29 integrado en `2ffe7d4`; baseline original de Nicolás `26e8179` (N05 y dependencias), reunido con #35/#36 en la rama aislada `feature/victor/v04-v06-integracion-nicolas`. Esto no fusiona los PR de código en main ni acredita resolución de los [hallazgos](REVIEW_NICOLAS_2026-11-04.md).

| Comprobación de integración | Evidencia local |
|---|---|
| `npm run typecheck` | Todos los workspaces correctos; Svelte 0 errores y 0 advertencias. |
| `npm run build` | API, web Node, contratos y shared correctos. |
| `npm test --workspace=@ganadito/web` | 5/5 correctas: clave, snapshot, envelope público y recibo privado separados. |
| `npm run test:config` | 36/36 correctas: seis sondas de arranque/.env ficticio y treinta guardias de entorno real. No conectan DB. |
| `npm run test:proxy` | 2/2 correctas tras compilar. |
| `npm run test:e2e` | 56/56 correctas; omite los dos casos HTTP, ejecutados aparte. Fixtures explícitos. |
| `npm run test:e2e:http` | 2/2 correctas: modo HTTP predeterminado sin WebSocket/token en URL, snapshot y puja REST. |
| Regresiones rojo → verde | HTTP 200 inesperado no confirma registro/publicación/puja; 409 `IDEMPOTENCY_IN_PROGRESS` conserva la clave. Error 403 de paginación retira datos; cambio de contexto/ruta descarta respuestas anteriores. |
| Configuración del recorrido real | Un test detectado con `--list`; TypeScript focal correcto. Guardia rechaza antes del import backend. Su ejecución real se reserva al job efímero de CI. |
| API/DB/worker reales | Correctos en [CI 41884285818](https://github.com/Nicolas923-source/Ganadito/actions/runs/41884285818), SHA `17a3af775eded73dcca315d66722a4bed0d3ba59`: los tres jobs verdes. Monorepo incluye 108/108 pruebas backend con PostGIS/Redis; navegador real 1/1 correcto (47,9 s), fixtures 56/56 y HTTP 2/2. No se ejecutaron pruebas backend contra el PostgreSQL local existente ni Neon. |
| Revisión cruzada y staging | Pendientes; la revisión técnica del asistente detectó/corrigió el caso de idempotencia, pero no sustituye la revisión final de Nicolás. |

La nueva suite real cubre registro VENDEDOR y publicación web, acceso COMPRADOR, puja del navegador, reintento persistido, cierre automático, orden autorizada y rechazo 404 ajeno. Usa datos ficticios y pagos apagados. No se conservan trazas, vídeos ni capturas del recorrido real. El WS operativo permanece deshabilitado por el hallazgo de logs de N04; el pasaporte público sigue inactivo por los pendientes N05.

Versiones del recorrido: web/API/worker del mismo SHA `17a3af7`, backend original N05 `26e8179`, contrato `2ffe7d4`. El job real arranca N01 con `RUN_MIGRATIONS_ON_START=true` sobre un servicio PostGIS recién creado y las migraciones versionadas `0001`–`0011`; no es un registro de migraciones de staging. La evidencia posterior del HEAD final, incluida la consolidación de concurrencia de CI, se enlaza en el PR [#37](https://github.com/Nicolas923-source/Ganadito/pull/37).

## Evidencia de la entrega inicial #35/#36

| Comprobación | Resultado |
|---|---|
| Instalación del lockfile con `npm ci` | Correcta; Node 24.21.0, npm 11.19.0. |
| `npm run typecheck` | Correcto en todos los workspaces; web sin errores ni advertencias de Svelte. |
| `npm run build` | Correcto para API, web con adapter-node, contratos y shared. |
| `npm run lint` | Termina correctamente, pero la base no define reglas de lint en los workspaces. No equivale a una auditoría de estilo. |
| `npm test --workspace=@ganadito/web` | 3 pruebas unitarias correctas: idempotencia, snapshot ajeno/incompleto y eventos. |
| `npm run test:proxy` después del build | 2 pruebas correctas de la salida Node: entorno privado, Bearer, consulta, cuerpo POST e idempotencia; las cookies del navegador no se reenvían. |
| `npm run test:e2e` | 24 pruebas Chromium con respuestas controladas; ver suite y reporte local. No usa credenciales reales ni realiza cobros. |
| `git diff --check` | Correcto. |
| Salida Node de producción en localhost | Página de acceso visible en escritorio/móvil; proxy devuelve 502 claro con API apagada. |
| Backend con PostgreSQL/Redis reales | CI del PR de dependencias #35 correcta, incluido `npm test`, con PostGIS 16-3.4 y Redis aislados. [Ejecución 41830581839](https://github.com/Nicolas923-source/Ganadito/actions/runs/41830581839). El PostgreSQL local requiere credenciales no disponibles; no se ejecutaron pruebas que borran datos sobre ese servicio. |
| Recorrido web + API real | Pendiente de N01, contrato de lectura de órdenes y revisión conjunta. |
| Revisión final de Nicolás | Pendiente. No se autoaprueba esta entrega. |

Las pruebas de navegador cubren acceso, cambio de organización, recarga, revocación con JSON y sin JSON, discrepancia perfil/token, vencimiento durante cambio de contexto, navegación móvil, publicación confirmada, lote por ID, errores, puja rechazada, reintento idempotente, reconexión/snapshot, reloj sin adjudicación, consultas lentas, filtros, ausencia de datos, trazabilidad, autorización rechazada, respuestas malformadas y texto de mapa protegido frente a HTML. Dos regresiones adicionales reproducen y corrigen la habilitación de pujas y reintentos durante una reconexión: ambos esperan un snapshot solicitado con el socket actual abierto.

Los fixtures viven solo en `tests/e2e`. El modo operativo no usa sustitución automática por datos de demostración. Los módulos posteriores están deshabilitados, incluidos cobros y confirmaciones externas.

Neon: se inspeccionó en lectura el proyecto conectado y la rama `ganadito-preview`. Su esquema corresponde a otra implementación (`ganadito.app_users`, `ganadito.auctions`, etc.), mientras esta base usa `users`, `organizaciones` y `lotes_subasta`. No se aplicó SQL ni se modificó Neon.

Bloqueos y contratos pendientes: [CONTRACT_REVIEW.md](CONTRACT_REVIEW.md). Procedimiento de staging y recuperación: [infrastructure/deployment](../infrastructure/deployment/README.md).

Reglas de `main` comprobadas en GitHub: ruleset activo `reglas-main` (`26218842`), un PR y una aprobación requeridos; las conversaciones deben resolverse. La lista de checks obligatorios del ruleset está vacía. Ejecutar CI y exigir sus resultados sigue siendo parte del procedimiento; no se modificó la protección ni se eludió la aprobación.
