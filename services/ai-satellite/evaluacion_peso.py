"""
Evaluación y calibración del estimador de peso con pesajes reales de una muestra.

Separado de la inferencia a propósito: aquí no se estima nada para el comercio, solo
se mide el error contra la balanza y se PROPONEN parámetros nuevos. Nada se aplica
solo: una propuesta se revisa, se versiona en zoometria.ParametrosZoometria y se
despliega con una nueva `version`.

Métricas (pares con peso estimado y peso real):
  - MAE, RMSE (kg), MAPE y sesgo relativo medio;
  - límites de concordancia de Bland-Altman sobre ln(estimado/real), como factores;
  - cobertura empírica del intervalo (debería acercarse al nivel de confianza);
  - R^2 de estimado contra real.

Calibraciones:
  - Relación ancho/profundidad del tórax: con profundidad (foto) y perímetro (cinta),
    se invierte la elipse para cada animal y se resume su distribución.
  - Fórmula: ln(W) = a + b ln(PT^2 L). Se ajusta (1) solo la escala (b = 1), robusta
    con pocos datos, y (2) libre (a, b) por mínimos cuadrados. Ambas se comparan por
    validación cruzada dejando uno fuera (LOOCV, forma cerrada).
"""

from __future__ import annotations

import math

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

import zoometria as z

MIN_PARES_METRICAS = 3
MIN_PARES_AJUSTE = 10
PARES_RECOMENDADOS = 30
MAX_PARES = 2000  # 5000 pares tardaban ~2,2 s; 2000 basta para el piloto


class ParEvaluacion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Límites físicos plausibles (bovinos, de ternero a toro adulto). Además de rechazar
    # datos imposibles, evitan desbordes numéricos: con perímetros de 1e-150 cm, exp(a)
    # desbordaba (500) y con pesos de 1e-306 kg las métricas salían inf/NaN.
    peso_real_kg: float = Field(ge=10, le=2000, description="Peso de balanza")
    peso_estimado_kg: float | None = Field(default=None, ge=10, le=2000)
    rango_min_kg: float | None = Field(default=None, ge=1, le=5000)
    rango_max_kg: float | None = Field(default=None, ge=1, le=5000)
    largo_corporal_cm: float | None = Field(default=None, ge=30, le=400)
    profundidad_pecho_cm: float | None = Field(default=None, ge=10, le=200)
    perimetro_cinta_cm: float | None = Field(default=None, ge=30, le=400)


class EvaluacionPesoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pares: list[ParEvaluacion] = Field(min_length=1, max_length=MAX_PARES)
    nivel_confianza_esperado: float = Field(default=z.PARAMETROS_VIGENTES.nivel_confianza, gt=0, lt=1)


class MetricasError(BaseModel):
    n: int
    mae_kg: float
    rmse_kg: float
    mape: float
    sesgo_relativo: float = Field(description="Media de (estimado - real) / real")
    bland_altman_factor_medio: float
    bland_altman_limites: tuple[float, float] = Field(description="Factores estimado/real al 95 %")
    r2: float
    n_con_intervalo: int
    cobertura_intervalo: float | None
    cobertura_esperada: float


class CalibracionRelacion(BaseModel):
    n: int
    descartados: int
    media: float
    desviacion: float
    p05: float
    p95: float


class AjusteFormula(BaseModel):
    a: float
    b: float
    factor_escala: float = Field(description="exp(a) cuando b = 1")
    sigma_log: float
    mape_loocv: float


class CalibracionFormula(BaseModel):
    n: int
    mape_schaeffer_original: float
    solo_escala: AjusteFormula
    libre: AjusteFormula | None = Field(
        description="None si no es identificable o evaluable: S constante o un punto con apalancamiento ~1"
    )
    recomendado: str


class PropuestaParametros(BaseModel):
    aplicado: bool = False
    version_base: str
    relacion_ancho_central: float | None = None
    relacion_ancho_rango: tuple[float, float] | None = None
    factor_escala_modelo: float | None = None
    exponente_modelo: float | None = None
    sigma_modelo_log: float | None = None


class EvaluacionPesoResult(BaseModel):
    metricas: MetricasError | None
    calibracion_relacion: CalibracionRelacion | None
    calibracion_