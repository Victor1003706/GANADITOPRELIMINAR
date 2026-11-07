# Contrato API v1: acceso, lotes, pujas, tiempo real y órdenes

**Estado:** propuesta. Requiere la aprobación de Víctor (paso 2 del protocolo de contratos).
**Base:** `/api/v1` · JSON UTF-8 · autenticación `Authorization: Bearer <access_token>`.
**Política de cambios:** aditiva. Renombrar un campo, cambiar su tipo o su significado obliga a volver a coordinar.

Las marcas indican cuándo entra cada cambio: **[N01]**, **[N02]**, **[N03]**, **[N04]**. Lo que no lleva marca ya está así en `main`.

---

## 0. Convenciones

### Formato de error (todas las rutas)
```json
{ "statusCode": 409, "error": "SubastaError", "message": "texto para humanos", "code": "IDEMPOTENCY_KEY_REUSED" }
```
- `code` es nuevo y **opcional** **[N02+]**. La web decide por `statusCode` y, si viene, por `code`. El texto de `message` no es estable.
- `401`: falta el token o es inválido o expiró. La web vuelve al login.
- `403`: el token es válido pero el rol o la organización no tienen permiso. La web muestra "sin acceso" y **no** vuelve al login.
- `503`: módulo deshabilitado (p. ej. `error: "PagosDeshabilitados"`).

### Dinero y fechas
- Los montos son `number` en **PEN con 2 decimales**. El servidor es la única autoridad. La web no calcula mínimos ni comisiones.
- Las fechas son ISO-8601 en UTC. El tiempo restante oficial es `tiempo_restante_segundos`, calculado con el reloj de la base de datos.

### Roles
`COMPRADOR`, `VENDEDOR`, `OPERADOR_CAMAL`, `TRANSPORTISTA`, `ADMIN`, `AUDITOR`, `OPERADOR`.
Los permisos se evalúan sobre el **contexto activo** (organización + rol) del token.

---

## 1. Salud **[N01]**

`GET /health`, sin autenticación.

| Caso | Código | Cuerpo |
|---|---|---|
| API y base de datos responden | 200 | `{ "status": "ok", "db": "ok", "version": "0.1.0", "timestamp": "..." }` |
| La base de datos no responde | 503 | `{ "status": "degraded", "db": "error", ... }` |

---

## 2. Acceso y contexto

### `POST /auth/register`
```json
{ "email": "a@b.pe", "password": "min 8", "nombre": "Ana", "telefono": "opcional",
  "organizacion_nombre": "opcional", "rol_inicial": "COMPRADOR | VENDEDOR" }
```
- `201`: `{ access_token, token_type: "Bearer", expires_in: 900, user, active_context: { organizacion_id, razon_social, rol } }`
- `400`: faltan campos, contraseña de menos de 8 caracteres, o `rol_inicial` distinto de COMPRADOR o VENDEDOR.
- `409`: el correo ya está registrado.

### `POST /auth/login`
`{ email, password }` → `200` con la misma forma que el registro (`active_context` puede ser `null`) · `401` si las credenciales no son válidas.

### `POST /auth/organizations/switch-context` (autenticado)
`{ organizacion_id, rol }` → `200` `{ access_token, expires_in, active_context }` · `403` si el usuario no tiene esa membresía.
Después de cambiar de contexto, la web **reemplaza el token** y vuelve a pedir `/auth/me`.

### `GET /auth/me` (autenticado)
`200` `{ user, activeContext, memberships: [{ organizacion_id, razon_social, rol, is_active_context, permisos }] }`

**[N02] Regla de sesión:** el servidor acepta el token solo si la membresía `(usuario, organización, rol)` del token **sigue activa**. Si el usuario cambió de contexto desde otra pestaña, el token anterior responde `403` con `code: "CONTEXTO_INACTIVO"`. La web debe ofrecer cambiar de contexto o volver a iniciar sesión.

---

