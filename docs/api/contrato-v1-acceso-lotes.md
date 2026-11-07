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
- `400`: precio o incremento ≤ 0, fechas inválidas, cierre anterior al inicio, valores anti-sniping negativos, o **[N03]** un `estado` distinto de `ACTIVO`/`BO