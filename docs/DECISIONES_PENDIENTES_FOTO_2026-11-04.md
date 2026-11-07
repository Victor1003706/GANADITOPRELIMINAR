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

Nicolás debe acordar y diseñar una identidad de conexión (usuario, organización, rol y vencimiento), validar membresía en PostgreSQL al conectar y notificar su revocación después de confirmar la transacción. Un aviso interno entre instancias puede acelerar el cierre y la limpieza, pero Redis no es la autoridad de permisos. Su [Pub/Sub no garantiza reentrega](https://redis.io/docs/latest/develop/pubsub/); hace falta recuperación ante avisos perdidos y revalidación acotada, incluso para conexiones inactivas. Definir una latencia máxima de revocación; una comprobación periódica no garantiza revocación instantánea. Si no se puede validar autorización, suspender la entrega privada y cerrar según la política acordada.

Criterios antes de habilitarlo: revocación antes/después del handshake, sockets inactivos, cambio de contexto/rol, expiración, varias instancias, aviso perdido o duplicado, reinicio de Redis y fallo de PostgreSQL. Ninguna suscripción revocada conserva acceso; los demás usuarios permanecen aislados. La corrección del log de URL por sí sola no resuelve esto. El transporte WS de la web sigue apagado; la API conserva registrado su endpoint y no se afirma que esté deshabilitado en el servidor.

## 2. Misma Idempotency-Key después de cambiar de organización

**La propuesta de la foto combina dos reglas distintas:** un ámbito independiente `(usuario, organización, clave)` permite reutilizar la misma cadena en otra organización como operación nueva; no produce por sí mismo un 409 entre organizaciones.

**Recomendación si se busca ese 409:** reservar la clave por usuario y vincularla a la organización de la intención original, incluyendo organización en la huella persistida. Un reintento desde otra organización debe devolver un conflicto de contexto sin revelar recibo, IDs privados ni importes originales. Hay que acordar un código de error específico; no confundirlo con `IDEMPOTENCY_IN_PROGRESS`. El modelo actual de N03 reserva por usuario/clave y su huella omite la organización; repetir el mismo lote/importe después del cambio puede devolver el recibo anterior con 201.

Mantener: misma organización y mismo cuerpo devuelve el recibo original; mismo contexto con otro cuerpo conserva el 422 `IDEMPOTENCY_KEY_REUSED`; operación simultánea en curso conserva su 409 vigente. Una intención nueva usa una clave nueva, como ya hace la web al cambiar de contexto. La alternativa coherente es permitir claves independientes por organización y renunciar al 409 por mera coincidencia entre ellas.

Pendiente de acuerdo: elegir una semántica, compatibilidad de registros existentes, contrato del error y, si procede, migración por Nicolás. Probar A→B→A, usuarios distintos, cuerpos distintos y concurrencia: sin segunda puja accidental ni devolución de recibos de otra organización. No se implementa unilateralmente ninguna de las dos opciones.

## 3. Hashes de metadata privada en respuestas públicas

**Recomendación:** omitir tanto `current_hash` como `prev_hash` de la proyección pública cuando derivan de metadata privada; conservar la cadena privada histórica y su verificación autorizada. El contrato de consulta actual dice que se mantienen los hashes, por lo que primero debe acordarse su cambio. No recalcular ni reescribir el historial para adaptar una respuesta pública.

No hace falta añadir HMAC por defecto. Si se acuerda una necesidad concreta de autenticidad, un [HMAC](https://www.rfc-editor.org/info/rfc2104/) puede usar una clave solo del servidor, propósito/ámbito definidos y versión para rotación y verificación histórica. No cifra el dato ni permite verificación pública independiente sin la clave, y un valor estable puede facilitar correlación. No se generó ni imprimió ningún secreto.

La salida pública necesita además una lista explícita de campos permitidos; ocultar hashes no corrige la metadata libre que aún expone N05. Probar ausencia de ambos hashes y datos privados en vista pública, acceso autorizado del dueño e integridad privada sin cambios. La adaptación V05 y la aceptación de privacidad esperan contrato/DTO coherentes y revisión cruzada. La ruta pública de pasaporte en la web sigue apagada; el endpoint de API continúa registrado y requiere sus correcciones.

## Estado del acuerdo

Las tres recomendaciones están propuestas para Víctor y Nicolás; ninguna consta aprobada. Las rutas de API, SQL y contratos continúan a cargo de Nicolás. CI y este documento no sustituyen esa decisión ni la revisión final de los PR propios de Víctor.
