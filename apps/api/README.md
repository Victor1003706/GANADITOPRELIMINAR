# @ganadito/api

Servicio backend de Ganadito desarrollado con **Node.js**, **Fastify** y **TypeScript**.

## Arquitectura
Monolito modular con arquitectura hexagonal y CQRS selectivo.
- Núcleo transaccional respaldado por PostgreSQL 16 + PostGIS 3.4.
- Caché y mensajería efímera con Redis 7.
- Módulos: acceso y organizaciones, mapa y Spot (con privacidad de ubicación), subastas
  (pujas idempotentes, WebSocket con ticket, cierre por worker), órdenes, trazabilidad,
  estimación de peso por IA (orientativa), logística, mayorista, GMX, pagos e integraciones
  tributarias (las tres últimas simuladas o apagadas por defecto).
- Contratos: `docs/api/*.md`. Arranque y variables: `docs/api/arranque-api.md`.
- Pruebas: `npm test` (requiere PostgreSQL+PostGIS y Redis; ver `infrastructure/docker`).
