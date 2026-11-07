# Inventario de contratos y solicitudes de integración

Este documento conserva el inventario inicial de Víctor sobre `dde293bc977ac090d631b6c90a2cb4bb6efcb40e` y registra debajo su estado de integración. No publica ni modifica contratos API. Nicolás conserva la edición de `packages/contracts/src/**` y `docs/api/**`.

## Estado vigente de V05 — 5 de noviembre de 2026

Base `5b73e470`: Nicolás integró #37/#44 y sus correcciones #46–#50. #46 valida tipos de trazabilidad, usa lookup seguro y tipa las lecturas públicas; #50 omite ambos hashes en PUBLICA y conserva la cadena privada. Se adopta `PasaporteDigitalVista` original de main. El propietario aprobó esa política y la [transferencia V05](TRANSFERENCIA_V05_2026-11-04.md); no se repite la implementación backend.

La entrega web representa ubicaciones aproximadas sin atribuirles precisión, discrimina PUBLICA/COMPLETA y añade evidencia integrada con web compilada. Las descripciones de defectos de los apartados históricos no acreditan su persistencia tras estas correcciones. El transporte WS web, la ruta pública web de pasaporte y los pagos reales siguen desactivados; sus endpoints API permanecen registrados. La aceptación humana de Nicolás sigue siendo una condición separada de la CI.

## Actualización del 4 de noviembre de 2026

