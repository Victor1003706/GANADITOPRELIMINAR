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
- [x] Implementar guardas DTO, listado, detalle y filtro local opcional `lote_id