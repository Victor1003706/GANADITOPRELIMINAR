# services/ai-satellite

Servicio auxiliar de IA de Ganadito, hecho con FastAPI y OpenCV. Todo lo que devuelve es **orientativo**: `es_vinculante=false`. Ningún resultado de este servicio decide un precio, una liquidación ni una disputa.

## Ejecutar y probar

```bash
cd services/ai-satellite
.venv/Scripts/python -m pytest -q
.venv/Scripts/python run.py   # puerto 8001
```

La CI ejecuta estas pruebas en el job «Pruebas del satélite IA (Python)», obligatorio para unir a `main`.

## Estado real de cada endpoint

| Endpoint | Estado |
|---|---|
| `POST /api/v1/peso/estimar` | **Etapa 1, V1.** Zoometría con rectificación métrica, incertidumbre por Monte Carlo y controles de calidad. No está validada con pesajes reales. |
| `POST /api/v1/peso/estimar-multivista` | Combina 2 a 4 fotos del mismo animal. Mismo estado que `estimar`. |
| `POST /api/v1/peso/evaluar` | Mide el error contra la balanza y **propone** una calibración. No guarda nada ni aplica la propuesta. |
| `POST /api/v1/bromatologia/analizar-color` | Convierte la imagen a CIELAB con un umbral de L\* < 46. Es un cálculo real, pero el umbral no está validado en campo. |
| `POST /api/v1/bromatologia/checklist-minsa` | Aplica reglas fijas de temperatura, color y olor. |
| `POST /api/v1/vision/analizar-video` | **Simulado.** La condición corporal se deriva del contraste de la imagen, y el biotipo y la edad dental son valores fijos. Si no puede leer el video, genera fotogramas aleatorios. No debe presentarse como una medición. |

## Estimación de peso: etapa 1 (zoometría)

**Entrada.** Un fotograma de **perfil** del animal (el que elija el comunero en la app), con:

1. **Calibración**, que puede hacerse de dos formas:
   - `ARUCO`: una tarjeta impresa con un marcador ArUco (`DICT_4X4_50` por defecto) de lado conocido, por ejemplo 20 cm. El lado se mide **en el borde exterior del cuadrado negro**, sin el margen blanco. La tarjeta se coloca **junto al animal, en su mismo plano** y de frente a la cámara.
   - `REFERENCIA`: dos puntos de un objeto de largo conocido, como una vara de 1 m, en el mismo plano.
2. **Cuatro puntos anatómicos** que marca el comunero:
   - punta del hombro (encuentro);
   - punta de la nalga (isquion);
   - la cruz;
   - el punto inferior del pecho detrás del codo.
3. Opcional: `perimetro_toracico_cm`, medido con cinta. Reduce la incertidumbre.

**Cálculo (V1, `ZOOMETRIA_SCHAEFFER_V1`).** El núcleo numérico está en `zoometria.py`.

1. **Rectificación con selección de modelo por error cuadrático medio.** Las esquinas del ArUco se refinan a subpíxel y se comparan dos modelos:
   - **similitud** (rotación, escala y traslación; 4 grados de libertad): es estable, pero tiene sesgo si hay perspectiva;
   - **homografía** (DLT normalizada de Hartley; 8 grados de libertad): corrige la inclinación del plano, pero extrapola su término proyectivo al animal.

   Con un marcador de 20 cm y un animal 7 veces más grande, la homografía convierte 0,3 px de error de esquina en el 56 % de la varianza del peso. Por eso se elige el modelo con menor **sesgo² + varianza**, simulando las esquinas y estimando sesgo² = max(0, d² − var_H). Si gana la similitud, su sesgo se suma al intervalo como la fuente `perspectiva`. `residuo_similitud_px` queda solo como diagnóstico.
2. **Medidas.** Largo (hombro a nalga) y profundidad de pecho (cruz a pecho), en cm.
3. **Perímetro.** Con cinta o con una elipse (Ramanujan II) de ancho = profundidad × relación. La relación es un **supuesto** de 0,65, con un rango de 0,55 a 0,75.
4. **Peso.** `kg = factor × S^exponente`, con `S = PT² × L / 10 838` (Schaeffer). Sin calibrar, factor = exponente = 1.
5. **Incertidumbre por Monte Carlo.** Son 4000 simulaciones con semilla fija, así que la misma entrada da siempre la misma salida. Las fuentes de error son:

   | Fuente | Tipo | Supuesto actual |
   |---|---|---|
   | Marcado de puntos | por vista | σ = 0,3 % de la diagonal (mín. 2 px) o `incertidumbre_punto_px` |
   | Esquinas del marcador | por vista | σ = 0,3 px |
   | Perspectiva no corregida | por vista | sesgo estimado al elegir similitud |
   | Impresión del marcador / referencia | común | σ = 0,5 % |
   | Ancho torácico | común | uniforme 0,55–0,75 |
   | Cinta | común | σ = 1,5 cm |
   | Error de la fórmula | común | σ(ln) = 0,10 |

   El intervalo es el **P5–P95** (90 %) de ln(peso). `incertidumbre.contribuciones` da la fracción de varianza de cada fuente (primer orden): sirve para saber qué conviene mejorar. Por ejemplo, sin cinta dominan el modelo y el ancho supuesto, no el marcado.