El contrato de acceso, lotes, pujas, envelope público WS y GET de órdenes se revisó e integró mediante [#29](https://github.com/Nicolas923-source/Ganadito/pull/29), único PR autorizado para fusión por el propietario. Main contractual: `2ffe7d4`. Las tablas siguientes describen la base inicial; no significan que N01 o GET de órdenes sigan sin implementación.

La rama aislada `feature/victor/v04-v06-integracion-nicolas` combina la web de #35/#36 con los commits originales N01–N05, A1/A2 y N06 hasta `26e8179`, sin reescribir sus fuentes. Añade lista/detalle REST de órdenes, registro comprador/vendedor, scripts N01 y pruebas reales de integración en CI. No promueve esos PR de código a main.

Hallazgos aún abiertos y revisiones publicadas: [REVIEW_NICOLAS_2026-11-04.md](REVIEW_NICOLAS_2026-11-04.md). Incluyen exposición del token WS, ubicación Spot, redacción pública, reloj de pujas y precisión del cursor. El transporte WS está apagado por defecto; la sala usa snapshots HTTP oficiales y pujas REST. El pasaporte público permanece inactivo. Pagos externos deshabilitados. La aceptación requiere corregir los hallazgos y la revisión de Nicolás sobre el código final de Víctor.

`docs/api/README.md` todavía describe una fase sin endpoints, mientras `apps/api/src/app.ts` ya registra rutas y existen interfaces compartidas. Por ello, los ejemplos y tipos deben contrastarse con las rutas actuales antes de cerrar la integración. La existencia de una ruta en código no acredita que esté desplegada, autorizada correctamente ni probada desde el navegador.

## Superficie existente para V01-V05

| Área | Fuente compartida | Rutas presentes en la base | Observación |
|---|---|---|---|
| Identidad | `identity.ts` | `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/organizations/switch-context` | Login/switch emiten JWT de 900 segundos; `me` consulta perfil. El DTO HTTP difiere de varias entidades compartidas. |
| Lotes y pujas | `auctions.ts` | `POST /api/v1/subastas`, `GET /api/v1/subastas/:id/snapshot`, `POST /api/v1/subastas/:id/pujas` | La puja usa `Idempotency-Key` o `idempotency_key`; no hay `GET /api/v1/subastas` en esta base. |
| Tiempo real y cierre | `auctions.ts`, tipos de `subastas` | WebSocket `/api/v1/subastas/:id/live`; `POST /api/v1/subastas/cerrar-expiradas` | El navegador recupera snapshot tras conectar/reconectar. No dispara cierre administrativo para simular un resultado. |
| Órdenes | `orders.ts` | `POST /api/v1/ordenes/:id/despachar`, `POST /api/v1/ordenes/:id/confirmar-recepcion` | Existen transiciones de escritura; faltan rutas GET de listado y detalle de órdenes. Los pagos reales permanecen indisponibles. |
| Mapa | `identity.ts`, `geo.ts` | `GET /api/v1/establecimientos/cercanos`, `POST /api/v1/establecimientos` | Consulta por `lat`, `lon`, `radio_km`, `tipo`, `limit`, `offset`; no ampliar ubicación con datos inventados. |
| Spot | `spot.ts` | `GET /api/v1/cotizaciones/pizarra`, `POST /api/v1/cotizaciones` | Revisar DTO de consulta/respuesta contra `spot.types.ts`; no tratar filtros compartidos adicionales como endpoints implementados. |
| Trazabilidad | `traceability.ts` | `GET /api/v1/trazabilidad/bovinos/:id/pasaporte`, `GET /api/v1/trazabilidad/bovinos/:id/verificar`, `POST /api/v1/trazabilidad/bovinos`, `POST /api/v1/trazabilidad/bovinos/:id/eventos` | ID de bovino, no inferir que un arete sea ID. Consultas GET no tienen middleware de sesión en la base; Nicolás debe definir datos públicos/privados. |

## Brechas concretas para Nicolás

| Solicitud | Evidencia en la base | Entrega requerida y aceptación |
|---|---|---|
| N01: arranque real | `apps/api/package.json` ejecuta un `echo` en `dev`; `index.ts` exporta módulos y health, sin `listen`. `buildApp()` construye Fastify. | Publicar punto de arranque, puerto/host, carga de variables, cierre de pool/Redis y workers; comunicar scripts a Víctor. Probar una operación PostgreSQL, además de `/health`. |
| Contrato HTTP mínimo | `identity.ts` define `nombres`/`apellidos` y `ContextoOrganizacionActivo`; auth HTTP usa `nombre`, `active_context` con `organizacion_id`/`rol` y perfil de servicio. | Nicolás publica DTOs y ejemplos completos de login, `me`, switch, errores, 401/403 y expiración en su PR de contrato; Víctor verifica necesidades de la pantalla. |
| Contrato snapshot y puja | `EnviarPujaRequest` compartido incluye `version_esperada`; `EmitirPujaInput` HTTP usa `monto` e `idempotency_key`. Las rutas retornan resultados de servicio. | Documentar forma exacta de snapshot, puja confirmada y errores; explicar idempotencia para mismo contenido y conflicto de clave reutilizada con contenido distinto. No inventar éxito local. |
| Eventos y reanudación WS | El tipo compartido se llama `PujaConfirmadaEvent` con `tipo: 'PUJA_CONFIRMADA'`; la API inserta `PUJA_ACEPTADA` en outbox con `PujaAceptadaResponse`. El cierre inserta `SUBASTA_ADJUDICADA` y `orden_id`. | Publicar envoltorio y nombres de eventos de difusión reales, secuencia/versión, campos de cierre y recuperación ante pérdida de eventos. No convertir una notificación no verificada en confirmación local. |
| Consulta de lotes | Hay POST de creación y GET por snapshot, sin listado GET. | Acordar e integrar contrato de listado, filtros, paginación y visibilidad, o confirmar que consulta inicial será por ID. Hasta entonces la web no debe fingir un catálogo ni consumir una ruta inventada. |
| Lectura de órdenes y cierre | `ordenes.routes.ts` contiene solo despacho/recepción; el cliente no puede consultar una orden por API en esta base. | Acordar GET listado/detalle o lectura autorizada alternativa, relación lote→orden y evento de cierre con recuperación. Probar pertenencia, cierre único, snapshot coherente y `PENDIENTE_PAGO`. |
| N02: contexto de roles | `auth.middleware.ts` toma `membershipRes.rows[0]` al consultar por usuario/organización. | Probar múltiples roles sin dependencia del orden de filas y denegar organización ajena. La pantalla usa el contexto confirmado; no corrige permisos en cliente. |
| N04: continuidad del worker | En `subastas-closer.worker.ts`, `scheduleNext()` llama a `start()` con `active` aún verdadero, y `start()` retorna si está activo. Hallazgo de lectura pendiente de reproducción. | Nicolás reproduce con dos ciclos de temporizador y corrige en sus rutas; probar cierre periódico, parada ordenada y ausencia de efectos duplicados. Un `tick()` aislado no demuestra el bucle continuo. |
| N02/N05: privacidad de lectura y WS | Mapa, snapshot y pasaporte GET están expuestos sin middleware de sesión en esas rutas. El canal WS `/subastas/:id/live` tampoco autentica en esta base y difunde payload de outbox, incluido cierre con referencias de comprador y organizaciones. | Definir y probar campos públicos, suscripción autorizada al canal y datos que requieren organización; acordar respuesta no autorizada. El filtro visual del navegador no acredita autorización del canal. Víctor no debe completar datos exactos omitidos por API. |
| Datos e2e reales | Hay seeds, migraciones y tests backend; no hay arranque HTTP reproducible N01 en la base. | Entregar comandos y fixture ficticio aislado con dos organizaciones, comprador/vendedor, establecimiento y lote que pueda cerrarse de forma controlada. No usar base compartida sin coordinación. |

## Secuencia de cambio de contrato

1. Acordar método, ruta, entrada, salida, errores, autenticación y organización autorizada; para WS, eventos y recuperación.
2. Nicolás documenta contratos y ejemplos en sus rutas. Víctor revisa que permitan construir las pantallas.
3. Integrar ese PR revisado en `main` antes de cambios dependientes.
4. Actualizar ramas y usar ejemplos de prueba identificados. Una suite aislada no habilita datos simulados en modo operativo.
5. Probar pantalla y API real con datos ficticios, registrar SHA web/API, migraciones y resultados. Si cambia nombre, tipo o significado de campo, repetir la coordinación.

Las solicitudes anteriores permanecen abiertas hasta que exista el PR revisado y su evidencia. Este inventario no autoriza a Víctor a editar backend, contrato ni SQL.
