# Revisión y avance conjunto - corte técnico actual

> **Documento histórico.** Su estado fue reemplazado por [ACTA_ACEPTACION_V01_V06.md](ACTA_ACEPTACION_V01_V06.md) (PR #53) y por los PR #54–#58. Se conserva como evidencia; no describe el estado actual.

Fuentes: main `526a22d4beeaa5d4c490481b72d536a475d73379`; base web #37 `03722fcdba4bf303b9a61c5414720ffc1add44e7`. Las fusiones de Nicolás ya estaban realizadas por otras acciones; Codex no fusionó PR ni desplegó. Esta revisión distingue código integrado, ramas de Víctor y aceptación pendiente.

## Aprobaciones reales

- [#26, APPROVED 5779178848](https://github.com/Nicolas923-source/Ganadito/pull/26#pullrequestreview-5779178848), SHA b669b875, [CI exacta 41935268543](https://github.com/Nicolas923-source/Ganadito/actions/runs/41935268543): guardia de seed contra host/puerto/socket por query antes de conexiones. Revisión posterior a fusión ya existente, sin ejecutar seed sobre datos reales.
- [#39, APPROVED 5779179126](https://github.com/Nicolas923-source/Ganadito/pull/39#pullrequestreview-5779179126), SHA 6d73073a, [CI exacta 41942794210](https://github.com/Nicolas923-source/Ganadito/actions/runs/41942794210): limpieza de fixtures por IDs propios y orden de dependencias. Revisión posterior a fusión existente, no autorización de borrado de datos reales.
- Se conservan las aprobaciones históricas de #27 (Víctor), #25/#28 (Codex por delegación sobre b748424/ff49ba0) y contrato #29. No se presentan como nuevas ni se extienden a dependencias bloqueadas.

## Cambios nuevos de Nicolás revisados

Nicolás publicó #41, #42 y #43 durante la ejecución. Se revisaron sus deltas completos y CI exactas verdes; una CI verde no elimina los casos no cubiertos. Sus fuentes originales se incorporaron a #37 sin modificar rutas reservadas.

| PR | Correcciones reconocidas | Pendientes actuales |
|---|---|---|
| #43, be0e14fb | Preflight JWT/pagos antes de dependencias, cursor interno con microsegundos y allowlist de metadata para tipos válidos. Se cierran esos hallazgos anteriores, no se repiten como abiertos. | P2 nuevo: tipos constructor/toString/__proto__ heredados provocan TypeError en allowlist; DTO de privacidad sigue sin nulabilidad/vista coherentes. Calendario regex-only llega a SQL con fechas imposibles: corrección propia bajo transferencia en este PR. |
| #42, f5e87a5a | Ticket aleatorio de 256 bits, hash en PostgreSQL, 30 segundos y un uso con contexto/membresía; redacción de ticket. | Alternativa Bearer todavía verifica solo JWT y existencia del lote, eludiendo membresía del ticket; revocación durante conexión pendiente. No se habilita WS web ni se afirma aprobación operativa. |
| #41, 789a6f88 | Persistencia PG de estimación/pesaje no vinculantes y control de lectura; no usa Redis como verdad ni decide precio. | P2: conflicto de interés cambiando organización, replay tras iniciar lote y respuesta IA incompleta que llega a INSERT/500. Habilitación/consentimiento y alcance de evaluación global requieren acuerdo. |
| #40, ae1e19dd | 45 pruebas Python existentes pasan; estimación orientativa/no validada. | Dos P2 sin cambios: factor de escala redondeado a cero y LOOCV no identificable con infinito/null. Sin validación de campo. |

Revisiones nuevas: [#43](https://github.com/Nicolas923-source/Ganadito/pull/43#pullrequestreview-5779801190), [#42](https://github.com/Nicolas923-source/Ganadito/pull/42#pullrequestreview-5779801064), [#41](https://github.com/Nicolas923-source/Ganadito/pull/41#pullrequestreview-5779800898), todas REQUEST_CHANGES. #40 conserva [5779211247](https://github.com/Nicolas923-source/Ganadito/pull/40#pullrequestreview-5779211247). Las comprobaciones focales usaron fuentes exactas, fixtures y fronteras instrumentadas, sin conexiones ni transmisiones a proveedores reales.

## Trabajo propio y transferencia

La [transferencia autorizada](TRANSFERENCIA_ARRANQUE_CURSOR_2026-11-04.md) se limita a arranque/configuración/cursor y sus prue