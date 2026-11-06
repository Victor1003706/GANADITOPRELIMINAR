# Seguimiento de foto e informe - plan de aceptación real

**Objetivo:** cerrar la brecha de la prueba real que publicaba un lote UI y usaba otro lote API para el cierre, sin alterar fuentes de Nicolás ni contratos pendientes.

**Fuentes:** foto e informe originales preservados en la automatización del 04/11/2026; informe con corte 14:37 Bogotá y SHA 2d90080. La petición actual exige contrastarlos con GitHub, revisar propiedad y trabajar antes de responder las tres propuestas de contrato.

**Rutas de Víctor:** `tests/e2e/real/auction-order.spec.ts`, documentación no API y este plan. No se transfiere propiedad de backend/SQL/contratos. El PDF histórico y `output/` permanecen intactos.

## Criterios

- [x] Leer ambos originales y verificar SHA/base/CI/revisiones vigentes; separar datos históricos del estado actual.
- [x] Auditar #35/#36/#37: #37 se compara con N05 26e8179, no con main; fuentes de Nicolás idénticas y excepción de manifiesto API documentada.
- [x] Continuar con `uiLot` en snapshot, puja, cierre, listado y detalle. Eliminar la segunda publicación mediante API.
- [x] Publicar cierre normal desde el formulario, con precisión de minutos y margen mayor al anti-sniping predeterminado; no interceptar ni modificar el payload UI.
- [x] Recuperar precio/secuencia y sesión tras recarga; consultar la misma orden como organización ajena desde la UI y verificar 404 opaco sin detalle.
- [x] Verificación local sin conexiones: detección Playwright, TypeScript focal, 30 guardias y 5 unitarios web. Revisión independiente del diff correcta.
- [x] Publicar en #37 y comprobar los tres jobs de CI del cambio 3a349f3, incluidos servicios efímeros reales: ejecución 41931985620, merge de prueba ca56977 con N05 e657d77. Todos correctos.
- [x] Después de la verificación, documentar las tres recomendaciones de la foto diferenciándolas de acuerdos aprobados; no cambiar contratos unilateralmente.
- [ ] Comprobar de nuevo la CI del HEAD final después de incorporar la nueva base N05 original y el seguimiento documental; fijar resultado en #37.

## Decisiones de implementación

El formulario actual no expone anti-sniping y su precisión es de un minuto. Se conserva ese comportamiento: cierre en el siguiente minuto completo posterior a dos minutos desde la publicación (120 a menos de 180 segundos). Se exige más de 75 segundos restantes antes de pujar y `extension_aplicada=false`; el test falla explícitamente si una ejecución lenta entra en la ventana de extensión. No se añade un control de negocio ni un atajo de pruebas a la aplicación. Poll máximo 210 segundos; timeout solo de este caso 270 segundos.

No se ejecuta el test real contra PostgreSQL local existente ni Neon. La suite mantiene las guardias de destino, trazas/vídeo/capturas apagados, pagos/WS desactivados y cierre únicamente mediante worker.

## Dependencias externas que no se ocultan

#32 publicó 18b30bac: los dos hallazgos de reloj/snapshot están corregidos por inspección y tienen regresiones nuevas, pero falta CI exacta y propagación a N04/N05. Los demás PR con solicitudes de cambios no variaron de SHA. La rama #37 conserva N05 26e8179; no se mezcló el nuevo backend en su diff propio. No se aprueban entregas propias ni se fusionan PR.

Lo anterior describe la consulta inicial. Durante la ejecución llegaron N04 2d943fd y N05 e657d77 con las correcciones propagadas y fixes de logs/Spot. Se revisaron y sus regresiones pasaron dentro de la CI integrada; los commits originales se incorporaron sin cambios en fuentes. Falta CI individual para aprobar PR de Nicolás y siguen sus otros bloqueos. La adaptación visual de aproximación de V05 espera contrato/DTO de privacidad acordado; no se da por aceptada. Ver SEGUIMIENTO_FOTO_2026-11-04.md.
