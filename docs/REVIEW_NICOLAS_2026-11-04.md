# Revisión de las entregas de Nicolás — 4 de noviembre de 2026

Revisor: Víctor con Codex. La revisión conserva la propiedad de archivos: no se corrigió código de API, SQL ni contratos de Nicolás. Sus commits se reunieron sin modificaciones en una rama aislada para verificar la integración; no se fusionaron en `main`.

## Seguimiento vigente — 5 de noviembre de 2026

El registro siguiente es histórico. Main `5b73e470` ya incluye #37/#44 y #46–#50 incorporados por otras acciones. No repetir como abiertos seed, preflight, cursor, reloj, coordenadas Spot ni la antigua ausencia de DTO/proyección pública. #46/#50 aportan los originales de privacidad que adopta V05; se registraron dos hallazgos nuevos: [dirección nullable, #46](https://github.com/Nicolas923-source/Ganadito/pull/46#pullrequestreview-5785013448), corregida en la entrega propia bajo transferencia, y [recibos heredados sin contexto, #50](https://github.com/Nicolas923-source/Ganadito/pull/50#pullrequestreview-5785012960), a cargo de Nicolás. Evidencia y límites actuales en [HITOS_VICTOR_2026-11-05.md](HITOS_VICTOR_2026-11-05.md). No se autoaprueba la entrega de Víctor ni se ejecutan fusiones/despliegues.

#47 corrige membresía de Bearer y revocación respondida; conserva un [P2 nuevo ante consultas de revalidación pendientes](https://github.com/Nicolas923-source/Ganadito/pull/47#pullrequestreview-5785067356), reproducido sin DB. Requiere deadline/cierre y prueba de ausencia de respuesta. CI exacta 41973099098 verde no cubre ese caso. El WS web continúa apagado; no se repiten los hallazgos antiguos corregidos.

