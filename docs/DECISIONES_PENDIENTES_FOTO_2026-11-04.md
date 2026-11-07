# Tres propuestas de la foto y seguimiento

> **Documento histórico.** Su estado fue reemplazado por [ACTA_ACEPTACION_V01_V06.md](ACTA_ACEPTACION_V01_V06.md) (PR #53) y por los PR #54–#58. Se conserva como evidencia; no describe el estado actual.

## Seguimiento vigente — 5 de noviembre de 2026

El texto siguiente conserva las propuestas formuladas sobre la base histórica de la foto; sus descripciones de código no describen automáticamente main `5b73e470`.

- **WS:** Nicolás añadió en #47 validación de membresía en los accesos ticket/Bearer y supervisión durante la conexión, con revalidación periódica (30 s predeterminados). Eso sustituye la antigua ausencia de comprobación. Aún se debe aceptar el consumidor web y su recuperación/revocación antes de habilitar su transporte. No se afirma revocación instantánea ni revisión humana completada.
- **Idempotencia:** #50 reserva por usuario/operación/clave y liga los nuevos registros a su organización original; otra organización obtiene `409 IDEMPOTENCY_KEY_OTRO_CONTEXTO`. Esto implementa la alternativa de conflicto propuesta, no claves independientes por organización. La compatibilidad de registros heredados y los criterios de aceptación se contrastan con el contrato vigente de Nicolás; no se atribuye a este documento un acuerdo nuevo sobre ellos.
- **Hashes públicos:** Víctor aprobó expresamente la exclusión de ambos hashes y la transferencia V05. #50 ya implementa esta política en el servicio y DTO públicos. Se conservan los originales, los hashes privados y el resumen de verificación, sin HMAC ni reescritura histórica. La web y sus pruebas se entregan para revisión cruzada.

Estas referencias reconocen trabajo incorporado por Nicolás. No son aprobación de toda su superficie WS/IA ni una habilitación de producción.

Revisión posterior: [#47](https://github.com/Nicolas923-source/Ganadito/pull/47#pullrequestreview-5785067356) necesita acotar la revalidación cuando PostgreSQL no responde (una consulta pendiente mantiene la suscripción); [#50](https://github.com/Nicolas923-source/Ganadito/pull/50#pullrequestreview-5785012960) necesita proteger también los recibos heredados con organización NULL. Se reconocen las correcciones válidas sin dar por completadas estas dos políticas. Detalle reproducible y alcance en [HITOS_VICTOR_2026-11-05.md](HITOS_VICTOR_2026-11-05.md).

## Propuestas históricas — 4 de noviembre

Se formulan después de verificar la unidad de aceptación: [CI 41931985620](https://github.com/Nicolas923-source/Ganadito/actions/runs/41931985620), cabeza web `3a349f3`, merge de prueba `ca56977` con N05 `e657d77`. Los tres jobs pasaron; el caso real recorrió el mismo lote publicado desde la web hasta la orden, con recarga y aislamiento. Esto no aprueba estas propuestas ni habilita WS, pagos o pasaporte público. No se modificaron contratos para implementarlas.

## 1. Revocar una membresía durante una conexión WS

**Recomendación:** cortar la conexión afectada y retirar todas sus suscripciones y contexto. También revisar cambio de organización/rol y expiración. Hoy `subastas.ws.ts` verifica JWT al conectar, pero no reutiliza la comprobación vigente de membresía del middleware HTTP ni mantiene contexto de autorización revocable en el hub.

Nicolás debe acordar y diseñar una identidad de conexión (usuario, organización, rol y vencimiento), validar membresía en PostgreSQL al conectar y notificar su revocación después de confirmar la transacción. Un aviso interno entre instancias puede acelerar el cierre y la limpieza, pero Redis no es la autoridad de permisos. Su [Pub/Sub no garantiza reentrega](https://redis.io/docs/latest/develop/pubsub/); hace falta recuperación ante avisos perdidos y revalidación acotada, incluso para conexiones inactivas. Definir una latencia máxima de revocación; una comprobación periódica no garantiza revocación instantánea. Si no se puede validar autorización, suspender la ent