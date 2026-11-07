# Seguimiento de la foto y del informe - 4 de noviembre de 2026

> **Documento histórico.** Su estado fue reemplazado por [ACTA_ACEPTACION_V01_V06.md](ACTA_ACEPTACION_V01_V06.md) (PR #53) y por los PR #54–#58. Se conserva como evidencia; no describe el estado actual.

Este registro corresponde a la ejecución programada posterior al informe. El PDF original tiene corte 14:37 Bogotá, fuente 2d90080 y un índice orientativo de 71%; no acredita por sí mismo el estado posterior y no se modificó retroactivamente.

## Estado contrastado en GitHub

- `main` pasó a 830a6eb: GitHub muestra #27, #25 y #28 fusionados posteriormente al corte del PDF. No se ejecutaron fusiones durante esta revisión.
- #35 sigue en 06280dd; #36 en e1e35e1; el punto de partida de #37 es 2d90080, con CI 41895561125 aprobada. Sus tres entregas siguen pendientes de revisión cruzada de Nicolás; no se autoaprueban.
- #26 a41b5be, #30 ba8eb8d, #31 6557220, #33 09a7ad7 y #34 26e8179 no cambiaron. Se conservan sus dependencias y hallazgos documentados; no se publicaron duplicados de esas observaciones.
- #32 ahora está en 18b30bac. `clock_timestamp()` se consulta en otra sentencia después de completar `FOR UPDATE`; el snapshot considera inicio y cierre exactos. La revisión incremental y los mocks distinguen el comportamiento anterior del nuevo. Aún falta CI del SHA exacto y ejecutar la regresión de dos conexiones aisladas. [Seguimiento publicado](https://github.com/Nicolas923-source/Ganadito/pull/32#pullrequestreview-5777242327).
- N04/N05 siguen en 09a7ad7/26e8179 y no contienen todavía ese nuevo fix. Por eso el hallazgo no se considera resuelto en la integración #37, aunque sí corregido por inspección en el delta de #32.
- Se identificó #38, de IA, como entrega posterior; no se incluyó ni se aprobó en esta unidad del recorrido inicial.

## Auditoría solicitada en la foto

| PR | Comparación para atribuir cambios | Resultado sobre el corte auditado |
|---|---|---|
| #35 | dde293b...06280dd | Cuatro rutas: manifiestos/lockfile y tsconfig.base.json, todos de Víctor. La configuración TS6 está explicada en REVIEW_REQUEST_VICTOR.md. |
| #36 | 06280dd...e1e35e1 | 61 rutas asignadas a web, navegador, documentación, despliegue y configuración. |
| #37 | 26e8179...2d90080 | 78 rutas de Víctor. Merge-base exacto N05; sin modificaciones de fuentes de Nicolás. |

Se compararon además los árboles: `apps/api/src`, database, Docker, contracts, `docs/api`, shared/config y servicios IA son idénticos entre N05 y el punto auditado de #37. `git log --no-merges` sobre las rutas reservadas no contiene commits propios de Víctor. `apps/api/package.json` sí cambia scripts y pertenece a Víctor por la excepción de manifiestos.

Comparar con main para atribuir autoría sería engañoso: el historial actual tiene varias bases comunes y código original de Nicolás heredado. La revisión final del otro programador sigue pendiente. Los cambios posteriores de esta unidad solo amplían pruebas e información de seguimiento en rutas de Víctor.

## Brecha cerrada en la prueba de aceptación

La prueba histórica publicaba un lote UI y preparaba otro mediante API para cerrar rápido. La suite ahora usa el mismo `uiLot.id` desde publicación hasta snapshot, puja, cierre del worker, consulta y detalle de orden. No hay segunda publicación API ni modificación del payload de la UI. Se conserva el anti-sniping normal y se espera el cierre oficial con una ventana de dos a tres minutos.

La recarga del navegador debe recuperar sesión, precio y secuencia oficiales. Después de comprobar la orden correcta para su comprador, otra organización ingresa desde la UI y obtiene un 404 opaco sin importes ni detalle; se mantiene la equivalencia API con una orden inexistente. Esto acredita el aislamiento de esa consulta, no la privacidad total de V05.

Validación local: un test detectado, TypeScript focal correcto, 30/30 guardias de destino y 5/5 unitarios web; revisión independiente sin bloqueantes. La ejecución real se reserva exclusivamente a PostGIS/Redis efímeros de CI. El SHA y resultado final se enlazan en [#37](https://github.com/Nicolas923-source/Ganadito/pull/37).

## Tres propuestas de la foto

Después de verificar esta unidad se documentaron las [tres recomendaciones](DECISIONES_PENDIENTES_FOTO_2026-11-04.md). Siguen siendo decisiones por acordar con Víctor/Nicolás, no contratos ya aprobados ni autorización para habilitar WS o pasaporte público.

## Cambios recibidos durante la ejecución

El estado anterior describe la consulta inicial. Nicolás publicó luego N04 `2d943fd` y N05 `e657d77`, que ya propagan N03 `18b30bac`. Se revisaron sus deltas completos: el reloj posterior al bloqueo y el inicio futuro, la redacción de credenciales en logs y las coordenadas Spot tienen corrección y regresiones. La [CI 41931985620](https://github.com/Nicolas923-source/Ganadito/actions/runs/41931985620) de la cabeza web `3a349f3` usó el merge de prueba `ca56977` con N05 `e657d77`: 113/113 backend, 5/5 web, 36/36 configuración, 2/2 proxy, 58/58 fixtures, 2/2 HTTP y 1/1 real (2.5 minutos), todos correctos. No se atribuye esa ejecución al antiguo árbol N05 ni se presenta como CI individual de cada SHA de Nicolás.

Se incorporó N05 original en la rama de integración, sin editar sus fuentes ni fusionar PR. Los árboles reservados siguen idénticos al nuevo N05; el SHA final y su nueva CI se registran en #37. Continúan pendientes #26 (seed), #30 (preflight), #33 (cursor) y #34 (metadata pública y DTO), además de los tres acuerdos propuestos. No se aprobaron dependencias bloqueadas ni entregas propias.

Revisión focal de V05: la web acepta el nuevo campo de aproximación de Spot, pero aún no lo representa ni avisa visualmente en el marcador/popup. No se recuperan coordenadas exactas desde la web. La adaptación de presentación queda registrada como trabajo de Víctor dependiente del contrato/DTO de privacidad acordado, según la instrucción expresa; no se cambia ese contrato por inferencia ni se da V05 por terminado.

Detalle P3 para Nicolás: el nuevo test Spot combina coordenadas aleatorias con una aserción de que aproximar siempre cambia el valor. Un punto real que ya está en rejilla puede conservarlo correctamente y fallar esa aserción; usar un fixture fijo fuera de rejilla. No invalida la política SQL corregida.