## 3. Lotes de subasta

### `POST /subastas`: publicar un lote **[N02: requiere rol VENDEDOR]**
```json
{ "codigo_lote": "opcional", "precio_base": 4000, "incremento_minimo": 100,
  "fecha_inicio": "opcional ISO", "fecha_cierre": "ISO",
  "anti_sniping_seconds": 60, "anti_sniping_extension": 120, "estado": "ACTIVO | BORRADOR" }
```
- `201`: el lote (`id, codigo_lote, vendedor_id, estado, precio_base, precio_actual, incremento_minimo, fecha_inicio, fecha_cierre, version, ...`).
- `400`: precio o incremento ≤ 0, fechas inválidas, cierre anterior al inicio, valores anti-sniping negativos, o **[N03]** un `estado` distinto de `ACTIVO`/`BORRADOR`.
- `403`: el contexto activo no es VENDEDOR.
- `vendedor_id` = organización activa del token. El cliente no lo envía.

### `GET /subastas/:id/snapshot`: estado oficial (público)
```json
{ "id": "...", "codigo_lote": "...", "estado": "ACTIVO", "precio_base": 4000, "precio_actual": 4500,
  "incremento_minimo": 100, "proxima_puja_minima": 4600, "postor_ganador_id": "...",
  "postor_ganador_nombre": "...", "tiempo_restante_segundos": 312, "fecha_cierre": "...",
  "secuencia_maxima": 7, "version": 8, "es_abierta": true }
```
`404` si el lote no existe. **La web nunca sustituye esta respuesta por datos demo.**

---

## 4. Pujas

### `POST /subastas/:id/pujas` **[N02: requiere rol COMPRADOR]**
Cabecera `Idempotency-Key: <uuid generado por la web, uno por intento lógico>`. El campo `idempotency_key` en el body se acepta por compatibilidad.
```json
{ "monto": 4600 }
```

| Caso | Código | `code` |
|---|---|---|
| Puja aceptada | 201 | |
| Reintento con la misma clave y el mismo monto | 201, misma respuesta que la original | |
| **[N03]** Misma clave con otro monto u otro lote | 422 | `IDEMPOTENCY_KEY_REUSED` |
| **[N03]** La misma clave se está procesando en paralelo | 409 | `IDEMPOTENCY_IN_PROGRESS` |
| **[IDEM-CTX]** La misma clave del mismo usuario después de **cambiar de organización activa** | 409 | `IDEMPOTENCY_KEY_OTRO_CONTEXTO`: generar una clave nueva; no se repite la puja de la otra organización |
| Monto menor que `proxima_puja_minima` | 400 | `PUJA_INSUFICIENTE` |
| El lote no está activo, expiró o **[N03]** todavía no empezó | 400 | `LOTE_NO_ABIERTO` |
| **[N03]** El usuario pertenece a la organización vendedora (con cualquier rol) | 403 | `PUJA_PROPIO_LOTE` |
| Lote inexistente | 404 | |

Respuesta `201`:
```json
{ "puja_id": "...", "lote_id": "...", "monto": 4600, "secuencia": 8, "nueva_version": 9,
  "nuevo_precio_actual": 4600, "extension_aplicada": false, "nueva_fecha_cierre": "...",
  "idempotency_key": "...", "created_at": "..." }
```
**Reglas para la web:**
- Si hay timeout, reintenta **con la misma clave**. Un intento nuevo lleva una clave nueva.
- Muestra la puja como aceptada **solo** cuando llega el `201`. No hay confirmaciones optimistas.

## Límite de tasa [RATE]
Con exceso de solicitudes la API responde `429 DEMASIADAS_SOLICITUDES` y el encabezado `Retry-After` (en segundos).

