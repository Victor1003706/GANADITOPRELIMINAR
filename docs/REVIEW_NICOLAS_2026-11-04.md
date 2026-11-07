# Revisión de las entregas de Nicolás — 4 de noviembre de 2026

Revisor: Víctor con Codex. La revisión conserva la propiedad de archivos: no se corrigió código de API, SQL ni contratos de Nicolás. Sus commits se reunieron sin modificaciones en una rama aislada para verificar la integración; no se fusionaron en `main`.

## Seguimiento vigente — 5 de noviembre de 2026

El registro siguiente es histórico. Main `5b73e470` ya incluye #37/#44 y #46–#50 incorporados por otras acciones. No repetir como abiertos seed, preflight, cursor, reloj, coordenadas Spot ni la antigua ausencia de DTO/proyección pública. #46/#50 aportan los originales de privacidad que adopta V05; se registraron dos hallazgos nuevos: [dirección nullable, #46](https://github.com/Nicolas923-source/Ganadito/pull/46#pullrequestreview-5785013448), corregida en la entrega propia bajo transferencia, y [recibos heredados sin contexto, #50](https://github.com/Nicolas923-source/Ganadito/pull/50#pullrequestreview-5785012960), a cargo de Nicolás. Evidencia y límites actuales en [HITOS_VICTOR_2026-11-05.md](HITOS_VICTOR_2026-11-05.md). No se autoaprueba la entrega de Víctor ni se ejecutan fusiones/despliegues.

#47 corrige membresía de Bearer y revocación respondida; conserva un [P2 nuevo ante consultas de revalidación pendientes](https://github.com/Nicolas923-source/Ganadito/pull/47#pullrequestreview-5785067356), reproducido sin DB. Requiere deadline/cierre y prueba de ausencia de respuesta. CI exacta 41973099098 verde no cubre ese caso. El WS web continúa apagado; no se repiten los hallazgos antiguos corregidos.

Revisión adicional de etapas IA: [#48](https://github.com/Nicolas923-source/Ganadito/pull/48#pullrequestreview-5785161553), respuesta de una vista con `vistas` malformado/vacío consume una rama que no validó; [#49](https://github.com/Nicolas923-source/Ganadito/pull/49#pullrequestreview-5785161842), LOOCV casi singular recomendado pese a perder rango por fold. Ambos P2 reproducidos con fuentes exactas y fixtures sin DB/red, CI exactas 41973803881/41974281308 verdes; no se aprobaron ni se editaron sus rutas. Las correcciones anteriores válidas se reconocen. La evidencia V05 de Víctor está en #51; no habilita IA de campo.

## Seguimiento durante la ejecución programada posterior al informe

El registro de abajo conserva sus SHA históricos. GitHub muestra #27/#25/#28 ya fusionados en main `830a6eb`; no se ejecutaron esas fusiones desde esta revisión. Nicolás publicó #32 `18b30bac` (reloj tras bloqueo e inicio futuro), #33 `2d943fd` (logs sin credenciales) y #34 `e657d77` (privacidad Spot), propagados hasta N05. Sus deltas se revisaron y sus nuevas regresiones pasaron dentro de la [CI integrada 41931985620](https://github.com/Nicolas923-source/Ganadito/actions/runs/41931985620): 113/113 backend y tres jobs verdes. Falta CI individual de esos SHA; no se aprobaron sus dependencias bloqueadas.

Quedan pendientes el P1 de seed #26, preflight #30, cursor de microsegundos #33 y los dos P2 de metadata/DTO #34. Los cuatro hallazgos corregidos en código no se reiteran como abiertos en la nueva base. Ver [seguimiento de la foto](SEGUIMIENTO_FOTO_2026-11-04.md) para la atribución de rutas, límite de la evidencia y detalle P3 del test Spot. Las [tres recomendaciones](DECISIONES_PENDIENTES_FOTO_2026-11-04.md) siguen sin acuerdo: no cambian contratos ni habilitan funciones. La revisión cruzada de Nicolás a Víctor sigue pendiente.

## Contrato y secuencia

El usuario autorizó expresamente **solo** la aprobación y fusión del PR [#29](https://github.com/Nicolas923-source/Ganadito/pull/29). Se comprobó que contenía únicamente `docs/api/contrato-v1-acceso-lotes.md`, SHA `70fc1a5`, CI correcta y base `main`. Se revisaron rutas, sesión, errores, idempotencia, eventos y lectura de órdenes. Quedó integrado en `2ffe7d4`. Esto no aprueba las implementaciones de backend ni sus migraciones.

N01 aporta arranque real y migraciones versionadas; N02 