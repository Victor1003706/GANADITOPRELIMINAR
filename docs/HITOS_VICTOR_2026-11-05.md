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

Se revisaron los diffs completos de #46/#50 y sus CI exactas verdes ([41972443910](https://github.com/Nicolas923-source/Ganadito/actions/runs/41972443910), [41975488394](https://github.com/Nicolas923-source/Ganadito/actions/runs/41975488394)). Lookup seguro, rechazo de tipos nuevos inválidos y omisión pública de hashes están implementados; no se repiten como defectos abiertos.

- [#46, revisión 5785013448](https://github.com/Nicolas923-source/Ganadito/pull/46#pullrequestreview-5785013448): el DTO cercano aún heredaba dirección obligatoria pese al null público real. Esta entrega corrige solo ese tipo bajo transferencia y añade regresión de compilación rojo→verde; el DTO privado de creación sigue exigiendo string. Nicolás revisará el arreglo.
- [#50, revisión 5785012960](https://github.com/Nicolas923-source/Ganadito/pull/50#pullrequestreview-5785012960): los registros idempotentes anteriores a la migración 0014 conservan `organizacion_id=NULL` y el servicio devuelve su recibo sin comprobar la organización. Reproducción sin DB con el servicio real instrumentado: org A guardada/activa B → 409; registro heredado NULL → recibo original. Falta recuperar la organización original o fallar con conflicto opaco y probar los tres casos de legado. Pujas/SQL siguen siendo rutas de Nicolás, fuera de la transferencia V05. La prueba con cuentas nuevas no acredita una actualización de datos existentes.

Este segundo bloqueo impide afirmar que el flujo comercial completo está libre de defectos, aunque los recorridos de nueva instalación pasen. El índice registra evidencia cubierta y no elimina hallazgos de compatibilidad. No se aprobó ninguno de esos dos PR completos ni el arreglo propio.

La revisión de #47 también reconoció membresía Bearer, revocación respondida y limpieza corregidas; encontró un [P2 de consulta de autorización que queda pendiente, revisión 5785067356](https://github.com/Nicolas923-source/Ganadito/pull/47#pullrequestreview-5785067356). Sin deadline, el supervisor omite revalidaciones posteriores mientras el hub sigue entregando hasta vencer la credencial. Se reprodujo sin red con una promesa PostgreSQL pendiente. Debe corregirlo Nicolás en WS; la recuperación validada aquí sigue siendo HTTP y el transporte WS web permanece apagado. No se presenta su CI verde como prueba de este caso.

En etapas posteriores, también se revisaron íntegros #48/#49 y sus CI exactas verdes, sin editar esas rutas. [#48, revisión 5785161553](https://github.com/Nicolas923-source/Ganadito/pull/48#pullrequestreview-5785161553): una respuesta válida de una vista más `vistas:{}` pasa validación y causa 500; con `vistas:[]` prepara una estimación sin las medidas. Diez casos puros, dos reproducciones del defecto, sin DB/red. [#49, revisión 5785161842](https://github.com/Nicolas923-source/Ganadito/pull/49#pullrequestreview-5785161842): la inversión sin centrar acepta un fold LOOCV no identificable; 39 animales L140/PT180/W400 y uno L140/PT180.1/W440 producen MAPE 0 y recomiendan el modelo libre pese a perder rango al retirar el último. Se reconoce que las correcciones anteriores de escala y validación sí existen; estos casos nuevos siguen a cargo de Nicolás, sin aprobar ni habilitar IA ni afirmar validación de campo.

## Revisión que se solicita a Nicolás

Revisar el diff final de Víctor y sus pruebas, incluido el pequeño arreglo del DTO de dirección pública bajo [transferencia V05](TRANSFERENCIA_V05_2026-11-04.md). Confirmar cada aceptación sobre el SHA revisado y corregir los hallazgos antes de marcar su A. Ni Codex ni su revisión independiente sustituyen esta aceptación. El hecho de que un PR esté integrado tampoco la demuestra.

El modo probado conserva snapshots HTTP y pujas REST. Transporte WS web, ruta pública web de pasaporte, pagos reales e integraciones externas no habilitadas permanecen apagados. La API mantiene sus endpoints de WS/pasaporte. Habilitarlos requiere revisión y pruebas específicas. Staging compartido y producción no se desplegaron; no se usó Neon ni PostgreSQL local existente para pruebas reales.

El alcance comercial posterior (IA en campo, proveedor de pagos, mayoristas, logística y otros módulos) no tiene un porcentaje global acordado en esta matriz. No se garantiza ausencia universal de errores ni se declara aceptación 24/24 antes de la revisión cruzada.