6. **Validación de la propagación.** En animales sintéticos que siguen los supuestos, la cobertura empírica del intervalo del 90 % fue 0,890 con 600 casos, y la prueba automática usa 120. Esto valida el cálculo, **no los supuestos**: para eso hace falta la balanza.
7. **Controles de calidad.** Generan advertencias, no rechazos:
   - nitidez (varianza del laplaciano);
   - inclinación y tamaño relativo del marcador;
   - ángulo de perfil;
   - ortogonalidad cruz–pecho;
   - orientación;
   - proporción profundidad/largo.

**Varias vistas.** Cada vista se pondera por la inversa de su varianza propia, que es robusta (IQR/1,349) y usa números aleatorios comunes para que la ponderación sea estable.
- La prueba Q de Cochran (χ² al 95 %) detecta vistas que discrepan; el error se infla siempre con la razón de Birge max(1, Q/gl), que es continua.
- Promediar reduce el error de marcado, pero **no** el ancho supuesto ni el error del modelo, que se simulan como comunes.

**Evaluación y calibración (`evaluacion_peso.py`).** Con pares de peso de balanza y la `muestra`, calcula:
- MAE, RMSE, MAPE, sesgo, límites de Bland-Altman y R²;
- la **cobertura empírica** del intervalo;
- la relación ancho/profundidad real, invirtiendo la elipse con la cinta;
- el ajuste de `ln W = a + b ln S`, solo de escala (b = 1) y libre, comparado por **LOOCV** en forma cerrada.

Devuelve una `propuesta` con `aplicado=false`. Para aplicarla se revisa y se publica como nueva `ParametrosZoometria.version`.

**Salvaguardas numéricas:**
- Los parámetros se redondean a **7 cifras significativas**, nunca a decimales fijos, para que un factor válido de 2,7e-8 no se convierta en 0.
- Si un punto tiene apalancamiento ~1 (toda la variación de S depende de un solo animal), el ajuste libre **no es evaluable**: se devuelve `libre = null` y una advertencia, en lugar de un LOOCV infinito.
- Una propuesta con un valor no finito o un factor ≤ 0 se descarta.

**Validación sintética no es validación de campo.** Las pruebas con datos sintéticos (cobertura 0,890 y recuperación de parámetros conocidos) demuestran que el cálculo es correcto. La precisión del método solo se puede afirmar con **pesajes independientes de balanza** del piloto, medidos sobre animales que no se usaron para calibrar (validación con una muestra reservada). Hasta entonces, `validado=false`.

**Salida.** El endpoint devuelve:

- `peso_estimado_kg`, `rango_min_kg` y `rango_max_kg` (90 %);
- `version_parametros`, `incertidumbre` (con contribuciones por fuente) y `calidad`;
- `advertencias`;
- `es_vinculante=false` y `validado=false`;
- `muestra`, con las medidas intermedias para la etapa 2.

**Rechazos.** El endpoint responde 422 cuando:

- no hay marcador, hay varios sin `marcador_id`, el marcador es muy pequeño o está escorzado más de 2:1;
- un punto queda fuera de la imagen;
- el Base64 es inválido;
- las medidas o el peso salen del rango plausible;
- llega un campo desconocido.

Responde 413 si la imagen supera 8 MB o 8000 px de lado. Esas dimensiones se leen de la cabecera PNG o JPEG **antes** de decodificar, como defensa contra una bomba de descompresión. También responde 413 si el cuerpo de una ruta `/api/v1/peso/` supera los 26 MB, comprobado antes de parsear el JSON.

Responde 503 si ya hay 2 estimaciones en curso y no se libera turno en 10 s.

**Seguridad.** Las rutas de peso **no tienen autenticación**. Este servicio es interno y solo debe exponerse a `apps/api`, nunca a Internet.

**Límites conocidos.**

- La homografía corrige la inclinación del plano del marcador. Si el animal no está en ese plano (más cerca o más lejos de la cámara), la escala sigue sesgada, y eso no se ve en el intervalo.
- No se corrige la distorsión del lente, porque no se conocen los parámetros intrínsecos del celular.
- La fórmula de Schaeffer no está calibrada para el ganado criollo altoandino.
- La precisión real es **desconocida** hasta medirla.

## Estimación de peso: etapa 2 (con datos del piloto)

1. **Guardar cada estimación en PostgreSQL**, a través de la API y con el consentimiento del productor: el fotograma, los puntos, la `muestra`, la versión del método y, si existe, el **peso real** de una balanza disponible en una instalación colaboradora. Este servicio no guarda nada.
2. **Medir el error** con `POST /api/v1/peso/evaluar` contra la muestra pesada, separando por tipo de animal. Con 30 o más pares completos, publicar una nueva versión de parámetros.
3. **Modelo automático de puntos anatómicos**, para detectarlos sin que el comunero los toque. Se entrena con los puntos marcados y los pesos reales del piloto, y se compara contra la etapa 1 con los mismos datos. Solo reemplaza a la etapa 1 si mide mejor.

Para la etapa 2 falta definir un contrato en `docs/api`, una columna o tabla en una migración y el permiso de uso de las imágenes.