Revisión adicional de etapas IA: [#48](https://github.com/Nicolas923-source/Ganadito/pull/48#pullrequestreview-5785161553), respuesta de una vista con `vistas` malformado/vacío consume una rama que no validó; [#49](https://github.com/Nicolas923-source/Ganadito/pull/49#pullrequestreview-5785161842), LOOCV casi singular recomendado pese a perder rango por fold. Ambos P2 reproducidos con fuentes exactas y fixtures sin DB/red, CI exactas 41973803881/41974281308 verdes; no se aprobaron ni se editaron sus rutas. Las correcciones anteriores válidas se reconocen. La evidencia V05 de Víctor está en #51; no habilita IA de campo.

## Seguimiento durante la ejecución programada posterior al informe

El registro de abajo conserva sus SHA históricos. GitHub muestra #27/#25/#28 ya fusionados en main `830a6eb`; no se ejecutaron esas fusiones desde esta revisión. Nicolás publicó #32 `18b30bac` (reloj tras bloqueo e inicio futuro), #33 `2d943fd` (logs sin credenciales) y #34 `e657d77` (privacidad Spot), propagados hasta N05. Sus deltas se revisaron y sus nuevas regresiones pasaron dentro de la [CI integrada 41931985620](https://github.com/Nicolas923-source/Ganadito/actions/runs/41931985620): 113/113 backend y tres jobs verdes. Falta CI individual de esos SHA; no se aprobaron sus dependencias bloqueadas.

Quedan pendientes el P1 de seed #26, preflight #30, cursor de microsegundos #33 y los dos P2 de metadata/DTO #34. Los cuatro hallazgos corregidos en código no se reiteran como abiertos en la nueva base. Ver [seguimiento de la foto](SEGUIMIENTO_FOTO_2026-11-04.md) para la atribución de rutas, límite de la evidencia y detalle P3 del test Spot. Las [tres recomendaciones](DECISIONES_PENDIENTES_FOTO_2026-11-04.md) siguen sin acuerdo: no cambian contratos ni habilitan funciones. La revisión cruzada de Nicolás a Víctor sigue pendiente.

## Contrato y secuencia

El usuario autorizó expresamente **solo** la aprobación y fusión del PR [#29](https://github.com/Nicolas923-source/Ganadito/pull/29). Se comprobó que contenía únicamente `docs/api/contrato-v1-acceso-lotes.md`, SHA `70fc1a5`, CI correcta y base `main`. Se revisaron rutas, sesión, errores, idempotencia, eventos y lectura de órdenes. Quedó integrado en `2ffe7d4`. Esto no aprueba las implementaciones de backend ni sus migraciones.

N01 aporta arranque real y migraciones versionadas; N02 agrega permisos por organización/rol; N03 endurece pujas; N04 agrega órdenes y nueva proyección WS; N05 agrega privacidad de lecturas. La rama N05 ya contiene N01/N02/N03/N04, A1/outbox, A2/roles y N06/pagos; A4/seed sigue independiente. No contar los commits heredados como cambios nuevos de cada PR.

## Dictámenes técnicos y aprobaciones

Las guías iniciales pedían **Approve personal de Víctor**. Los dictámenes se publicaron primero como `COMMENT`. Después el propietario delegó expresamente en Codex aprobar cambios correctos de Nicolás ya revisados y comprobados. Esa autorización posterior sustituye la restricción de clic personal y no autoriza fusiones ni aprobación de PR propios. Si cambia el SHA, repetir la revisión pertinente. Se comprobó que #27 ya tenía aprobación personal; no se duplicó.

| PR / SHA revisado | Dictamen y evidencia | Siguiente paso |
|---|---|---|
| [#27, `92d1f26`](https://github.com/Nicolas923-source/Ganadito/pull/27#pullrequestreview-5773769668) | Sin bloqueantes nuevos en N06: HMAC sobre cuerpo original y timestamp, comparación constante, flag apagado, orden/transacción bloqueadas y efecto/outbox atómicos. Smoke puro de firmas correcto; [CI exacta](https://github.com/Nicolas923-source/Ganadito/actions/runs/41872793506) verde. | Aprobado personalmente por Víctor el 4 de noviembre. No certifica proveedores ni cobros reales; sin fusionar. |
| [#25, `b748424`](https://github.com/Nicolas923-source/Ganadito/pull/25#pullrequestreview-5773770119) | Sin bloqueantes nuevos en A1: bucle continuo, exclusión `inFlight` y espera acotada. Harness en memoria cubre errores, drenaje, timeout y reinicio; [CI exacta](https://github.com/Nicolas923-source/Ganadito/actions/runs/41872796027) verde. La limitación de espera indefinida del texto viejo ya fue corregida. | [APPROVED por delegación](https://github.com/Nicolas923-source/Ganadito/pull/25#pullrequestreview-5774223703); sin fusionar. #30 hereda estos commits, no requiere reimplementarlos. |
| [#28, `ff49ba0`](https://github.com/Nicolas923-source/Ganadito/pull/28#pullrequestreview-5773770542) | Sin bloqueantes nuevos en A2: whitelist antes de conectar DB y ruta sin propagación de opciones internas. Harness de roles/payloads correcto; [CI exacta](https://github.com/Nicolas923-source/Ganadito/actions/runs/41872794379) verde. | [APPROVED por delegación](https://github.com/Nicolas923-source/Ganadito/pull/28#pullrequestreview-5774224266); sin fusionar. Selector comercial web conectado en #37. |
| [#31, `6557220`](https://github.com/Nicolas923-source/Ganadito/pull/31#pullrequestreview-5773770989) | Sin bloqueantes nuevos en el diff propio de N02: membresía exacta, contexto activo, guardas de rol y aislamiento fiscal/CAVALI/traza. Sus commits originales están incluidos en la [CI integrada](https://github.com/Nicolas923-source/Ganadito/actions/runs/41885077011), 108 backend y recorrido real correctos. | Sin aprobar: resolver dependencias, incluido #30, y exigir CI individual del SHA final. No acepta N03/N04/N05. |

El resto de los PR conserva solicitudes de cambios. El orden de fusión se documenta en [GIT_WORKFLOW.md](GIT_WORKFLOW.md); una CI verde no anula un hallazgo reproducible.

## Hallazgos para corregir por su autor

| PR / revisión fijada | Prioridad | Hallazgo y caso | Corrección solicitada |
|---|---|---|---|
| #26, `894ad3a` | P1 | `seed.ts:46` valida `new URL(DATABASE_URL).hostname`, mientras el driver admite sobrescribir host por query. `postgresql://localhost/seed_demo?host=remote.example.invalid` pasa como local y `pg-connection-string` resuelve destino remoto. | Validar el destino efectivo del driver o rechazar overrides antes de toda conexión/migración. |
| #30, `ba8eb8d` | P2 | `server.ts:43-57` consulta DB y aplica migraciones antes de validar JWT en `buildApp`; pagos se valida durante `ready/listen`. Con migración habilitada y configuración inválida, puede confirmar cambios de esquema antes de rechazar el arranque. Reproducción en memoria del bootstrap exacto: `database_query → run_migrations → redis_subscriber → validate_config`, seguido de rechazo del resolver real con secreto ficticio corto. | Preflight puro de JWT y pagos antes de conexiones/migraciones/Redis; regresión de configuración inválida con cero consultas y cero migraciones. El servidor sí rechaza el secreto inseguro: no se afirma un bypass de autenticación. |
| #32, `fed849e` | P1 | `subastas.service.ts:299-300` usa `NOW()` fijado al comenzar la transacción antes de esperar `FOR UPDATE`. Bloquear un lote, enviar puja antes del cierre y liberar después: el chequeo conserva tiempo anterior. Es un caso de reproducción por ejecutar en DB aislada. | Evaluar el reloj real después de obtener el bloqueo; añadir regresión con dos conexiones y anti-sniping desactivado. |
| #32, `fed849e` | P2 | Snapshot calcula `es_abierta` solo con estado y cierre (`:193`), pero la nueva escritura rechaza inicio futuro (`:323-324`). Un lote ACTIVO con inicio futuro aparece abierto aunque toda puja es rechazada. | Incluir inicio en el cálculo oficial y probar coherencia snapshot/POST. |
| #33, `503adf2` | P1 | WS acepta JWT en `access_token` (`subastas.ws.ts:187-189`), y `server.ts:57` habilita logger sin redacción. Ensayo local Fastify con marcador sintético confirmó que incoming request registra toda la URL. | Redactar credencial antes de escribir logs o acordar ticket efímero de alcance WS. No habilitar este transporte en producción mientras tanto. |
| #33, `503adf2` | P2 | `ordenes-consulta.service.ts:35` convierte timestamptz a Date/ms para el cursor; el filtro `:82` compara con precisión de microsegundos. Fechas `.123900` y `.123800`, limit=1: el cursor `.123000` omite la segunda. El parser OID1184 confirmó la pérdida. | Conservar precisión de la clave ordenada dentro del cursor; regresión con valores en el mismo milisegundo. |
| #34, `4e636bc` | P1 | Mapa aproxima establos ajenos, pero `spot.service.ts:195-196` aún publica ST_Y/ST_X exactos por `/cotizaciones/pizarra`, junto con establecimiento_id. | Aplicar la misma política de privacidad a todas las lecturas públicas, incluido Spot. |
| #34, `4e636bc` | P2 | Redacción por regex (`trazabilidad.service.ts:13,21-22`) deja `dirección`, `teléfono` y `conductor:{nombre,documento}`. La metadata libre se expone en pasaporte público. Una prueba pura con datos ficticios lo confirmó. | Acordar proyección pública explícita o esquema público permitido; cubrir claves acentuadas, anidadas y texto libre. |
| #34, `4e636bc` | P2 | Respuesta nueva añade `vista`, `ubicacion_aproximada` y autor/dirección nullable, pero los tipos compartidos no lo representan; aparece `null as unknown as string`. | Publicar DTO tipado consistente antes de cerrar V05, sin casts que oculten nulabilidad. |

Los marcadores y ejemplos anteriores son ficticios. No se usaron JWT reales para reproducir logs ni se conectó el seed a una base de datos.

Revisiones `REQUEST_CHANGES` publicadas sobre los SHA de la tabla: [#26](https://github.com/Nicolas923-source/Ganadito/pull/26#pullrequestreview-5769055166), [#32](https://github.com/Nicolas923-source/Ganadito/pull/32#pullrequestreview-5769055482), [#33](https://github.com/Nicolas923-source/Ganadito/pull/33#pullrequestreview-5769055789) y [#34](https://github.com/Nicolas923-source/Ganadito/pull/34#pullrequestreview-5769056109).

Revisión adicional del arranque: [#30](https://github.com/Nicolas923-source/Ganadito/pull/30#pullrequestreview-5773771360). Se comprobó con dependencias instrumentadas, sin conexiones ni SQL, y se contrastó en una segunda revisión técnica.

Actualización posterior revisada: N05 `26e8179` incorpora cambios originales de Nicolás en parada acotada de workers (cinco segundos), prueba de ciclo colgado y puerto API 4000. Se revisó su diff completo y se incorporó como baseline de verificación, sin modificar fuentes de API. Los cambios no corrigen los hallazgos de la tabla; las solicitudes de cambios siguen vigentes.

## Decisiones que requieren coordinación

- N03 no incluye organización activa en la huella de idempotencia. Definir si repetir la misma clave tras cambiar de organización consulta la operación original o es un conflicto; la web crea claves distintas para intenciones/contextos nuevos.
- El WS verifica firma y expiración, pero no la membresía/contexto actuales del middleware HTTP. Definir revocación y alcance de la sala antes de su habilitación.
- Conservar hashes públicos de metadata privada de baja entropía permite verificar candidatos por diccionario. Se demostró con datos sintéticos. Acordar qué evidencia de integridad debe ser pública; no cambiar la cadena ni su contrato unilateralmente.
- El contrato de acceso podría explicitar el DTO de `user` y perfil, hoy descrito por nombre; los consumidores actuales se contrastaron con la implementación.

## Trabajo de Víctor desbloqueado

- Configurar scripts N01 y carga explícita de `.env` raíz, alinear API 4000/proxy y mantener pagos apagados.
- Permitir autorregistro COMPRADOR/VENDEDOR y consumir el contexto confirmado.
- Implementar GET de listado/detalle de órdenes, estados vacíos, cursor y cambio de contexto, con pago no disponible.
- Adaptar parser del envelope público WS, pero conservarlo apagado por defecto por el hallazgo de logs. El modo HTTP consulta snapshots oficiales y envía pujas REST; el servidor mantiene toda decisión comercial.
- Añadir CI con navegador y API reales sobre DB/Redis efímeros, sin trazas con credenciales, seeds ni conexiones a Neon o bases locales existentes.

No se declara aceptación final ni privacidad resuelta mientras permanezcan los hallazgos de backend y la revisión cruzada de los cambios de Víctor.
