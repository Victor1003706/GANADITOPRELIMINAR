# Transferencia temporal y decisión de privacidad V05

**Autorización:** Víctor respondió expresamente «Sí, autorizo V05 y esa política pública» en este chat, antes de editar las rutas siguientes. Esta transferencia es distinta de la de arranque/cursor ya finalizada con #44.

**Tarea:** cerrar defectos de lectura de privacidad y DTO, completar la web V05 y su prueba integrada para revisión posterior de Nicolás.

**Editor temporal:** Víctor con Codex. El trabajo inicial sobre `eb5cff9` se preservó en el commit local `93e1cdd`, sin publicar una implementación duplicada. Base de entrega: `5b73e470` de main, después de #37/#44 y las correcciones originales #46/#50 de Nicolás. Rama aislada `codex/victor/v05-privacidad-real`; no editar la rama de Nicolás.

**Rutas de Nicolás transferidas:** `apps/api/src/trazabilidad/trazabilidad.service.ts`, `apps/api/src/mapa/mapa.types.ts`, `packages/contracts/src/traceability.ts`, `docs/api/contrato-v1-consulta.md` y pruebas específicas de estos defectos. No se transfieren WS, pujas/idempotencia comercial, IA, rutas HTTP adicionales, SQL ni migraciones.

**Decisión aprobada:** la vista PUBLICA omite `current_hash` y `prev_hash`; conserva autor/organización como null y metadata pública permitida. La vista COMPLETA y la cadena privada conservan hashes e integridad sin recalcular ni reescribir historial. No se añade HMAC. `/verificar` mantiene su resumen actual sin exponer hashes ni metadata privada.

**Reutilización:** Nicolás ya implementó la validación de tipos, el lookup seguro, el DTO `PasaporteDigitalVista` y la exclusión pública de hashes en #46/#50. La entrega adopta esos originales de main; corrige únicamente `direccion_texto: string | null` en el DTO cercano (la herencia todavía lo hacía obligatorio), añade regresiones puras complementarias bajo esta transferencia, la adaptación web y su prueba integrada. No atribuye los cambios backend originales a Víctor ni repite sus commits. El DTO privado de creación no se debilita.

**Inicio:** con este registro, antes de editar. **Condición de fin:** entregar PR verificado con regresiones y CI del SHA final. Nicolás revisa los cambios; Codex no autoaprueba su entrega ni registra aceptación cruzada en su nombre. No se fusiona ni se despliega por esta autorización.

**Rutas propias de Víctor:** web, navegador, CI/configuración y documentación asignada para adaptar lectura y representación de aproximación, probar privacidad real y el artefacto compilado. Ningún fallo API se sustituye con datos de demostración.

**Datos:** pruebas reales exclusivamente en PostGIS/Redis efímeros de CI y guardias previas; no PostgreSQL local existente ni Neon. Pagos reales y servicios externos no habilitados siguen apagados; WS operativo y publicación pública web siguen diferidos hasta su aceptación correspondiente.

**Entrega verificada:** [#51](https://github.com/Nicolas923-source/Ganadito/pull/51), código `cce1957`, [CI 42029557812](https://github.com/Nicolas923-source/Ganadito/actions/runs/42029557812), cuatro jobs correctos, incluidas las dos pruebas reales con web compilada. Se cumple la condición técnica de fin; la propiedad API vuelve a Nicolás. Los cambios documentales de evidencia no amplían esta transferencia. No se autoaprueba ni se sustituye su revisión final.
