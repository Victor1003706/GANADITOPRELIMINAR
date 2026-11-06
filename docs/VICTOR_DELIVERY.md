# Entregas de Víctor: aceptación y cola de PR

Alcance inicial del plan: acceso y organización → lote → puja → cierre → orden pendiente de pago, con datos ficticios. Mayoristas, GMX, logística, IA y pasarela real corresponden a bloques posteriores. Base inspeccionada: `dde293bc977ac090d631b6c90a2cb4bb6efcb40e` del repositorio `Nicolas923-source/Ganadito`.

**Seguimiento vigente, 5 de noviembre:** base `5b73e470`, #37/#44 ya integrados por otras acciones. La nueva entrega V05 adopta los originales de privacidad de Nicolás #46/#50 y añade interfaz, pruebas de privacidad real y web compilada. Ver [matriz de los 24 hitos](HITOS_VICTOR_2026-11-05.md) para evidencia, hallazgos actuales y las seis aceptaciones de Nicolás; los estados de PR y defectos que figuran abajo son históricos y no se deben repetir sin consultar GitHub actual.

## Matriz de aceptación

| Tarea | Rutas de Víctor | Evidencia necesaria |
|---|---|---|
| V01: base web | `apps/web/**`, integración asignada | Web ejecutable; URL API y cliente coherentes; carga, error, reintento y ausencia visibles; sin sustitución automática con demo. |
| V02: acceso/contexto | Web de acceso y sesión | Login y contexto coinciden con la sesión devuelta; expiración y 401/403 producen estado visible; selección no concede permisos locales. |
| V03: lotes/subastas | Publicación, consulta y sala web | ID solicitado correcto; validación de entradas; respuestas reales del servidor; una puja pendiente no aparece como aceptada. |
| V04: órdenes/reconexión | Web de órdenes y WS | Snapshot oficial tras reconexión; cierre y orden corresponden al lote; pago permanece indisponible; no deducir ganador por temporizador. |
| V05: mapa/Spot/trazabilidad | Rutas y componentes web | Consultas autorizadas, errores y ausencia claros; ningún dato privado completado por el navegador; demo solo mediante modo explícito. |
| V06: navegador/staging | `tests/e2e/**`, CI, despliegue | Recorrido desde navegador, versiones web/API y migraciones identificadas, recuperación documentada y revisión final de Nicolás. |

Implementar una pantalla o pasar pruebas aisladas no cierra por sí solo una fila. La aceptación de integración exige API real, datos ficticios y revisión cruzada. Registrar los resultados concretos en el PR y en el [registro de staging](../infrastructure/deployment/release-record.example.md).

## Cola de integración

| Orden | PR / editor | Contenido | Condición de avance |
|---|---|---|---|
| 1 | Contratos / Nicolás | Acceso, lotes, lectura de órdenes, WS y privacidad; ver [brechas](CONTRACT_REVIEW.md). | Revisión de Víctor e integración en `main`. |
| 2 | Dependencias / Víctor | Solo manifiestos npm y lockfile coherentes; versiones y motivo de cada biblioteca. | Revisión de Nicolás, `npm ci` y comprobaciones de paquetes afectados. |
| 3 | Integración / Víctor | Scripts, variables, CI y documentación, separados del PR de backend. | Revisión de Nicolás; cada comando corresponde a un script existente. |
| 4 | N01/N02 / Nicolás | Arranque, sesión, permisos por organización. | Revisión de Víctor y prueba real de acceso/denegación. |
| 5 | V01/V02 / Víctor | Cliente web, base y acceso conforme al contrato. | Revisión de Nicolás y navegador con API real. |
| 6 | N03 y V03 | Backend de subastas y frontend, en PR separados por editor. | Publicación, puja, reintentos y concurrencia aprobados conjuntamente. |
| 7 | N04 y V04 | Cierre/órdenes/workers y pantallas/reconexión, en PR separados. | Cierre sin duplicados, orden persistida y snapshot coincidente. |
| 8 | N05 y V05 | Lecturas autorizadas y pantallas, en PR separados. | Privacidad y recorrido integrado comprobados. |
| 9 | V06 / Víctor | Pruebas navegador, CI, staging y recuperación. | Sin bloqueantes, revisión del código final y pagos externos desactivados. |

Una entrega web aislada puede revisarse antes si no rompe el modo operativo; las dependencias y contratos pendientes quedan explícitos. La cola describe el orden requerido y no afirma que estos PR ya existan ni que estén aprobados. Una rama de trabajo agregada debe dividirse en estas entregas antes de integrar.

Actualización del 4 de noviembre de 2026: #29 contractual está integrado por autorización expresa; #35 y #36 de Víctor permanecen en borrador. La rama `feature/victor/v04-v06-integracion-nicolas` adapta la web al backend N01–N05 y prepara una prueba real efímera de CI, sin fusionar PR de código. Estado y evidencia en [VALIDATION_VICTOR.md](VALIDATION_VICTOR.md); bloqueos de Nicolás en [REVIEW_NICOLAS_2026-11-04.md](REVIEW_NICOLAS_2026-11-04.md).

## Qué prueba cada nivel

- **Typecheck/build/lint:** coherencia estática y compilación de la versión probada. Un script sin reglas de lint no acredita estilo de todos los paquetes.
- **Tests backend:** lógica, persistencia y permisos cubiertos por esas pruebas sobre PostgreSQL/Redis aislados de CI.
- **E2E con respuestas controladas:** comportamiento del navegador, peticiones, errores, expiración y recuperación de la interfaz. Los fixtures se identifican en tests y reporte; no certifican concurrencia, aislamiento de organizaciones, cierre ni persistencia de la API real.
- **Recorrido integrado en staging:** web + API + PostgreSQL/Redis/worker reales con datos ficticios y contrato revisado. Este nivel sigue pendiente mientras falten N01, las lecturas de órdenes o cualquier contrato requerido.

## Cierre de una tarea

- [ ] Un editor y rutas coinciden con [OWNERSHIP.md](OWNERSHIP.md); excepciones o reservas documentadas.
- [ ] Contrato, dependencias y SHA de prueba identificados; sin hallazgos bloqueantes.
- [ ] Checks correspondientes pasan con evidencia adjunta, incluyendo CI del código final.
- [ ] Nicolás revisó el PR final de Víctor; cada autor corrigió su propia entrega.
- [ ] Pantalla y API real se probaron juntas cuando la entrega conecta ambas.
- [ ] Cambios de entorno o esquema tienen procedimiento y responsable; producción sigue separada.

La revisión de un asistente ayuda a encontrar fallos, pero no sustituye la revisión cruzada del otro programador exigida por el plan.
