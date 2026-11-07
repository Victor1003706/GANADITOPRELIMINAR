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
    """Schaeffer con la corrección calibrada: factor * S