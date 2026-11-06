# Correcciones autorizadas de arranque y cursor

> **For agentic workers:** usar subagent-driven-development con dos tareas de rutas separadas y revisión final independiente.

**Goal:** impedir efectos de arranque con configuración inválida y evitar omitir órdenes por perder microsegundos.

**Architecture:** adoptar los resolvers/preflight y la marca interna de microsegundos originales de Nicolás en #43. Complementar con regresiones y rechazar calendarios imposibles antes de SQL, conservando la cadena original del cursor. Sin migraciones ni cambios del contrato comercial.

**Tech Stack:** TypeScript, Node 24/tsx/node:test, PostgreSQL 16 en CI efímera.

**Spec:** TRANSFERENCIA_ARRANQUE_CURSOR_2026-11-04.md, aprobada expresamente por Víctor.

## Restricciones

No editar privacidad, IA, contratos ni SQL/migraciones. No abrir DB local ni Neon. No aprobar arreglos propios; Nicolás revisa el PR. Mantener separado de #37 y no fusionar PR.

## Cambio de base y atribución

Base final 03722fc de #37, que incorpora main 526a22d. Nicolás publicó #43 durante la ejecución; nuestros arreglos previos de server/proyección están guardados solo localmente en 7663f13, no se publican como duplicados. Las tareas siguientes describen la evidencia adoptada y complementaria; el único cambio final de producción propio es calendario en ordenes-consulta.service.ts.

## Tarea 1: preflight

Rutas: server.ts y una prueba específica de arranque sin servicios; resolvers de configuración solo si es estrictamente necesario.

- [x] Regresión que invoca el arranque real con JWT inválido y pagos inválidos, instrumentando dependencias antes de toda conexión/consulta; falla con el código anterior sin tocar servicios.
- [x] Adoptar el preflight original de Nicolás (#43) antes de getPool/SELECT1/migraciones/Redis. No se modifica server.ts ni se habilitan pagos.
- [x] Regresión pura y typecheck correctos. La CI con arranque válido se fija como criterio final de entrega.

## Tarea 2: cursor

Rutas: subastas/ordenes-consulta.service.ts y pruebas específicas de órdenes/cursor.

- [x] Reproducir pérdida de .123900/.123800 con parser pg y limit1, sin DB local.
- [x] Adoptar cursor_ts interno de seis decimales de Nicolás, sin exponerlo en el DTO ni alterar la precisión pública de created_at. Conserva filtro de organización y desempate UUID.
- [x] Añadir regresión real de CI con dos órdenes dentro del mismo milisegundo, empate exacto y páginas sin omisiones ni duplicados. Guardias previas y rollback.
- [x] Unidad pura local y typecheck correctos; DB y recorrido web completos se reservan al criterio final de CI efímera.

## Tarea 3: calendario del cursor

- [x] Reproducir la regresión regex-only de #43: mes99 y fechas normalizables alcanzan query/error en vez de 400; test rojo antes de corregir.
- [x] Validar fecha/hora real y rechazar normalización de Feb30/24:00/año0000, sin convertir la cadena que se envía a PostgreSQL.
- [x] Diez pruebas puras correctas, con cursores antiguos, bisiestos y seis decimales preservados. Revisión independiente de bordes y diff sin bloqueantes.

## Entrega

- [x] Revisión independiente del diff completo y transferencia/rutas, sin bloqueantes. El unitario del cursor no sustituye la regresión SQL real.
- [ ] Publicar PR aislado contra rama #37, CI exacta del HEAD en cuatro jobs y evidencia del mismo lote UI hasta orden.
- [ ] Registrar correcciones como entregadas para revisión de Nicolás, no aprobadas por Codex. Incluir en PDF actualizado junto con las aprobaciones reales #26/#39 y bloqueos ajenos.
