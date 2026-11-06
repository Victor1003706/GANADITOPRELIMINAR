# Contrato v1: estimación orientativa de peso por lote

Tipos en `packages/contracts/src/weight.ts`. La estimación la calcula el satélite de IA (`services/ai-satellite`, método `ZOOMETRIA_SCHAEFFER_V1`) y la API la guarda en PostgreSQL.

> **Regla de negocio.** La estimación es **orientativa y nunca vinculante** (`es_vinculante: false`, que además garantiza un `CHECK` en la base). No es un pesaje y no se liquida por kilogramo: la puja es por el **precio total del lote**. La interfaz debe mostrar siempre el **rango**, no solo el número central.

## POST `/api/v1/subastas/:id/estimaciones-peso`

Agrega la estimación de **un animal** al lote.

- **Quién:** `VENDEDOR` cuya organización activa es la dueña del lote.
- **Cuándo:** solo si el lote está en `BORRADOR`, o en `ACTIVO` antes de `fecha_inicio` (según el reloj de PostgreSQL). Al empezar la subasta, la información queda congelada.
- **Encabezado opcional:** `Idempotency-Key` (1–128 caracteres).
  - Un reintento con el mismo cuerpo devuelve `200`, la misma estimación y `Idempotent-Replayed: true`, sin volver a llamar a la IA. **Esto vale también si la subasta ya empezó**: la regla del lote editable aplica solo a altas nuevas.
  - Si la misma clave llega con otro cuerpo, devuelve `409 IDEMPOTENCIA_CONFLICTO`.
- **Límites:** el servidor responde `413` si se supera el cuerpo, también con `Transfer-Encoding: chunked`. En ese caso el cliente puede ver `ECONNRESET` en lugar del 413, porque el servidor corta con datos sin leer; la web debe comprimir antes de enviar. El cuerpo admite hasta 26 MB y cada `imagen_base64` hasta unos 11,2 MB, que equivalen a 8 MB de imagen; si se supera, responde `413 IMAGEN_DEMASIADO_GRANDE`.
- **Orden de validación:** la sesión y el rol se validan en `onRequest`, **antes** de leer el cuerpo. Sin token, la respuesta es 401 sin parsear nada.

```json
{
  "identificador_animal": "PE-001",
  "vistas": [
    {
      "imagen_base64": "<PNG/JPEG, obligatorio con ARUCO>",
      "puntos": {
        "punta_hombro": [300, 400], "punta_nalga": [1000, 400],
        "cruz": [400, 250], "pecho_inferior": [400, 600]
      },
      "calibracion": { "tipo": "ARUCO", "lado_cm": 20 },
      "perimetro_toracico_cm": 180
    }
  ]
}
```

- `vistas` lleva de 1 a 4 fotos de perfil **del mismo animal**. Con 2 o más, el satélite las combina.
- Los puntos van en **píxeles de la imagen original**: si la interfaz escala la foto, debe convertirlos.
- `calibracion` también acepta `{"tipo":"REFERENCIA","punto_a":[x,y],"punto_b":[x,y],"distancia_cm":100}`.
- `identificador_animal` (arete) es opcional y no puede repetirse dentro del lote.
- **La imagen no se guarda.** Solo se guardan las medidas intermedias, la incertidumbre y los controles de calidad.

**201** devuelve un `EstimacionPesoResponse`:

```json
{
  "id": "uuid", "lote_id": "uuid", "identificador_animal": "PE-001",
  "metodo": "ZOOMETRIA_SCHAEFFER_V1", "version_parametros": "2026-11-04-supuestos",
  "peso_estimado_kg": 436.3, "rango_min_kg": 357.2, "rango_max_kg": 532.7,
  "nivel_confianza": 0.9, "numero_vistas": 1, "es_vinculante": false,
  "incertidumbre": { "desviacion_log": 0.12, "contribuciones": [{ "fuente": "modelo", "contribucion": 0.65 }] },
  "calidad": [{ "codigo": "NITIDEZ", "estado": "OK" }],
  "advertencias": ["Estimación orientativa: no es un pesaje y puede equivocarse."],
  "tiene_pesaje": false, "created_at": "2026-11-04T21:00:00.000Z"
}
```

