# Evidencia de la entrega de Víctor

> **Documento histórico.** Su estado fue reemplazado por [ACTA_ACEPTACION_V01_V06.md](ACTA_ACEPTACION_V01_V06.md) (PR #53) y por los PR #54–#58. Se conserva como evidencia; no describe el estado actual.

Base: `Nicolas923-source/Ganadito`, commit `dde293bc977ac090d631b6c90a2cb4bb6efcb40e`. Validación inicial del 3 de noviembre de 2026 y repetición completa el 4 de noviembre de 2026 (America/Bogota).

## Corte vigente — 5 de noviembre de 2026

[#51](https://github.com/Nicolas923-source/Ganadito/pull/51), código `cce1957` sobre main `5b73e470`, [CI 42029557812](https://github.com/Nicolas923-source/Ganadito/actions/runs/42029557812): cuatro jobs correctos. 208 API, 5 web, 39 configuración, 2 proxy, 85 fixtures más 2 HTTP, 49 Python, 2 recorridos reales. Web adapter-node compilada con SHA verificado, mismo lote UI→puja→worker→orden, recarga/aislamiento y privacidad mapa/Spot/pasaporte. Ninguna prueba real usó Neon ni PostgreSQL local existente. Una revisión independiente detectó y confirmó corregido el rechazo de eventos históricos y el lookup heredado en su visualización; no sustituye la revisión de Nicolás.

Los [24 hitos](HITOS_VICTOR_2026-11-05.md) tienen ahora 18 criterios con evidencia técnica y seis aceptaciones pendientes. Allí figuran los hallazgos nuevos de Nicolás #47/#48/#49/#50 y el tipo nullable #46 corregido bajo transferencia V05. No se repiten defectos ya resueltos ni se declara ausencia universal de fallos. Staging/producción, aceptación WS y pagos reales siguen separados; web WS y ruta pública web permanecen apagados. Los apartados siguientes son registros históricos. El PR enlaza la CI del HEAD final tras el commit documental.

## Ejecución programada: mismo lote publicado desde la web

La prueba real se amplió tras leer la foto y el PDF originales: el lote creado por el formulario web es ahora exactamente el mismo que se puja, cierra mediante worker y consulta como orden. Se retiró la segunda publicación API usada por la prueba histórica. Se añadió recuperación de sesión/snapshot tras recarga y rechazo opaco del detalle de la orden al ingresar desde la web con otra organización.

No se cambiaron reglas de negocio ni contratos: se conserva el anti-sniping predeterminado, se programa desde el formulario un cierre a dos o tres minutos y se espera al worker. La suite dispone de 270 segundos para este caso. Validación local sin DB: TypeScript focal correcto, un caso detectado, 30 guardias y 5 unitarios web correctos. Evidencia de CI del código final en [#37](https://github.com/Nicolas923-source/Ganadito/pull/37); el estado histórico de los apartados siguientes no sustituye esa comprobación.

La auditoría de propiedad, nuevas revisiones de Nicolás y límites están en [SEGUIMIENTO_FOTO_2026-11-04.md](SEGUIMIENTO_FOTO_2026-11-04.md). La revisión cruzada de Nicolás y los hallazgos de backend pendientes siguen siendo necesarios para aceptar la entrega.

Resultado posterior: [CI 41931985620](https://github.com/Nicolas923-source/Ganadito/actions/runs/41931985620) correcta en sus tres jobs, cabeza web `3a349f3` y merge de prueba `ca56977` con la nueva N05 `e657d77`. Backend 113/113, web 5/5, configuración 36/36, proxy 2/2, fixtures 58/58, HTTP 2/2 y recorrido real 1/1 (2.5 minutos). Este último ya publica, puja, recupera, cierra por worker y consulta la orden del mismo lote UI; también comprueba aislamiento API y navegador frente a organización ajena. Después se incorporó N05 original sin modificaciones; el HEAD final y su CI se fijan en #37. Las [recomendaciones](DECISIONES_PENDIENTES_FOTO_2026-11-04.md) se documentaron después de esta comprobación y siguen sin acuerdo.

## Seguimiento: instancia destruida y aprobación delegada

El propietario autorizó posteriormente que Codex registre aprobaciones de cambios de Nicolás revisados y comprobados. #27 ya estaba aprobado personalmente; #25 y #28 se aprobaron por delegación en l