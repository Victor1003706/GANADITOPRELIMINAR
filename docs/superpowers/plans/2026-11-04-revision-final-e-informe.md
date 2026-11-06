# Revisión actual de Nicolás e informe de avance

> **For agentic workers:** usar executing-plans para los pasos de integración y revisión independiente antes de publicar.

**Goal:** revisar el código realmente integrado, aprobar solo cambios correctos de Nicolás con CI exacta y entregar un PDF verificable de ambos programadores y de lo pendiente.

**Architecture:** conservar el monolito y sus contratos. Incorporar main original a #37 sin reescribir fuentes de Nicolás y añadir la verificación Python que falta en CI. La transferencia temporal de arranque/configuración/cursor y pruebas fue autorizada expresamente en el chat; sus arreglos se preparan en un PR aislado, con revisión final de Nicolás y sin autoaprobación.

**Tech Stack:** GitHub Actions, Node 24, Python 3.12, pytest y ReportLab/Poppler para el informe.

**Spec:** petición expresa de revisión/corrección e informe en este chat, matriz OWNERSHIP.md y VICTOR_DELIVERY.md.

## Restricciones

- Preservar output/ y el PDF anterior; no subir secretos ni datos reales.
- No fusionar PR ni desplegar; main y la rama web son entregas distintas.
- Transferencia autorizada solo para server.ts, validación de configuración, ordenes-consulta.service.ts y sus pruebas. SQL, contratos, privacidad e IA continúan reservados. Registrar tarea/rutas/editor/fin antes de editar.
- No ejecutar pruebas contra PostgreSQL local existente o Neon. Servicios reales solo efímeros en CI.
- Las tres propuestas de WS/contexto/hashes siguen sin acuerdo; no cambiar su semántica.

## Trabajo y evidencia

- [x] Inspeccionar status, main 9bfc5e4, PR abiertos/cerrados, revisiones y CI. Todos los PR de Nicolás consultados ya están fusionados por acciones ajenas a esta revisión.
- [x] Revisar seed/bootstrap, subastas/órdenes, privacidad/limpieza y IA en paralelo; reproducir defectos sin conexiones.
- [x] Aprobar #26 b669b875 y #39 6d73073a después de revisar sus deltas y CI exactas; dejar constancia de que son aprobaciones posteriores a fusiones ya existentes.
- [x] Incorporar main en la rama aislada de #37 sin conflictos y con árboles reservados idénticos; typecheck/build locales correctos y 45/45 pytest existentes.
- [ ] Añadir job Python aislado con requirements existentes y pytest completo. No modifica el satélite ni lo publica.
- [ ] Publicar dictámenes actualizados y hallazgos nuevos reproducibles; no aprobar PR con bloqueos ni los propios.
- [ ] Corregir arranque y cursor en un PR separado bajo la transferencia autorizada, con regresiones y CI final; Nicolás revisa esos arreglos.
- [ ] Verificar CI del HEAD final: monorepo, fixtures, recorrido real del mismo lote y Python. Registrar SHA/resultados en #37.
- [ ] Generar PDF nuevo con corte Bogotá, aprobaciones, evidencia, matriz V01-V06 y unidades pendientes; renderizar e inspeccionar todas las páginas.

## Revisión focal

No atribuir CI JavaScript a Python ni confundir tests sintéticos de peso con validación de campo. No contar PR fusionados como requisitos aceptados. El índice de evidencia del flujo inicial se recalcula con la misma matriz de 24 hitos y se separa del avance total de la plataforma, cuyo alcance posterior no tiene denominador aceptado. La falta de revisión cruzada mantiene abiertos los seis bloques de aceptación.
