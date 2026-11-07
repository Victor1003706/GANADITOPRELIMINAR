# Integración de la API de Nicolás — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** conectar las órdenes autorizadas, alinear el arranque y verificar web + API reales en una rama aislada, conservando bloqueadas las promociones con hallazgos de Nicolás.

**Architecture:** conservar SvelteKit/Fastify, PostgreSQL como autoridad y Redis como transporte. Consumir el contrato integrado por PR #29; no editar implementaciones, contratos ni migraciones de Nicolás. Las pruebas reales usan exclusivamente PostgreSQL/PostGIS y Redis efímeros de CI.

**Tech Stack:** Node 24, SvelteKit 3, TypeScript 6, Fastify 5, Playwright, PostGIS 16-3.4 y Redis 7.

**Spec:** `docs/VICTOR_DELIVERY.md`, `docs/OWNERSHIP.md`, `docs/api/contrato-v1-acceso-lotes.md` (PR #29, autorizado por el usuario y fusionado en `2ffe7d4`).

## Global Constraints

- Víctor modifica solo web, navegador, manifiestos, configuración/CI, despliegue y documentación no API.
- No editar SQL, backend ni contratos de Nicolás. No ejecutar seeds ni migraciones en bases locales ajenas o Neon.
- Los pagos permanecen desactivados y las respuestas fallidas nunca se sustituyen con demo.
- No fusionar PR de código de Nicolás ni PR propios sin revisión. Solo #29 tuvo autorización de fusión.
- WS con token en URL queda apagado por defecto hasta corregir su exposición en logs; el modo HTTP usa snapshots oficiales y REST.
- Prueba real: DB exacta `ganadito_e2e_test`, host loopback, sin query de conexión, flag explícito de entorno aislado y trazas sin credenciales.

## Review Focus

1. Cambio de organización o expiración durante lectura: cancelar respuesta anterior y vaciar datos privados.
2. Orden ajena/inexistente: mismo 404, sin concluir que el recurso existe ni inventar importes.
3. Cursor opaco/repetido: no duplicar filas ni solicitar páginas indefinidamente; el defecto de precisión del servidor se reporta a Nicolás.
4. Eventos duplicados, retrasados o con salto: no deducir resultado; recuperar snapshot y consultar órdenes autorizadas.
5. Entorno de pruebas mal dirigido o captura de JWT: rechazar antes de conectar y no usar trazas de red con credenciales reales de prueba.

## Task 1: arranque y entorno de integración

**Files:** `apps/api/package.json`, `package.json`, `.env.example`, `docs/DEVELOPMENT.md`, `infrastructure/deployment/README.md`, pruebas de navegador/configuración de arranque en `tests/e2e/**`.

**Interfaces:** consume `apps/api/src/server.ts` de N01; produce comandos `dev:api`/`start:api` que cargan `.env` raíz si existe, respetando variables inyectadas. Puerto API 4000 y proxy coherentes. Registro web permite únicamente COMPRADOR/VENDEDOR (campo existente `rol_inicial`).

- [x] Probar carga del entorno con valores ficticios y registro VENDEDOR antes de cambiar scripts/formulario.
- [x] Implementar scripts y documentación sin nuevas dependencias ni cambios de backend; pagos `false`.
- [x] Verificar comandos con proceso aislado, typecheck y pruebas pertinentes; registrar commit.

## Task 2: órdenes autorizadas

**Files:** crear `apps/web/src/lib/orders.ts`, modificar `apps/web/src/routes/ordenes/+page.svelte`, crear `apps/web/src/routes/ordenes/[id]/+page.svelte` y `tests/e2e/orders.spec.ts`.

**Interfaces:** GET `/api/v1/ordenes?rol=comprador|vendedor&limit=20&cursor=...` devuelve `{data,next_cursor}`; GET `/ordenes/:id` devuelve orden. Orden: IDs, `codigo_lote`, estado, importes confirmados, comprador nullable, vendedor y fecha. Consumir `apiRequest`, `session` y signals existentes; no calcular comisiones ni resultados.

- [x] Escribir/regresar pruebas de lista, detalle, vacío, 404, 403, página siguiente, cursor repetido y cambio de contexto; comprobar rojo.
- [x] Implementar guardas DTO, listado, detalle y filtro local opcional `lote_id`; distinguir página sin coincidencias de ausencia global.
- [x] Mantener pago desactivado, verificar pruebas y typecheck; registrar commit.

## Task 3: tiempo real compatible y modo HTTP seguro

**Files:** `apps/web/src/lib/auctions/**`, `apps/web/src/routes/subastas/[id]/+page.svelte`, componentes de subasta, `apps/web/src/env.ts`, `apps/web/src/lib/config.ts`, `apps/web/src/lib/api.ts`, `tests/e2e/auctions.spec.ts`, config Playwright de fixtures.

**Interfaces:** WS `{event_type,lote_id,data}` sin datos privados ni clave de idempotencia. Respuesta HTTP de puja conserva su clave. `PUBLIC_LIVE_AUCTIONS_ENABLED=false` por defecto: no enviar JWT por URL; usar polling oficial. En modo explícito de pruebas/habilitación, autenticación WS del contrato y snapshot posterior a abrir el socket actual. Cierre enlaza `/ordenes?lote_id=<id>` y nunca usa una orden inferida de WS.

Transferencia interna: el implementador de tiempo real edita `apps/web/src/lib/api.ts` para añadir `expectedStatus` opcional y exigir HTTP 201 antes de confirmar una puja; concluye al probar 200 inesperado como resultado incierto. Esta ruta pertenece a Víctor.

- [x] Probar envelope nuevo, duplicados/saltos, cierre sin `orden_id`, ausencia de JWT en modo predeterminado y suspensión durante recuperación; comprobar rojo.
- [x] Implementar parser separado de recibos REST y eventos públicos, fallback HTTP visible y opt-in WS sin registrar URL/token.
- [x] Verificar suite completa de subastas, errores y reintento idempotente; registrar commit.

## Task 4: navegador + API reales y revisión entregable

**Files:** `tests/e2e/real/**`, `.github/workflows/ci.yml`, manifiesto raíz para comandos de pruebas, `docs/REVIEW_NICOLAS_2026-11-04.md`, documentos de evidencia/despliegue.

**Interfaces:** launcher de pruebas importa `startServer({logger:false})` sin modificar backend; exige DB efímera y pagos apagados. CI arranca API/Redis reales, crea cuentas ficticias por API y ejercita acceso, publicación, puja, cierre y consulta de orden. Fixtures y suite real permanecen separados; no afirmar que esto valida un proveedor externo.

- [x] Añadir guardia de destino antes de cualquier conexión y probar rechazo de DB no permitida.
- [x] Crear suite real con trazas de red apagadas y datos ficticios; añadir job CI aislado.
- [x] Reproducir y publicar hallazgos de revisión en los PR correspondientes; no corregir archivos de Nicolás.
- [x] Ejecutar checks locales, publicar rama/PR dependiente en borrador y observar CI hasta su resultado. Registrar bloqueos que permanezcan.

## Estado y decisiones

- Revisión N01–N05 y A1/A2/A4/N06 realizada en lectura. Hallazgos de logs WS, ubicación Spot, redacción, seed, reloj y cursor requieren corrección por Nicolás.
- #29 es el único PR autorizado para fusionar: revisión y CI verificadas; ya está en `main`. Los PR de código siguen abiertos.
- Rama de verificación combina commits originales de Nicolás con la entrega web anterior; no cambia sus archivos y no se promoverá mientras permanezcan bloqueantes.
- Implementación `d38d304`, publicada en borrador [#37](https://github.com/Nicolas923-source/Ganadito/pull/37), base N05 `26e8179`. CI `41884285818` verde sobre `17a3af7`: 108 backend, 5 unitarios web, 36 configuración, 2 proxy, 56 navegador fixture, 2 HTTP y 1 recorrido real web/API/worker. La CI final se consulta en el PR. Los hallazgos de Nicolás y su revisión cruzada siguen pendientes; la tarea de integración no equivale a aceptación del producto.

## Seguimiento: guías de revisión y pendientes de Víctor

Alcance: `README.md`, `docs/GIT_WORKFLOW.md`, `docs/DEVELOPMENT.md`, este plan y el informe de revisión. Mantener los fuentes de Nicolás intactos. Las guías entregadas por el propietario reservan Approve a la persona revisora; conservar los dictámenes favorables como COMMENT y los defectos como REQUEST_CHANGES.

- [x] Revisar SHA y diff completos de #27/#25/#28/#31, contrastar CI exacta o integrada y publicar dictámenes sin duplicar commits.
- [x] Reproducir en memoria y comunicar el efecto de migraciones antes de validar configuración en #30.
- [x] Actualizar README y diagnóstico con arranque/órdenes ya implementados; registrar orden, SHA y aprobación humana.
- [x] Verificar referencias y comandos documentados (25 enlaces locales y 30 referencias a scripts), pasar las 36 pruebas de configuración y preparar el seguimiento para #37. La publicación y CI final quedan registradas en el PR.

## Seguimiento: aprobación delegada y ciclo de vida de pujas

Decisión posterior del propietario: Codex puede registrar aprobaciones de los PR correctos de Nicolás ya revisados y comprobados; conserva la prohibición de aprobar cambios propios o con bloqueantes. No se autorizaron fusiones. #27 ya estaba aprobado; #25 y #28 se aprobaron sobre sus mismos SHA con CI exacta verde. #31 mantiene dependencia bloqueada y falta de CI individual.

Tarea V03/V04, editor Víctor: `PanelPujaRapida.svelte` y `tests/e2e/auctions.spec.ts`; no cambia API ni contratos. Al enviar puja en A, navegar a B y regresar a A antes de recibir la respuesta, la instancia destruida del panel podía añadir una puja al historial de la nueva visita. Una respuesta tardía de una instancia destruida debe descartarse sin cambiar las decisiones persistidas de la API.

- [x] Reproducir rojo A→B→A (historial esperaba 0 filas y recibió 1); A→B sin retorno ya era correcto.
- [x] Añadir guardia de destrucción del panel en éxito/error/finalización; ambas regresiones verdes.
- [x] Revisión independiente correcta; typecheck/build, 5 unitarios, 2 proxy, 58 fixtures y 2 HTTP correctos. Preparar publicación en #37; su evidencia enlaza la CI del HEAD final.
- [x] Evitar CI duplicada de ramas de trabajo: PR para cualquier base, push solo en main y ejecución manual; mantener los tres jobs y confirmar el HEAD final en GitHub.
