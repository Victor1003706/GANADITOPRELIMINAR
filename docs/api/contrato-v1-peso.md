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
| 413 / 422 | `IA_RECHAZO` | La 