| Ruta | Límite |
|---|---|
| `POST /auth/login` | 20 cada 15 min por IP y 10 cada 15 min por email |
| `POST /auth/register` | 10 cada 15 min por IP |
| `POST /subastas/:id/pujas` | 60 por minuto por usuario |
| `POST /subastas/:id/live/ticket` | 30 por minuto por usuario |
| `POST /subastas/:id/estimaciones-peso` | 20 por minuto por usuario |
| `POST /logistica/cotizar` | 30 por minuto por usuario |

Los contadores viven en memoria, en una sola instancia: con varias réplicas, cada una cuenta por separado. Se desactivan con `RATE_LIMIT_DISABLED=true`.

---

## Catálogo de lotes [CAT]
`GET /subastas?estado=&mios=true&limit=&cursor=`. La autenticación es opcional.
- **Público:** por defecto solo lista lotes `ACTIVO`; con `estado=` se pueden ver `ADJUDICADO`, `DESIERTO`, `CERRADO` o `CANCELADO`. **Nunca lista un `BORRADOR`.**
- **`mios=true`:** requiere sesión (si no, 401) y devuelve todos los lotes de la organización activa, borradores incluidos.
- **Orden y paginación:** se ordena por `fecha_cierre` ascendente; `limit` va de 1 a 50 y el cursor es opaco.
- `200 { data: LoteCatalogo[], next_cursor }`. El tipo `LoteCatalogo` está en `@ganadito/contracts`. Cada fila trae el detalle del lote, `es_abierta`, `total_pujas`, `peso_estimado_total_kg` (IA orientativa, no vinculante; `null` si no hay) y `origen`.
- **`origen`:** trae `{ ubigeo, latitud, longitud, ubicacion_aproximada }` con la **posición pública**: un ESTABLO de otra organización se entrega aproximado (rejilla de 0.01°).

**Detalle opcional al publicar** (`POST /subastas`):
- `cantidad_animales`: entero de 1 a 10 000.
- `categoria`: hasta 40 caracteres.
- `raza`: hasta 60 caracteres.
- `descripcion`: hasta 500 caracteres.
- `establecimiento_id`: debe ser de la organización vendedora (si no, 403).

**La puja sigue siendo por el precio total del lote.**

## 5. Tiempo real (WebSocket)

**Ticket de conexión [WS-TICKET].** Un navegador no puede enviar `Authorization` en el upgrade, y antes el JWT viajaba en la URL. Ahora el cliente sigue dos pasos:
1. `POST /subastas/:id/live/ticket` con `Authorization: Bearer <access_token>`:
   - `201` `{ ticket, expira_en_segundos: 30 }`, con `Cache-Control: no-store`;
   - `401` sin sesión, `403 SIN_CONTEXTO` sin organización activa, `404` si el lote no existe, `429 DEMASIADOS_TICKETS` con más de 20 tickets sin usar.
   - El ticket queda ligado a la organización y el rol activos. Al consumirlo se **revalida** en PostgreSQL que esa membresía siga activa.
2. Abrir **de inmediato** `GET /subastas/:id/live?ticket=<ticket>`. El ticket:
   - es de **un solo uso**, así que cada reconexión necesita uno nuevo;
   - vale **30 s**;
   - sirve **solo para ese lote**.

`GET /subastas/:id/live` (upgrade a WebSocket) acepta tres credenciales, en este orden:
1. `?ticket=`, que es lo recomendado para navegadores;
2. `Authorization: Bearer`, para clientes que no son navegador;
3. `?access_token=<jwt>`, **obsoleto**. Solo funciona fuera de producción o si `WS_PERMITIR_ACCESS_TOKEN_EN_URL=true`, y se eliminará cuando la web use el ticket.

