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
    calibracion_formula: CalibracionFormula | None
    propuesta: PropuestaParametros
    advertencias: list[str]


# ---------------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------------

def metricas_error(pares: list[ParEvaluacion], cobertura_esperada: float) -> MetricasError | None:
    con_estimado = [p for p in pares if p.peso_estimado_kg is not None]
    if len(con_estimado) < MIN_PARES_METRICAS:
        return None
    real = np.array([p.peso_real_kg for p in con_estimado])
    est = np.array([p.peso_estimado_kg for p in con_estimado], dtype=float)
    error = est - real
    log_ratio = np.log(est / real)
    media_lr, sd_lr = float(np.mean(log_ratio)), float(np.std(log_ratio, ddof=1))
    ss_res = float(np.sum((real - est) ** 2))
    ss_tot = float(np.sum((real - real.mean()) ** 2))

    con_intervalo = [p for p in con_estimado if p.rango_min_kg is not None and p.rango_max_kg is not None]
    cobertura = (
        sum(p.rango_min_kg <= p.peso_real_kg <= p.rango_max_kg for p in con_intervalo) / len(con_intervalo)
        if con_intervalo else None
    )
    return MetricasError(
        n=len(con_estimado),
        mae_kg=round(float(np.mean(np.abs(error))), 2),
        rmse_kg=round(float(np.sqrt(np.mean(error**2))), 2),
        mape=round(float(np.mean(np.abs(error) / real)), 4),
        sesgo_relativo=round(float(np.mean(error / real)), 4),
        bland_altman_factor_medio=round(math.exp(media_lr), 4),
        bland_altman_limites=(round(math.exp(media_lr - 1.96 * sd_lr), 4), round(math.exp(media_lr + 1.96 * sd_lr), 4)),
        r2=round(1 - ss_res / ss_tot, 4) if ss_tot > 0 else 0.0,
        n_con_intervalo=len(con_intervalo),
        cobertura_intervalo=None if cobertura is None else round(cobertura, 4),
        cobertura_esperada=cobertura_esperada,
    )


# ---------------------------------------------------------------------------
# Calibraciones
# ---------------------------------------------------------------------------

def calibrar_relacion(pares: list[ParEvaluacion]) -> CalibracionRelacion | None:
    candidatos = [p for p in pares if p.profundidad_pecho_cm is not None and p.perimetro_cinta_cm is not None]
    relaciones = [z.relacion_desde_perimetro(p.profundidad_pecho_cm, p.perimetro_cinta_cm) for p in candidatos]
    validas = np.array([r for r in relaciones if r is not None])
    if len(validas) < MIN_PARES_AJUSTE:
        return None
    return CalibracionRelacion(
        n=len(validas),
        descartados=len(candidatos) - len(validas),
        media=round(float(np.mean(validas)), 4),
        desviacion=round(float(np.std(validas, ddof=1)), 4),
        p05=round(float(np.quantile(validas, 0.05)), 4),
        p95=round(float(np.quantile(validas, 0.95)), 4),
    )


def _sig(valor: float, cifras: int = 7) -> float:
    """Redondeo a cifras SIGNIFICATIVAS: round(x, 5) convertía 2.67e-8 en 0.0."""
    if valor == 0 or not math.isfinite(valor):
        return valor
    return float(f"{valor:.{cifras}g}")


# Por debajo de esto, 1 - h_ii hace inestable (o infinito) el residuo LOOCV.
MIN_UNO_MENOS_APALANCAMIENTO = 1e-8
# Dispersión mínima de ln(S) que debe quedar en CADA fold del LOOCV (≈1 % en S, del
# orden del error de medición): con menos, la pendiente de ese fold no está identificada.
MIN_DESVIACION_LOG_S_FOLD = 0.01
# Rango físico del exponente: fuera de él el ajuste libre es un artefacto numérico.
RANGO_EXPONENTE_PLAUSIBLE = (0.5, 1.5)


def _mape_desde_log(y: np.ndarray, prediccion_log: np.ndarray) -> float:
    real = np.exp(y)
    return float(np.mean(np.abs(np.exp(prediccion_log) - real) / real))


def ajustar_solo_escala(x: np.ndarray, y: np.ndarray) -> AjusteFormula:
    """ln W = a + ln S, con S = PT^2 L / K. LOOCV: la media sin el punto i."""
    d = y - x
    n = len(d)
    a = float(np.mean(d))
    loo = (np.sum(d) - d) / (n - 1)
    return AjusteFormula(
        a=_sig(a), b=1.0, factor_escala=_sig(math.exp(a)),
        sigma_log=_sig(float(np.std(d, ddof=1))),
        mape_loocv=round(_mape_desde_log(y, x + loo), 4),
    )


