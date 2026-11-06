# Acta de aceptación V01–V06 (flujo inicial)

**Acepta:** Nicolás, programador principal. La revisión técnica la hizo Claude a su pedido.
**Fecha:** 2026-11-05.
**Base revisada:** `main` en `d1c67f900c` (CI 4/4 en verde), que incluye la entrega web #37, #44 y #51 de Víctor y las correcciones de Nicolás #46 a #50 y #52.
**Matriz:** `docs/HITOS_VICTOR_2026-11-05.md`, con 6 bloques y 4 hitos cada uno (I, F, R y A).

## Resultado: 24/24 hitos, con una excepción explícita

| Bloque | I | F | R | A: aceptación de Nicolás |
|---|---|---|---|---|
| V01 Base web | ✅ | ✅ | ✅ | ✅ Cliente, proxy, carga, error y reintento sin datos demo; build Node. |
| V02 Acceso y contexto | ✅ | ✅ | ✅ | ✅ Sesión y contexto emitidos por el servidor, 401/403, cambio de organización y descarte de respuestas tardías. |
| V03 Lotes y pujas | ✅ | ✅ | ✅ | ✅ Puja REST confirmada solo con 201, clave idempotente conservada y snapshot oficial. La clave tiene ámbito organizacional (#50) y los registros heredados se corrigieron en #52. |
| V04 Cierre y órdenes | ✅ | ✅ | ✅ | ✅ Cierre por el worker y no por el reloj local; orden `PENDIENTE_PAGO` persistida; una organización ajena recibe 404; recuperación por HTTP. |
| V05 Mapa, Spot y trazabilidad | ✅ | ✅ | ✅ | ✅ Ubicación aproximada visible, DTO con campos nullable y vista PUBLICA sin hashes ni autor. La integridad se comprueba solo con `/verificar` (#46, #50 y #51). |
| V06 Navegador y entrega | ✅ | ✅ | ✅ | ✅ con la **excepción E1**: CI con 4 jobs, servicios efímeros, web compilada y SHA inyectado. |

## Evidencia verificada
- CI de `main` en verde (4 jobs) sobre el SHA indicado, y CI 4/4 de cada PR integrado.
- Revisión cruzada: Claude revisó por encargo de Nicolás #37, #44 y #51 (aprobado). Codex revisó desde el lado de Víctor #40 a #50, y todos sus hallazgos están corregidos con pruebas que fallan con el código anterior (#46 a #50 y #52).
- Recorridos reales en CI con datos ficticios: el mismo lote se publica en la web, recibe pujas, lo cierra el worker y genera la orden; y el recorrido de mapa, Spot y pasaporte por actor.

## Excepción aceptada expresamente por Nicolás
- **E1. Staging y recuperación.** El criterio «staging autorizado con recuperación comprobada» **no se cumple**: no se desplegó staging. Nicolás acepta V06 sin él, por decisión propia, con esta condición: **ningún despliegue fuera de CI** (ni staging compartido ni producción) hasta que Víctor ejecute el runbook de `infrastructure/deployment` con datos ficticios y registre las versiones, las migraciones y la prueba de recuperación.

## Fuera del alcance de esta aceptación (siguen apagados)
- El transporte WebSocket en la web: debe migrar a `?ticket=` (tarea 4 de la guía de Víctor) antes de activarse.
- El QR público y anónimo del pasaporte, y la publicación pública en la web.
- Los pagos reales, la IA en campo (su precisión no está validada con balanza), GMX, mayoristas, logística y las integraciones externas.

Esta acta acepta solamente el flujo inicial V01–V06 con el alcance descrito. No certifica el producto al 100%.

> La API de GitHub de esta máquina no tiene permiso para crear issues ni reseñas en PR ya unidos; por eso el acta queda versionada aquí. La aprobación técnica del PR #51 sí consta en GitHub.