| Código HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `ENTRADA_INVALIDA` | Faltan `vistas`, hay más de 4, los puntos son inválidos, o la calibración o la clave son inválidas |
| 401 / 403 | `LOTE_AJENO`, `SIN_CONTEXTO` | Sin token, sin rol `VENDEDOR` o el lote es de otra organización |
| 404 | `LOTE_NO_ENCONTRADO` | — |
| 409 | `LOTE_NO_EDITABLE` | La subasta ya empezó o el lote está cerrado (también si empezó mientras corría la IA) |
| 409 | `ANIMAL_DUPLICADO`, `IDEMPOTENCIA_CONFLICTO` | — |
| 413 / 422 | `IA_RECHAZO` | La IA rechazó la foto o los puntos (no hay marcador, la medida es implausible, la imagen es muy grande). `detalle` trae el motivo, sin repetir la entrada |
| 502 | `IA_RESPUESTA_INVALIDA` | La respuesta de la IA es incoherente: viene como vinculante, o le falta o está malformada la incertidumbre, las advertencias, la calidad o la muestra (por ejemplo `vistas: {}` o un número de vistas distinto del enviado) |
| 503 | `IA_NO_DISPONIBLE` | La IA está caída, no respondió a tiempo (20 s) u ocupada. **No se inventa un peso** |

## GET `/api/v1/subastas/:id/estimaciones-peso`

Es pública, igual que el snapshot del lote, con una excepción: las estimaciones de un lote en `BORRADOR` solo las ve su organización dueña (con su token); para cualquier otro, la respuesta es `404`. Devuelve un `ResumenPesoLote`:

```json
{
  "lote_id": "uuid", "numero_estimaciones": 2,
  "peso_total_estimado_kg": 872.6,
  "rango_total_conservador_kg": [714.4, 1065.4],
  "es_vinculante": false,
  "advertencia": "Estimación orientativa por IA, no es un pesaje ni es vinculante. ...",
  "estimaciones": []
}
```

`rango_total_conservador_kg` es la suma de los mínimos y la suma de los máximos. Es una cota **conservadora**: supone que los errores de los animales están perfectamente correlacionados, por ejemplo por el mismo sesgo del modelo en una raza. **No** es un intervalo del 90 % del total.

## POST `/api/v1/estimaciones-peso/:id/pesaje`

Registra el peso real de balanza de una muestra del piloto (etapa 2).

- **Quién:** `ADMIN`, `OPERADOR` o `AUDITOR`. El vendedor **no** puede registrar el pesaje de su propio ganado, para no sesgar la calibración.
- **Conflicto de interés:** se comprueba por **usuario**. Responde `403 CONFLICTO_DE_INTERES` si quien registra:
  - tiene cualquier membresía en la organización vendedora, aunque en ese momento esté activo en otra organización con rol `OPERADOR`;
  - o creó la estimación;
  - o tiene activa la propia organización vendedora.
- Se admite un pesaje por estimación; un segundo devuelve `409 PESAJE_DUPLICADO`.

```json
{ "peso_real_kg": 410, "perimetro_cinta_cm": 181, "balanza_descripcion": "Balanza camal piloto (calibrada)" }
```

**201** devuelve `{ id, estimacion_id, peso_real_kg, perimetro_cinta_cm, balanza_descripcion, error_relativo, dentro_del_rango, created_at }`. El campo `error_relativo` es `(estimado − real) / real`.

## GET `/api/v1/estimaciones-peso/evaluacion`

- **Quién:** `ADMIN` o `AUDITOR`. Se **supone** que estos roles son personal de la plataforma, porque la evaluación lee los pesajes de todas las organizaciones.
- Toma hasta 2000 pares (estimación y balanza) y llama a `/api/v1/peso/evaluar` del satélite.
- Devuelve `{ n_pares, evaluacion }`, con las métricas de error (MAE, MAPE, sesgo, Bland-Altman y cobertura del intervalo) y una **propuesta** de calibración con `aplicado: false`.
- Nada se aplica solo. Una calibración aprobada se publica como una nueva `version_parametros` del satélite.
- Si todavía no hay pesajes, devuelve `409 SIN_PESAJES`.

## Persistencia

Migración `0012_estimaciones_peso.sql`:

- `estimaciones_peso`: guarda el resultado de la IA junto con `muestra`, `incertidumbre` y `calidad` en JSONB. Tiene estos `CHECK`:
  - `es_vinculante = FALSE`;
  - rango ordenado;
  - idempotencia completa.

  Y estos índices únicos:
  - `(lote_id, idempotency_key)`;
  - `(lote_id, identificador_animal)`.
- `pesajes_balanza`: un registro por estimación, con la balanza y el usuario y la organización que lo registraron.