def ajustar_libre(x: np.ndarray, y: np.ndarray) -> AjusteFormula | None:
    """
    MCO de ln W sobre ln S. LOOCV cerrado: residuo_i / (1 - h_ii).
    Devuelve None si el ajuste no es evaluable: un punto con apalancamiento ~1 (p. ej.,
    toda la variación de S depende de un solo animal) hace que retirarlo deje la
    pendiente sin identificar y el residuo LOOCV sea infinito.
    """
    n = len(y)
    if n < 3:
        return None
    # Forma CENTRADA (estable): la inversión de X'X sin centrar perdía precisión y
    # aceptaba folds sin variación de S.
    xm = float(np.mean(x))
    dx = x - xm
    sxx = float(np.sum(dx**2))
    if sxx <= 0:
        return None
    # Varianza de x en cada fold sin el punto i: Sxx_(-i) = Sxx - n/(n-1) * dx_i^2.
    sxx_sin_i = sxx - (n / (n - 1)) * dx**2
    if np.min(sxx_sin_i) / (n - 2) < MIN_DESVIACION_LOG_S_FOLD**2:
        return None
    b = float(np.sum(dx * (y - np.mean(y))) / sxx)
    a = float(np.mean(y) - b * xm)
    if not (RANGO_EXPONENTE_PLAUSIBLE[0] <= b <= RANGO_EXPONENTE_PLAUSIBLE[1]):
        return None
    coef = np.array([a, b])
    residuos = y - (a + b * x)
    apalancamiento = 1.0 / n + dx**2 / sxx
    if np.any(1 - apalancamiento < MIN_UNO_MENOS_APALANCAMIENTO):
        return None
    loo_residuos = residuos / (1 - apalancamiento)
    ajuste = AjusteFormula(
        a=_sig(float(coef[0])), b=_sig(float(coef[1])),
        factor_escala=_sig(math.exp(float(coef[0]))),
        sigma_log=_sig(float(np.sqrt(np.sum(residuos**2) / (n - 2)))),
        mape_loocv=round(_mape_desde_log(y, y - loo_residuos), 4),
    )
    valores = (ajuste.a, ajuste.b, ajuste.factor_escala, ajuste.sigma_log, ajuste.mape_loocv)
    return ajuste if all(math.isfinite(v) for v in valores) and ajuste.factor_escala > 0 else None


def calibrar_formula(pares: list[ParEvaluacion]) -> CalibracionFormula | None:
    candidatos = [p for p in pares if p.largo_corporal_cm is not None and p.perimetro_cinta_cm is not None]
    if len(candidatos) < MIN_PARES_AJUSTE:
        return None
    s = np.array([float(z.peso_schaeffer_kg(p.perimetro_cinta_cm, p.largo_corporal_cm)) for p in candidatos])
    x = np.log(s)
    y = np.log([p.peso_real_kg for p in candidatos])
    try:
        escala = ajustar_solo_escala(x, y)
        libre = ajustar_libre(x, y) if np.var(x) > 1e-10 else None
    except OverflowError:
        return None
    if not all(math.isfinite(v) for v in (escala.factor_escala, escala.mape_loocv, escala.sigma_log)) or escala.factor_escala <= 0:
        return None
    # Con pocos datos el modelo libre sobreajusta: solo se recomienda si mejora el LOOCV
    # y hay muestra suficiente.
    recomendado = (
        "libre"
        if libre is not None and len(candidatos) >= PARES_RECOMENDADOS and libre.mape_loocv < escala.mape_loocv
        else "solo_escala"
    )
    return CalibracionFormula(
        n=len(candidatos),
        mape_schaeffer_original=round(_mape_desde_log(y, x), 4),
        solo_escala=escala,
        libre=libre,
        recomendado=recomendado,
    )


def evaluar(payload: EvaluacionPesoInput) -> EvaluacionPesoResult:
    metricas = metricas_error(payload.pares, payload.nivel_confianza_esperado)
    relacion = calibrar_relacion(payload.pares)
    formula = calibrar_formula(payload.pares)

    advertencias: list[str] = []
    if metricas is None:
        advertencias.append(f"Se necesitan al menos {MIN_PARES_METRICAS} pares con peso estimado para medir el error.")
    completos = sum(p.largo_corporal_cm is not None and p.perimetro_cinta_cm is not None for p in payload.pares)
    if formula is None and completos >= MIN_PARES_AJUSTE:
        advertencias.append("No se pudo proponer una calibración de la fórmula: el ajuste no dio un resultado numérico válido.")
    elif relacion is None or formula is None:
        advertencias.append(f"Se necesitan al menos {MIN_PARES_AJUSTE} pares completos para proponer una calibración.")
    if len(payload.pares) < PARES_RECOMENDADOS:
        advertencias.append(f"Con menos de {PARES_RECOMENDADOS} pesajes las métricas son poco estables.")
    if metricas and metricas.cobertura_intervalo is not None and metricas.cobertura_intervalo < metricas.cobertura_esperada - 0.1:
        advertencias.append("El intervalo cubre menos de lo prometido: la incertidumbre está subestimada.")
    if formula is not None and formula.libre is None:
        advertencias.append(
            "El ajuste libre (a, b) no es evaluable con estos datos (S casi constante o dependiente de un solo "
            "animal): se propone solo el factor de escala."
        )
    if formula is not None:
        advertencias.append("sigma_modelo_log propuesto incluye el error de la cinta del piloto: es una cota superior.")
    advertencias.append("La propuesta no se aplica sola: debe revisarse y publicarse como una nueva versión.")

    propuesta = PropuestaParametros(version_base=z.PARAMETROS_VIGENTES.version)
    if relacion is not None:
        propuesta.relacion_ancho_central = relacion.media
        propuesta.relacion_ancho_rango = (relacion.p05, relacion.p95)
    if formula is not None:
        elegido = formula.libre if formula.recomendado == "libre" and formula.libre else formula.solo_escala
        propuesta.factor_escala_modelo = elegido.factor_escala
        propuesta.exponente_modelo = elegido.b
        propuesta.sigma_modelo_log = elegido.sigma_log
    return EvaluacionPesoResult(
        metricas=metricas,
        calibracion_relacion=relacion,
        calibracion_formula=formula,
        propuesta=propuesta,
        advertencias=advertencias,
    )
