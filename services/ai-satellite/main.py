"""
Ganadito AI Satellite Service (Python 3.11+ / FastAPI / OpenCV / NumPy)
- ExpoGanadito Video Pipeline (/api/v1/vision/analizar-video)
- Dr. Ganadito Bromatología CIELAB (/api/v1/bromatologia/analizar-color)
- Checklist Sanitario RM N.° 822-2018/MINSA (/api/v1/bromatologia/checklist-minsa)
- Estimación orientativa de peso vivo por zoometría (/api/v1/peso/estimar, /estimar-multivista)
- Evaluación y calibración del estimador con pesajes reales (/api/v1/peso/evaluar)
"""

from __future__ import annotations

import base64
import tempfile
import threading
import os
from typing import Any, List, Optional, Union

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from evaluacion_peso import EvaluacionPesoInput, EvaluacionPesoResult, evaluar
from peso import (
    EstimacionMultivistaInput,
    EstimacionMultivistaResult,
    EstimacionPesoError,
    EstimacionPesoInput,
    EstimacionPesoResult,
    ImagenDemasiadoGrandeError,
    estimar_peso,
    estimar_peso_multivista,
)

app = FastAPI(
    title="Ganadito AI Satellite Service",
    description="Servicio Satélite de Visión Computacional (ExpoGanadito) y Bromatología Cárnica CIELAB (Dr. Ganadito)",
    version="0.1.0",
)


# ============================================================================
# Esquemas Pydantic v2
# ============================================================================

class VideoAnalisisInput(BaseModel):
    video_url: Optional[str] = Field(default=None, description="URL o ruta del video de 15 segundos")
    video_base64: Optional[str] = Field(default=None, description="Contenido de video codificado en Base64")
    duracion_segundos: float = Field(default=15.0, gt=0, le=60, description="Duración nominal del video en segundos")
    num_fotogramas: int = Field(default=5, ge=3, le=5, description="Cantidad de fotogramas clave a muestrear (3 a 5)")
    raza_declarada: Optional[str] = Field(default=None)


class VisionAnalisisResult(BaseModel):
    biotipo_sugerido: str
    condicion_corporal_score: float = Field(ge=1.0, le=5.0)
    estimacion_dentaria: str
    confianza_score: float = Field(ge=0.0, le=1.0)
    fotogramas_muestreados: int = Field(ge=3, le=5)
    duracion_evaluada_seg: float
    es_vinculante: bool = False
    estado: str = "COMPLETADO"


class AnalisisBromatologicoInput(BaseModel):
    imagen_base64: Optional[str] = Field(
        default=None,
        description="Imagen del recorte muscular en formato PNG/JPEG codificada en Base64",
    )
    bgr_color: Optional[List[int]] = Field(
        default=None,
        min_length=3,
        max_length=3,
        description="Color BGR sintético [B, G, R] (0-255) para generar matriz de prueba si no se envía imagen_base64",
    )
    ancho: int = Field(default=64, ge=8, le=2048)
    alto: int = Field(default=64, ge=8, le=2048)


class AnalisisBromatologicoResult(BaseModel):
    l_star_promedio: float
    a_star_promedio: float
    b_star_promedio: float
    alerta_dfd: bool
    diagnostico: str
    recomendacion: str
    umbral_dfd_l_star: float = 46.0
    estado: str = "COMPLETADO"


class ChecklistMinsaInput(BaseModel):
    temperatura_recepcion_c: float = Field(description="Temperatura interna de la canal refrigerada en °C")
    color_organoleptico: Union[bool, str] = Field(
        default=True,
        description="True / 'NORMAL' / 'ROJO_CEREZA_BRILLANTE' si el color organoléptico es conforme",
    )
    ausencia_olores_extranos: bool = Field(
        default=True,
        description="True si hay ausencia total de olores extraños, rancios o putrefactos",
    )
    lote_id: Optional[str] = Field(default=None)


class ChecklistMinsaResult(BaseModel):
    normativa_referencia: str = "RM N.° 822-2018/MINSA"
    aprobado_sanitariamente: bool
    rechazo_sanitario: bool
    temperatura_recepcion_c: float
    temperatura_conforme: bool
    color_conforme: bool
    olor_conforme: bool
   