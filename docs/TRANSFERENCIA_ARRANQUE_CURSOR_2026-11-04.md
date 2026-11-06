# Transferencia temporal: arranque y cursor

> **Documento histórico.** Su estado fue reemplazado por [ACTA_ACEPTACION_V01_V06.md](ACTA_ACEPTACION_V01_V06.md) (PR #53) y por los PR #54–#58. Se conserva como evidencia; no describe el estado actual.

**Autorización:** Víctor respondió expresamente en este chat «Sí, autorizo esa transferencia temporal» a la solicitud que fija tarea, rutas y condición de fin, el 4 de noviembre de 2026 (Bogotá).

**Tarea:** corregir el preflight de JWT/pagos antes de conexiones/migraciones y preservar la precisión temporal del cursor de órdenes, sin cambiar la semántica de negocio ni sus contratos.

**Editor temporal:** Víctor con Codex. Base final aislada: 03722fc, rama de integración #37; contiene main original 526a22d y la CI completa. No se edita la rama de Nicolás.

**Rutas transferidas:** `apps/api/src/server.ts`, validación de configuración usada por ese arranque, `apps/api/src/subastas/ordenes-consulta.service.ts` y pruebas backend específicas de esos dos defectos. No se transfieren SQL/migraciones, contratos, privacidad ni IA.

**Inicio:** al registrar este documento, antes de editar las rutas transferidas.

**Actualización de alcance sin ampliar rutas:** mientras se preparaban los arreglos, Nicolás fusionó #43 con el preflight y el cursor de microsegundos. Se adoptaron sus fuentes originales, sin duplicar nuestras implementaciones. El trabajo previo quedó conservado únicamente en el commit local 7663f13, sin publicar. El cambio de producción propio final se limita a validar calendario/horas del cursor antes de SQL conservando su cadena original; se añaden regresiones de preflight, precisión, calendario y PostgreSQL de CI. `server.ts` final es idéntico al de Nicolás. Los tests y la guardia de workflow complementan su entrega; la condición de revisión por Nicolás sigue vigente.

**Condición de fin:** entregar un PR aislado y verificado con sus regresiones y CI final. Nicolás revisa el arreglo; Codex no registra Approve sobre su propia corrección. Después de la entrega cesa esta reserva temporal. No se fusiona PR ni se despliega.

**Protección de datos:** pruebas reales solo en PostGIS/Redis efímeros de CI; nunca PostgreSQL local existente ni Neon. Los casos locales puros no conectan, migran ni ejecutan SQL real.
