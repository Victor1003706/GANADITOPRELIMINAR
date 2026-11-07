"""
Estimación orientativa del peso vivo bovino a partir de fotos de perfil (etapa 1, V1).

Flujo de una vista:
  1. Calibración:
     - ARUCO: se detecta un marcador impreso de lado conocido, junto al animal y en su
       mismo plano. Sus 4 esquinas se refinan a subpíxel y definen la transformación
       imagen -> plano métrico (cm): SIMILITUD si la perspectiva no se detecta en el
       marcador, u HOMOGRAFÍA (corrige la inclinación) si el residuo lo exige.
     - REFERENCIA: dos puntos de una longitud conocida (vara de 1 m) -> escala única.
  2. El comunero marca 4 puntos anatómicos: punta del hombro, punta de la nalga
     (largo corporal), cruz y pecho inferior detrás del codo (profundidad de pecho).
  3. Perímetro torácico medido con cinta o aproximado como elipse con un ancho SUPUESTO.
  4. Schaeffer métrica: kg = PT^2 * L / 10 838.
  5. Incertidumbre por Monte Carlo (semilla fija: misma entrada -> misma salida) con
     cada fuente de error separada y su contribución a la varianza.
  6. Controles de calidad de la foto y de la geometría marcada.

Varias vistas del mismo animal se combinan ponderando por la inversa de su varianza;
los errores comunes (ancho supuesto, cinta, modelo) no se reducen al promediar.

El resultado es SIEMPRE orientativo (es_vinculante=False, validado=False): no es un
pesaje, puede equivocarse y no sirve para liquidar por kilogramo. La puja es por el
precio total del lote.
"""

from __future__ import annotations

import base64
import binascii
import math
from dataclasses import dataclass, replace
from typing import Literal

import cv2
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

import zoometria as z
from zoometria import PARAMETROS_VIGENTES, ParametrosZoometria, peso_schaeffer_kg  # noqa: F401

METODO = "ZOOMETRIA_SCHAEFFER_V1"

# Límites de plausibilidad para bovinos adultos y de recría.
LARGO_CM_RANGO = (70.0, 230.0)
PROFUNDIDAD_CM_RANGO = (35.0, 110.0)
PERIMETRO_CM_RANGO = (90.0, 280.0)
PESO_KG_RANGO = (60.0, 1200.0)

LADO_MARCADOR_MIN_PX = 24.0
# Por encima de esta relación entre lados opuestos/adyacentes el marcador está tan
# escorzado que la homografía amplifica demasiado el error de las esquinas.
INCLINACION_MARCADOR_MAX = 2.0
MAX_IMAGEN_BYTES = 8 * 1024 * 1024
MAX_IMAGEN_LADO_PX = 8000
MAX_VISTAS = 4
MAX_BASE64_TOTAL = 24 * 1024 * 1024

# Umbrales de los controles de calidad (advertencias, no errores). SUPUESTOS.
UMBRAL_NITIDEZ_LAPLACIANO = 60.0
UMBRAL_INCLINACION_ADVERTENCIA = 1.15
UMBRAL_MARCADOR_RELATIVO = 0.08  # lado del marcador / largo corporal, en píxeles
UMBRAL_ANGULO_PERFIL_GRADOS = 20.0
UMBRAL_ORTOGONALIDAD_GRADOS = 20.0
PROPORCION_PROFUNDIDAD_LARGO = (0.30, 0.70)

DICCIONARIOS_ARUCO = {
    "DICT_4X4_50": cv2.aruco.DICT_4X4_50,
    "DICT_5X5_50": cv2.aruco.DICT_5X5_50,
    "DICT_6X6_50": cv2.aruco.DICT_6X6_50,
}

DESCRIPCION_FUENTES = {
    "puntos": "Marcado manual de los puntos anatómicos",
    "esquinas": "Localización de las esquinas del marcador",
    "perspectiva": "Perspectiva no corregida (se eligió similitud por menor error)",
    "impresion_marcador": "Escala de impresión del marcador",
    "referencia": "Longitud de la referencia física",
    "relacion_ancho": "Ancho torácico supuesto (sin calibrar)",
    "cinta": "Lectura de la cinta torácica",
    "modelo": "Error residual de la fórmula de Schaeffer",
}


class EstimacionPesoError(ValueError):
    """Entrada válida en forma, pero imposible de estimar (se responde con 422)."""


class ImagenDemasiadoGrandeError(ValueError):
    """La imagen supera el tamaño permitido (se responde con 413)."""


Punto = tuple[float, float]


# ---------------------------------------------------------------------------
# Contrato
# ---------------------------------------------------------------------------

class PuntosAnatomicos(BaseModel):
    model_config = ConfigDict(extra="forbid")

    punta_hombro: Punto = Field(description="Encuentro, en píxeles (x,