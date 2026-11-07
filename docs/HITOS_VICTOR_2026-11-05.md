# Los 24 hitos del flujo inicial V01–V06

> **Documento histórico.** Su estado fue reemplazado por [ACTA_ACEPTACION_V01_V06.md](ACTA_ACEPTACION_V01_V06.md) (PR #53) y por los PR #54–#58. Se conserva como evidencia; no describe el estado actual.

Son **24 en total**, no 24 tareas adicionales: seis bloques con cuatro criterios cada uno. Se conserva el denominador del informe anterior. I = implementación y comprobación estática; F = navegador con respuestas controladas; R = integración real con datos ficticios; A = aceptación cruzada de Nicolás. Los tres primeros son evidencia técnica; el cuarto necesita al otro programador.

Base de esta entrega: `5b73e470` de main. #37 y #44 ya están integrados por otras acciones; esta entrega conserva las correcciones originales de Nicolás #46/#50. El trabajo previo se preservó localmente sin publicar duplicados. No se fusiona ni se despliega en esta entrega.

## Matriz y comprobación

| Bloque | I | F | R | A: revisión cruzada pendiente |
|---|---|---|---|---|
| V01 base web | Cliente, proxy, carga/error/reintento y build Node | Respuestas inválidas/errores sin sustitución demo | Web compilada con API HTTP real | Revisar ejecución, cliente y errores |
| V02 acceso/contexto | Sesión y contexto emitidos por servidor | 401/403, expiración, cambio de organización y respuestas tardías | Registro, login, recarga y organización ajena | Revisar permisos y cancelación |
| V03 lotes/pujas | Formularios y snapshot oficial | Validación, recibo, reintento idempotente y navegación | Mismo lote publicado en la web y pujado realmente | Revisar confirmación y reintentos |
| V04 cierre/órdenes | Consulta REST y recuperación HTTP | Sin adjudicar por reloj local; errores y aislamiento | Worker cierra el mismo lote; orden persistida y ajeno rechazado | Revisar cierre, orden y recuperación |
| V05 mapa/Spot/trazabilidad | Aproximación visible, DTO nullable y vistas discriminadas | Anónimo/ajeno/dueño, XSS, errores y cambios de contexto | Mapa/Spot por actor, pasaporte privado e integridad y API pública sin hashes; correcto en CI 42029557812 | Revisar privacidad y decisiones públicas |
| V06 navegador/entrega | CI, guardias y runbook; artefacto con SHA | Suite fixtures y modo HTTP | PostGIS/Redis efímeros, API/worker reales y web adapter-node compilada | Revisar evidencia y acordar staging/recuperación |

La [CI 42029557812](https://github.com/Nicolas923-source/Ganadito/actions/runs/42029557812) de [#51](https://github.com/Nicolas923-source/Ganadito/pull/51), código `cce19571605b30951ad378e8aaa7ad8ffa93e8aa`, pasó los cuatro jobs contra main `5b73e470` (merge de prueba `37c3afd2`). Incluye 208 API sin omisiones (las 40 regresiones complementarias y las de PostgreSQL), 5 web, 39 configuración, 2 proxy, 85 fixtures, 2 HTTP, 49 Python y 2 recorridos reales. Los dos casos que fixtures omite por modo se ejecutan aparte en HTTP. Typecheck y build correctos; Svelte 0 errores/advertencias. Lint termina, pero no hay reglas de lint en los workspaces.

El caso real del mismo lote web→puja→worker→orden duró 2.7 minutos; el de mapa/Spot/pasaporte, 2.9 segundos. Ambos usaron web adapter-node compilada cuya versión servida coincide con el SHA inyectado del checkout de CI. No se interceptaron respuestas comerciales, se creó todo por API/UI con datos ficticios y no hubo SQL de preparación, seeds ni cierre administrativo. La columna R acredita esos recorridos y no todas las combinaciones posibles del producto.

El índice histórico pasa de 17/24 a **18/24 hitos con evidencia técnica (75%)**. **Las seis A permanecen pendientes** de Nicolás. No es porcentaje de esfuerzo ni de toda Ganadito, y no elimina los hallazgos de compatibilidad siguientes. La descripción de #51 registra la CI del HEAD final, incluso tras el commit documental de esta evidencia; este documento no acredita un SHA futuro.

## Hallazgos de Nicolás contrastados con la nueva base

Se revisaron los diffs completo