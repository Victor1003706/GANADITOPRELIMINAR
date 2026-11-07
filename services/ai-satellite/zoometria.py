"""
Núcleo numérico de la zoometría bovina (sin FastAPI ni Pydantic).

Todo está vectorizado sobre un eje de simulación de tamaño N para propagar la
incertidumbre por Monte Carlo:

  1. Rectificación métrica desde las 4 esquinas del marcador ArUco, con selección de
     modelo por error cuadrático medio: similitud (4 GL, mínimos cuadrados) u homografía
     (8 GL, DLT normalizada). Una homografía estimada con un marcador pequeño extrapola
     su término proyectivo a todo el animal y amplifica el ruido de las esquinas; la
     similitud es estable pero sesgada si hay perspectiva. Se elige la de menor
     sesgo^2 + varianza, y el sesgo de la similitud entra al intervalo.
  2. Medidas lineales: largo corporal (hombro-nalga) y profundidad de pecho (cruz-pecho).
  3. Perímetro torácico: medido con cinta o aproximado como elipse (Ramanujan II).
  4. Fórmula de Schaeffer métrica: kg = PT^2 * L / K.

Las fuentes de incertidumbre se separan en dos grupos:
  - por vista: errores que cambian de una foto a otra (marcado de puntos, esquinas
    detectadas). Promediar varias vistas los reduce.
  - comunes: propiedades del animal o del material que no cambian entre fotos
    (relación ancho/profundidad, impresión del marcador, cinta, error del modelo).
    Promediar vistas NO las reduce; por eso se simulan con las mismas extracciones.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

# Constante de Schaeffer convertida a cm y kg: 300 * 2.54^3 / 0.45359237 = 10 838.
CONSTANTE_SCHAEFFER_CM_KG = 300 * 2.54**3 / 0.45359237

# Orden fijo de los puntos anatómicos en los arreglos (4, 2).
HOMBRO, NALGA, CRUZ, PECHO = 0, 1, 2, 3

FUENTES_POR_VISTA = ("puntos", "esquinas", "perspectiva")
FUENTES_COMUNES = ("impresion_marcador", "referencia", "relacion_ancho", "cinta", "modelo")
FUENTES = FUENTES_POR_VISTA + FUENTES_COMUNES


@dataclass(frozen=True)
class ParametrosZoometria:
    """
    Supuestos del modelo, versionados. TODOS son SUPUESTOS hasta calibrarlos con los
    pesajes de muestra del piloto (ver evaluacion_peso.py); cada calibración debe
    publicar una nueva `version`.
    """

    version: str = "2026-11-04-supuestos"
    relacion_ancho_central: float = 0.65
    relacion_ancho_rango: tuple[float, float] = (0.55, 0.75)
    # Desviación típica del marcado manual de un punto, relativa a la diagonal de la imagen.
    sigma_punto_relativo_diagonal: float = 0.003
    sigma_punto_min_px: float = 2.0
    # Error de localización de una esquina ArUco tras el refinamiento subpíxel.
    sigma_esquina_px: float = 0.3
    # Simulaciones para elegir entre similitud y homografía por error cuadrático medio.
    n_simulaciones_seleccion: int = 1000
    # Error relativo del lado impreso (escalado de la impresora).
    sigma_impresion_relativo: float = 0.005
    # Error relativo de la longitud de una referencia física (vara, regla).
    sigma_referencia_relativo: float = 0.005
    # Error de lectura de la cinta torácica, en cm.
    sigma_cinta_cm: float = 1.5
    # Error residual de la fórmula de Schaeffer en escala logarítmica (≈ 10 %).
    sigma_modelo_log: float = 0.10
    # Modelo calibrable: kg = factor * S^exponente, con S = Schaeffer (1.0 y 1.0 = original).
    factor_escala_modelo: float = 1.0
    exponente_modelo: float = 1.0
    n_simulaciones: int = 4000
    semilla: int = 20261104
    nivel_confianza: float = 0.90


PARAMETROS_VIGENTES = ParametrosZoometria()


# ---------------------------------------------------------------------------
# Fórmulas cerradas
# ---------------------------------------------------------------------------

def peso_schaeffer_kg(perimetro_cm, largo_cm, factor_escala: float = 1.0):
    return factor_escala * np.asarray(perimetro_cm) ** 2 * np.asarray(largo_cm) / CONSTANTE_SCHAEFFER_CM_KG


def peso_modelo_kg(perimetro_cm, largo_cm, params: "ParametrosZoometria"):
    """Schaeffer con la corrección calibrada: factor * S^exponente."""
    return params.factor_escala_modelo * peso_schaeffer_kg(perimetro_cm, largo_cm) ** params.exponente_modelo


def perimetro_elipse_cm(profundidad_cm, relacion_ancho):
    """Perímetro de la elipse de ejes profundidad y ancho = profundidad*relación (Ramanujan II)."""
    profundidad_cm = np.asarray(profundidad_cm, dtype=float)
    a = profundidad_cm / 2.0
    b = profundidad_cm * np.asarray(relacion_ancho, dtype=float) / 2.0
    h = (a - b) ** 2 / (a + b) ** 2
    return math.pi * (a + b) * (1 + 3 * h / (10 + np.sqrt(4 - 3 * h)))


def relacion_desde_perimetro(profundidad_cm: float, perimetro_cm: float) -> float | None:
    """
    Inversa de perimetro_elipse_cm respecto de la relación ancho/profundidad (bisección;
    la función es monótona creciente). Devuelve None si no hay solución en [0.05, 2.0].
    """
    lo, hi = 0.05, 2.0
    if not (perimetro_elipse_cm(profundidad_cm, lo) <= perimetro_cm <= perimetro_elipse_cm(profundidad_cm, hi)):
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if perimetro_elipse_cm(profundidad_cm, mid) < perimetro_cm:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ---------------------------------------------------------------------------
# Homografía por lotes
# ---------------------------------------------------------------------------

def _normalizacion_hartley(puntos: np.ndarray) -> np.ndarray:
    """T (N, 3, 3): lleva el centroide al origen y la distancia media a sqrt(2)."""
    centro = puntos.mean(axis=1)
    distancia = np.linalg.norm(puntos - centro[:, None], axis=-1).mean(axis=1)
    escala = math.sqrt(2) / np.maximum(distancia, 1e-12)
    t = np.zeros((puntos.shape[0], 3, 3))
    t[:, 0, 0] = escala
    t[:, 1, 1] = escala
    t[:, 0, 2] = -escala * centro[:, 0]
    t[:, 1, 2] = -escala * centro[:, 1]
    t[:, 2, 2] = 1.0
    return t


def homografias_dlt(origen: np.ndarray, destino: np.ndarray) -> np.ndarray:
    """
    Homografías exactas de 4 correspondencias, por lotes, con normalización de Hartley
    (mejor condicionamiento; no depende de H[2, 2] != 0 en coordenadas crudas).
    origen, destino: (N, 4, 2). Devuelve (N, 3, 3) normalizada a H[2, 2] = 1.
    Equivale a cv2.getPerspectiveTransform aplicado a cada fila.
    """
    t_o, t_d = _normalizacion_hartley(origen), _normalizacion_hartley(destino)
    h_norm = _dlt_crudo(aplicar_homografias(t_o, origen), aplicar_homografias(t_d, destino))
    h = np.linalg.inv(t_d) @ h_norm @ t_o
    return h / h[:, 2:3, 2:3]


def _dlt_crudo(origen: np.ndarray, destino: np.ndarray) -> np.ndarray:
    x, y = origen[..., 0], origen[..., 1]
    u, v = destino[..., 0], destino[..., 1]
    n = origen.shape[0]
    cero, uno = np.zeros_like(x), np.ones_like(x)
    filas_u = np.stack([x, y, uno, cero, cero, cero, -u * x, -u * y], axis=-1)
    filas_v = np.stack([cero, cero, cero, x, y, uno, -v * x, -v * y], axis=-1)
    a = np.concatenate([filas_u, filas_v], axis=1)  # (N, 8, 8)
    b = np.concatenate([u, v], axis=1)  # (N, 8)
    h = np.linalg.solve(a, b[..., None])[..., 0]
    return np.concatenate([h, np.ones((n, 1))], axis=1).reshape(n, 3, 3)


def similitudes_lsq(origen: np.ndarray, destino: np.ndarray) -> np.ndarray:
    """
    Similitud 2D (rotación + escala uniforme + traslación, 4 grados de libertad) por
    mínimos cuadrados, por lotes (solución cerrada de Umeyama en 2D).
    origen, destino: (N, P, 2). Devuelve (N, 3, 3).
    """
    mo, md = origen.mean(axis=1, keepdims=True), destino.mean(axis=1, keepdims=True)
    o, d = origen - mo, destino - md
    norma = np.sum(o**2, axis=(1, 2))
    a = np.sum(o[..., 0] * d[..., 0] + o[..., 1] * d[..., 1], axis=1) / norma
    b = np.sum(o[..., 0] * d[..., 1] - o[..., 1] * d[..., 0], axis=1) / norma
    tx = md[:, 0, 0] - (a * mo[:, 0, 0] - b * mo[:, 0, 1])
    ty = md[:, 0, 1] - (b * mo[:, 0, 0] + a * mo[:, 0, 1])
    n = origen.shape[0]
    m = np.zeros((n, 3, 3))
    m[:, 0, 0], m[:, 0, 1], m[:, 0, 2] = a, -b, tx
    m[:, 1, 0], m[:, 1, 1], m[:, 1, 2] = b, a, ty
    m[:, 2, 2] = 1.0
    return m


def residuo_similitud_px(esquinas_px: np.ndarray, lado_cm: float) -> float:
    """
    RMS, en píxeles, de ajustar una similitud del cuadrado métrico a las esquinas
    detectadas. Si es compatible con el ruido de las esquinas, la perspectiva no es
    detectable en el marcador y una homografía solo amplificaría ruido.
    """
    cuadrado = cuadrado_metrico(np.array([lado_cm]))
    esquinas = esquinas_px[None].astype(float)
    m = similitudes_lsq(cuadrado, esquinas)
    ajustadas = aplicar_homografias(m, cuadrado)
    return float(np.sqrt(np.mean(np.sum((ajustadas - esquinas) ** 2, axis=-1))))


def aplicar_homografias(h: np.ndarray, puntos: np.ndarray) -> np.ndarray:
    """h: (N, 3, 3); puntos: (N, P, 2) -> (N, P, 2)."""
    homogeneos = np.concatenate([puntos, np.ones(puntos.shape[:-1] + (1,))], axis=-1)
    proyectados = np.einsum("nij,npj->npi", h, homogeneos)
    return proyectados[..., :2] / proyectados[..., 2:3]


def cuadrado_metrico(lado_cm: np.ndarray) -> np.ndarray:
    """Esquinas (N, 4, 2) de un cuadrado de lado `lado_cm` en el orden de ArUco (horario)."""
    lado = np.asarray(lado_cm, dtype=float)[:, None]
    cero = np.zeros_like(lado)
    xs = np.concatenate([cero, lado, lado, cero], axis=1)
    ys = np.concatenate([cero, cero, lado, lado], axis=1)
    return np.stack([xs, ys], axis=-1)


# ---------------------------------------------------------------------------
# Geometría de una vista y simulación
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Vista:
    """Una foto de perfil ya decodificada: coordenadas en píxeles."""

    puntos_px: np.ndarray  # (4, 2) en el orden HOMBRO, NALGA, CRUZ, PECHO
    sigma_punto_px: float
    # Calibración ArUco: esquinas (4, 2), lado impreso y modelo de rectificación.
    esquinas_px: np.ndarray | None = None
    lado_cm: float | None = None
    rectificacion: str = "SIMILITUD"  # "SIMILITUD" (4 GL) u "HOMOGRAFIA" (8 GL)
    # Sesgo estimado de usar similitud cuando hay perspectiva, en ln(kg); se simula como error.
    sigma_sesgo_perspectiva_log: float = 0.0
    # Calibración por referencia: dos puntos (2, 2) y distancia.
    referencia_px: np.ndarray | None = None
    distancia_cm: float | None = None

    @property
    def usa_aruco(self) -> bool:
        return self.esquinas_px is not None


@dataclass
class Extracciones:
    """Ruido estándar pre-extraído (N(0,1) o U(0,1)), compartible entre vistas."""

    n: int
    comunes: dict[str, np.ndarray] = field(default_factory=dict)

    @classmethod
    def nuevas(cls, rng: np.random.Generator, n: int) -> "Extracciones":
        return cls(
            n=n,
            comunes={
                "impresion_marcador": rng.standard_normal(n),
                "referencia": rng.standard_normal(n),
                "relacion_ancho": rng.random(n),
                "cinta": rng.standard_normal(n),
                "modelo": rng.standard_normal(n),
            },
        )


@dataclass(frozen=True)
class MedidasVista:
    largo_cm: np.ndarray
    profundidad_cm: np.ndarray


def medir_vista(
    vista: Vista,
    params: ParametrosZoometria,
    extr: Extracciones,
    ruido_vista: dict[str, np.ndarray],
    activas: frozenset[str],
) -> MedidasVista:
    """Largo y profundidad en cm para cada simulación (N,)."""
    n = extr.n
    puntos = np.broadcast_to(vista.puntos_px, (n, 4, 2)).astype(float)
    if "puntos" in activas:
        puntos = puntos + ruido_vista["puntos"] * vista.sigma_punto_px

    if vista.usa_aruco:
        esquinas = np.broadcast_to(vista.esquinas_px, (n, 4, 2)).astype(float)
        if "esquinas" in activas:
            esquinas = esquinas + ruido_vista["esquinas"] * params.sigma_esquina_px
        lado = np.full(n, float(vista.lado_cm))
        if "impresion_marcador" in activas:
            lado = lado * (1 + extr.comunes["impresion_marcador"] * params.sigma_impresion_relativo)
        cuadrado = cuadrado_metrico(lado)
        if vista.rectificacion == "HOMOGRAFIA":
            h = homografias_dlt(esquinas, cuadrado)
        else:
            h = similitudes_lsq(esquinas, cuadrado)
        metricos = aplicar_homografias(h, puntos)
    else:
        ref = np.broadcast_to(vista.referencia_px, (n, 2, 2)).astype(float)
        if "puntos" in activas:
            ref = ref + ruido_vista["referencia"] * vista.sigma_punto_px
        distancia = np.full(n, float(vista.distancia_cm))
        if "referencia" in activas:
            distancia = distancia * (1 + extr.comunes["referencia"] * params.sigma_referencia_relativo)
        escala = distancia / np.linalg.norm(ref[:, 0] - ref[:, 1], axis=-1)
        metricos = puntos * escala[:, None, None]

    largo = np.linalg.norm(metricos[:, HOMBRO] - metricos[:, NALGA], axis=-1)
    profundidad = np.linalg.norm(metricos[:, CRUZ] - metricos[:, PECHO], axis=-1)
    return MedidasVista(largo_cm=largo, profundidad_cm=profundidad)


def ruido_por_vista(rng: np.random.Generator, n: int) -> dict[str, np.ndarray]:
    return {
        "puntos": rng.standard_normal((n, 4, 2)),
        "esquinas": rng.standard_normal((n, 4, 2)),
        "referencia": rng.standard_normal((n, 2, 2)),
        "perspectiva": rng.standard_normal(n),
    }


def perimetro_simulado(
    profundidad_cm: np.ndarray,
    perimetro_cinta_cm: float | None,
    params: ParametrosZoometria,
    extr: Extracciones,
    activas: frozenset[str],
) -> np.ndarray:
    if perimetro_cinta_cm is not None:
        perimetro = np.full(extr.n, float(perimetro_cinta_cm))
        if "cinta" in activas:
            perimetro = perimetro + extr.comunes["cinta"] * params.sigma_cinta_cm
        return perimetro
    if "relacion_ancho" in activas:
        r_min, r_max = params.relacion_ancho_rango
        relacion = r_min + extr.comunes["relacion_ancho"] * (r_max - r_min)
    else:
        relacion = np.full(extr.n, params.relacion_ancho_central)
    return perimetro_elipse_cm(profundidad_cm, relacion)


def log_peso(
    vista: Vista,
    perimetro_cinta_cm: float | None,
    params: ParametrosZoometria,
    extr: Extracciones,
    ruido_vista: dict[str, np.ndarray],
    activas: frozenset[str],
) -> np.ndarray:
    """ln(kg) por simulación, SIN el error del modelo (se suma aparte porque es común)."""
    medidas = medir_vista(vista, params, extr, ruido_vista, activas)
    perimetro = perimetro_simulado(medidas.profundidad_cm, perimetro_cinta_cm, params, extr, activas)
    resultado = np.log(peso_modelo_kg(perimetro, medidas.largo_cm, params))
    if "perspectiva" in activas and vista.sigma_sesgo_perspectiva_log > 0:
        resultado = resultado + ruido_vista["perspectiva"] * vista.sigma_sesgo_perspectiva_log
    return resultado


def varianza_robusta(muestras: np.ndarray) -> float:
    """(IQR / 1.349)^2: igual a la varianza si es normal, pero insensible a colas largas."""
    q1, q3 = np.quantile(muestras, [0.25, 0.75])
    return float(((q3 - q1) / 1.349) ** 2)


def cuantiles_intervalo(muestras_log: np.ndarray, nivel: float) -> tuple[float, float]:
    cola = (1 - nivel) / 2
    bajo, alto = np.quantile(muestras_log, [cola, 1 - cola])
    return float(np.exp(bajo)), float(np.exp(alto))


# Cuantiles 0.95 de chi-cuadrado para 1..9 grados de libertad (prueba de heterogeneidad).
CHI2_095 = (3.841, 5.991, 7.815, 9.488, 11.070, 12.592, 14.067, 15.507, 16.919)


@dataclass(frozen=True)
class Combinacion:
    pesos: np.ndarray  # pesos normalizados por vista
    q: float  # estadístico Q de Cochran
    gl: int
    consistente: bool
    factor_inflacion: float  # razón de Birge (≥ 1) aplicada a la parte por vista


def combinar_vistas(centrales_log: np.ndarray, varianzas_por_vista: np.ndarray) -> Combinacion:
    """
    Pondera por inversa de la varianza propia de cada vista y mide su consistencia.
    Si Q supera el cuantil 0.95 de chi-cuadrado, las vistas discrepan más de lo que su
    error explica: se infla la incertidumbre por vista con la razón de Birge Q/gl.
    """
    var = np.maximum(varianzas_por_vista, 1e-12)
    w = 1.0 / var
    w_norm = w / w.sum()
    media = float(np.sum(w_norm * centrales_log))
    q = float(np.sum(w * (centrales_log - media) ** 2))
    gl = len(centrales_log) - 1
    umbral = CHI2_095[min(gl, len(CHI2_095)) - 1]
    consistente = q <= umbral
    # Continuo (sin salto en el umbral): la razón de Birge se aplica siempre que pase de 1.
    factor = max(1.0, q / gl)
    return Combinacion(pesos=w_norm, q=q, gl=gl, consistente=consistente, factor_inflacion=factor)