- **Autorización vigente [WS-AUTH]:**
  - Con `Authorization: Bearer` (o `?access_token=`) el JWT debe traer un contexto activo, y esa membresía (organización + rol) debe seguir vigente en PostgreSQL. Si falta el contexto, se cierra con `1008 Se requiere un contexto organizacional activo.`; si la membresía se revocó, con `1008 Sesión revocada.`.
  - **Durante** la conexión, cada instancia revalida en PostgreSQL la membresía de sus sockets cada 30 s; si se revocó o se cambió de contexto, cierra con `1008 Sesión revocada.` y retira la suscripción. No depende de avisos por Redis.
  - La conexión se cierra al vencer el `exp` del JWT, o a los 15 min si se abrió con ticket: `1008 Sesión expirada; reconecte con un ticket nuevo.`. El cliente pide un ticket nuevo y recupera el snapshot.
  - Si PostgreSQL no responde en 2 revalidaciones seguidas, se cierra con `1011 No se pudo verificar la sesión.`, porque la conexión falla cerrada.
- **[N04]** Si la credencial es inválida o el lote no existe, el servidor cierra la conexión con código `1008`. Con un ticket vencido, usado o de otro lote, el motivo es `Ticket inválido, vencido o ya usado.`
- El canal es **solo de servidor a cliente**. Las pujas se envían por REST.

Mensaje **[N04]** (formato único):
```json
{ "event_type": "PUJA_ACEPTADA | SUBASTA_ADJUDICADA | SUBASTA_DESIERTA", "lote_id": "...", "data": { } }
```
- `PUJA_ACEPTADA.data`: `{ puja_id, monto, secuencia, nueva_version, nuevo_precio_actual, extension_aplicada, nueva_fecha_cierre, created_at }`. Ya **no** incluye `idempotency_key`.
- `SUBASTA_ADJUDICADA.data`: `{ codigo_lote, estado: "ADJUDICADO", monto_adjudicado }`. Ya **no** incluye comprador, organización ni totales: son datos privados que se consultan por REST en las órdenes.
- `SUBASTA_DESIERTA.data`: `{ codigo_lote, estado: "DESIERTO" }`.

**Recuperación (obligatoria):**
1. Al conectar o reconectar, pedir `GET /subastas/:id/snapshot`.
2. Descartar los mensajes con `secuencia` ≤ `snapshot.secuencia_maxima`.
3. Si llega un salto de secuencia, volver a pedir el snapshot.

La entrega es *al menos una vez*: pueden llegar mensajes duplicados.

---

## 6. Órdenes de compra

Al cerrar un lote con ganador se crea **una única** orden en `PENDIENTE_PAGO`.
- **[N04]** La organización compradora es la que estaba activa **cuando se hizo la puja ganadora**.

### `GET /ordenes` **[N04]** (autenticado)
Lista las órdenes de la organización activa, como compradora o vendedora.
`?rol=comprador|vendedor&limit=20&cursor=<opaco>` → `{ "data": [Orden], "next_cursor": null }`

### `GET /ordenes/:id` **[N04]** (autenticado)
`200` Orden · `404` si no existe **o si no pertenece a la organización activa**. No se revela que la orden existe.

```json
{ "id": "...", "lote_id": "...", "codigo_lote": "...", "estado": "PENDIENTE_PAGO",
  "monto_adjudicado": 4500, "comision_plataforma": 45, "total_a_pagar": 4545,
  "organizacion_compradora_id": "...", "organizacion_vendedora_id": "...", "created_at": "..." }
```
El pago no está disponible: `POST /pagos/checkout` responde `503` mientras `PAYMENTS_ENABLED=false`.

### Cierre administrativo
`POST /subastas/cerrar-expiradas` **[N02: requiere rol ADMIN]**. En operación normal, el cierre lo hace el worker.

---

## 7. Consulta autorizada (N05)
- El mapa, Spot y trazabilidad se documentan en una sección aparte cuando se apruebe N05.
- **Regla común:** las coordenadas exactas de establos solo se entregan a su organización. A los demás se les entregan aproximadas.

---

## 8. Ejemplos de prueba para la web
La web puede usar los ejemplos de este documento como datos simulados **solo** en un modo de demostración explícito, nunca como respaldo automático cuando la API falla (V01/V05).
