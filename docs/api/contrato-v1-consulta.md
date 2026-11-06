# Contrato API v1: consulta autorizada (N05)

Este documento completa la sección 7 de `contrato-v1-acceso-lotes.md`. Los cambios son aditivos: no se renombra ni se quita ningún campo.

## `GET /establecimientos/cercanos`
Ruta pública. El token es opcional, pero si se envía uno inválido la respuesta es `401`.

Query: `lat`, `lon`, `radio_km` (≤ 2000), `tipo`, `limit` (≤ 100), `offset`.

Lo que recibe cada caso:

| Quién consulta | `ESTABLO` propio | `ESTABLO` ajeno | Otros tipos (CAMAL, FERIA_GANADERA, …) |
|---|---|---|---|
| Organización dueña | exacto + `direccion_texto` | — | exacto |
| Otra organización o anónimo | — | **aproximado** (rejilla de 0.01°, ≈1.1 km), `direccion_texto: null` | exacto |

- Campo nuevo `ubicacion_aproximada: boolean`. Cuando vale `true`, la web debe dibujar un área o un marcador difuso, no un punto exacto.
- Para las ubicaciones aproximadas, el filtro por radio y `distancia_km` se calculan sobre el punto aproximado. Así no se puede deducir la ubicación real combinando varias consultas.

## `GET /trazabilidad/bovinos/:id/pasaporte`
Ruta pública, usada por el QR. El token es opcional.

- Campo nuevo `vista`:
  - `"COMPLETA"` solo para la organización propietaria del bovino.
  - `"PUBLICA"` para todos los demás.
- En la vista `PUBLICA`:
  - `eventos[].autor_id` es `null` y `bovino.organizacion_id` es `null`: no se revela la organización dueña.
  - `eventos[].metadata` usa una **lista blanca por tipo de evento**. Solo los valores primitivos de estas claves son públicos; **todas las demás** valen `"[REDACTADO]"`, incluidas las claves nuevas o desconocidas:

    | Evento | Claves públicas |
    |---|---|
    | `REGISTRO_INICIAL` | `raza`, `sexo`, `fecha_nacimiento`, `peso_nacimiento_kg`, `tipo_parto` |
    | `VACUNACION` | `vacuna`, `dosis_ml`, `lote`, `campana_oficial`, `fecha` |
    | `TRATAMIENTO` | `producto`, `dosis_ml`, `dias_retiro`, `fecha_fin_retiro`, `fecha` |
    | `PESAJE` | `peso_vivo_kg`, `fecha` |
    | `MOVILIZACION_CSTI` | `csti_numero`, `guia_senasa`, `guia_transito_senasa`, `origen_distrito`, `destino_distrito`, `fecha` |
    | `PESAJE_CAMAL` | `camal_nombre`, `camal_codigo_oficial`, `peso_vivo_kg`, `peso_canal_caliente_kg`, `rendimiento_canal_pct` |
    | `INSPECCION_POST_MORTEM` | `camal_codigo_oficial`, `dictamen_post_mortem`, `resultado` |
    | `CAMBIO_PROPIEDAD` | `fecha` |

    `origen`, `destino` y `fundo_*` **no** son públicos, porque pueden identificar el fundo. Hay que usar `origen_distrito` y `destino_distrito`.
- **Tipos compartidos** (`@ganadito/contracts`):
  - `PasaporteDigitalVista` es una unión discriminada por `vista`. En `'PUBLICA'` usa `BovinoPublico`, con `organizacion_id: null`, y `EventoTrazabilidadPublico`, con `autor_id: null`.
  - `/establecimientos/cercanos` implementa `UbicacionPublica` (`latitud`, `longitud`, `ubicacion_aproximada`). La pizarra Spot (`CotizacionPizarraResponse`) sigue la misma política, pero `latitud` y `longitud` pueden ser `null` cuando la cotización no tiene establecimiento.
- `POST /trazabilidad/bovinos/:id/eventos` acepta solo `TIPOS_EVENTO_TRAZABILIDAD`. Cualquier otro valor, incluidos `constructor`, `toString` o `__proto__`, responde `400`.
- **La vista `PUBLICA` no incluye `prev_hash` ni `current_hash`.** Un hash de metadata privada de baja entropía (DNI, placa, coordenadas) permitiría adivinar el valor probando candidatos. La integridad se comprueba con `GET /trazabilidad/bovinos/:id/verificar` (`integro`), que recalcula la cadena completa en el servidor. La vista `COMPLETA` del dueño mantiene los hashes. La cadena guardada **no se reescribe**.

## `GET /cotizaciones/pizarra` (Spot)
Ruta pública. El token es opcional, pero si se envía uno inválido la respuesta es `401`. Para publicar una cotización ya se exige que el establecimiento pertenezca a la organización activa.

- `latitud` y `longitud` siguen **la misma política que `/establecimientos/cercanos`** (tabla de arriba): un `ESTABLO` ajeno se entrega aproximado en la rejilla de 0.01° para anónimos y otras organizaciones.
- Campo nuevo `ubicacion_aproximada: boolean`, con el mismo significado que en el mapa.
- La regla vive en un solo lugar (`apps/api/src/mapa/ubicacion-publica.ts`). Cualquier lectura pública nueva de establecimientos debe usarla.
