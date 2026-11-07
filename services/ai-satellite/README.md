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
   | Marcado de puntos | por vista | σ = 0,3 % de la diagonal (mín. 2 px) o `incertidumbre_