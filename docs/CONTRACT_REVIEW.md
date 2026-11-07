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
| Órdenes | `orders.ts` | `POST /api/v1/ordenes/:id/despachar`, `POST /api/v1/ordenes/:id/confirmar-recepcion` | Existen transiciones de escritura; faltan rutas GET de listado y detall