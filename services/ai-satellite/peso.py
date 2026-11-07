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

    punta_hombro: Punto = Field(description="Encuentro, en píxeles (x, y) del fotograma")
    punta_nalga: Punto = Field(description="Isquion, en píxeles (x, y)")
    cruz: Punto = Field(description="Parte más alta de la cruz, en píxeles (x, y)")
    pecho_inferior: Punto = Field(description="Punto inferior del pecho detrás del codo, en píxeles (x, y)")

    def como_arreglo(self) -> np.ndarray:
        return np.array([self.punta_hombro, self.punta_nalga, self.cruz, self.pecho_inferior], dtype=float)


class CalibracionAruco(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["ARUCO"] = "ARUCO"
    lado_cm: float = Field(gt=2.0, le=100.0, description="Lado impreso del marcador, en cm")
    diccionario: Literal["DICT_4X4_50", "DICT_5X5_50", "DICT_6X6_50"] = "DICT_4X4_50"
    marcador_id: int | None = Field(default=None, ge=0, le=49)


class CalibracionReferencia(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["REFERENCIA"] = "REFERENCIA"
    punto_a: Punto
    punto_b: Punto
    distancia_cm: float = Field(gt=5.0, le=500.0)


class EstimacionPesoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    imagen_base64: str | None = Field(
        default=None,
        description="Fotograma de perfil en PNG/JPEG Base64. Obligatorio con calibración ARUCO.",
    )
    puntos: PuntosAnatomicos
    calibracion: CalibracionAruco | CalibracionReferencia = Field(discriminator="tipo")
    perimetro_toracico_cm: float | None = Field(
        default=None,
        gt=0,
        description="Perímetro torácico medido con cinta, si existe. Reduce la incertidumbre.",
    )
    incertidumbre_punto_px: float | None = Field(
        default=None,
        ge=0.5,
        le=50.0,
        description="Desviación típica del marcado de un punto, en píxeles (por defecto, 0.3 % de la diagonal).",
    )

    @model_validator(mode="after")
    def _aruco_requiere_imagen(self) -> "EstimacionPesoInput":
        if self.calibracion.tipo == "ARUCO" and not self.imagen_base64:
            raise ValueError("La calibración ARUCO requiere 'imagen_base64'.")
        return self


class EstimacionMultivistaInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vistas: list[EstimacionPesoInput] = Field(min_length=2, max_length=MAX_VISTAS)

    @model_validator(mode="after")
    def _coherencia(self) -> "EstimacionMultivistaInput":
        perimetros = {v.perimetro_toracico_cm for v in self.vistas}
        if len(perimetros) > 1:
            raise ValueError("Todas las vistas deben enviar el mismo 'perimetro_toracico_cm' (o ninguna).")
        total = sum(len(v.imagen_base64 or "") for v in self.vistas)
        if total > MAX_BASE64_TOTAL:
            raise ValueError("Las imágenes superan en conjunto el máximo permitido.")
        return self


class MuestraZoometrica(BaseModel):
    """Medidas intermedias para guardar y, en la etapa 2, comparar con el peso real."""

    cm_por_pixel: float = Field(description="Escala media en la zona del animal (informativa)")
    fuente_calibracion: Literal["ARUCO", "REFERENCIA"]
    rectificacion: Literal["SIMILITUD", "HOMOGRAFIA", "ESCALA"]
    lado_marcador_px: float | None = None
    inclinacion_marcador: float | None = Field(default=None, description="Lado mayor / lado menor del marcador")
    residuo_similitud_px: float | None = Field(
        default=None, description="RMS de ajustar una similitud al marcador (diagnóstico de perspectiva)"
    )
    sesgo_perspectiva_log: float | None = Field(
        default=None, description="Sesgo estimado de la similitud en ln(kg), sumado al intervalo"
    )
    largo_corporal_cm: float
    profundidad_pecho_cm: float
    perimetro_toracico_cm: float
    perimetro_medido: bool
    relacion_ancho_profundidad_supuesta: float | None
    sigma_punto_px: float


class ContribucionIncertidumbre(BaseModel):
    fuente: str
    descripcion: str
    contribucion: float = Field(description="Fracción de la varianza de ln(peso), primer orden")
    por_vista: bool


class Incertidumbre(BaseModel):
    nivel_confianza: float
    desviacion_log: float = Field(description="Desviación típica de ln(peso) simulada")
    coeficiente_variacion: float
    n_simulaciones: int
    semilla: int
    contribuciones: list[ContribucionIncertidumbre]


class ControlCalidad(BaseModel):
    codigo: str
    estado: Literal["OK", "ADVERTENCIA", "NO_EVALUADO"]
    valor: float | None = None
    umbral: str
    detalle: str


class EstimacionPesoResult(BaseModel):
    peso_estimado_kg: float
    rango_min_kg: float
    rango_max_kg: float
    metodo: str = METODO
    version_parametros: str
    es_vinculante: bool = False
    validado: bool = False
    advertencias: list[str]
    incertidumbre: Incertidumbre
    calidad: list[ControlCalidad]
    muestra: MuestraZoometrica
    estado: Literal["COMPLETADO"] = "COMPLETADO"


class ResumenVista(BaseModel):
    indice: int
    peso_estimado_kg: float
    ponderacion: float
    muestra: MuestraZoometrica
    calidad: list[ControlCalidad]


class Heterogeneidad(BaseModel):
    q_cochran: float
    grados_libertad: int
    consistente: bool
    factor_inflacion: float


class EstimacionMultivistaResult(BaseModel):
    peso_estimado_kg: float
    rango_min_kg: float
    rango_max_kg: float
    metodo: str = METODO
    version_parametros: str
    es_vinculante: bool = False
    validado: bool = False
    advertencias: list[str]
    incertidumbre: Incertidumbre
    heterogeneidad: Heterogeneidad
    vistas: list[ResumenVista]
    estado: Literal["COMPLETADO"] = "COMPLETADO"


# ---------------------------------------------------------------------------
# Imagen y marcador
# ---------------------------------------------------------------------------

_MARCADORES_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def dimensiones_cabecera(raw: bytes) -> tuple[int, int] | None:
    """(ancho, alto) leídos de la cabecera PNG (IHDR) o JPEG (SOFn), sin decodificar píxeles."""
    if raw[:8] == bytes.fromhex("89504e470d0a1a0a") and len(raw) >= 24 and raw[12:16] == b"IHDR":
        return int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    if raw[:2] != bytes.fromhex("ffd8"):
        return None
    i = 2
    while i + 4 <= len(raw):
        if raw[i] != 0xFF:
            return None
        marcador = raw[i + 1]
        if marcador == 0xFF:  # relleno
            i += 1
            continue
        if marcador in (0xD8, 0x01) or 0xD0 <= marcador <= 0xD7:
            i += 2
            continue
        longitud = int.from_bytes(raw[i + 2 : i + 4], "big")
        if longitud < 2:
            return None
        if marcador in _MARCADORES_SOF:
            if i + 9 > len(raw):
                return None
            alto = int.from_bytes(raw[i + 5 : i + 7], "big")
            ancho = int.from_bytes(raw[i + 7 : i + 9], "big")
            return ancho, alto
        if marcador == 0xDA:  # inicio de datos sin SOF previo
            return None
        i += 2 + longitud
    return None


def decodificar_fotograma(imagen_b64: str) -> np.ndarray:
    if "," in imagen_b64:
        imagen_b64 = imagen_b64.split(",", 1)[1]
    # Base64 ocupa 4/3 del binario: se descarta antes de decodificar.
    if len(imagen_b64) > MAX_IMAGEN_BYTES * 4 // 3 + 4:
        raise ImagenDemasiadoGrandeError("La imagen supera el máximo de 8 MB.")
    try:
        raw = base64.b64decode(imagen_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise EstimacionPesoError("La imagen no es Base64 válido.") from exc
    # Se leen las dimensiones de la cabecera ANTES de decodificar: un JPEG pequeño puede
    # declarar 60 000 x 60 000 px y reservar gigabytes (bomba de descompresión).
    dimensiones = dimensiones_cabecera(raw)
    if dimensiones is None:
        raise EstimacionPesoError("No se pudo leer la imagen (se acepta PNG o JPEG).")
    if max(dimensiones) > MAX_IMAGEN_LADO_PX:
        raise ImagenDemasiadoGrandeError("La imagen supera los 8000 píxeles de lado.")
    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise EstimacionPesoError("No se pudo decodificar la imagen (se acepta PNG o JPEG).")
    if max(img.shape[:2]) > MAX_IMAGEN_LADO_PX:
        raise ImagenDemasiadoGrandeError("La imagen supera los 8000 píxeles de lado.")
    return img


@dataclass(frozen=True)
class MarcadorDetectado:
    esquinas_px: np.ndarray  # (4, 2), orden horario de ArUco
    lado_px: float
    inclinacion: float
    residuo_similitud_px: float | None = None


def detectar_marcador_aruco(img_bgr: np.ndarray, cal: CalibracionAruco) -> MarcadorDetectado:
    """Detecta el marcador y refina sus esquinas a subpíxel."""
    gris = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    diccionario = cv2.aruco.getPredefinedDictionary(DICCIONARIOS_ARUCO[cal.diccionario])
    parametros = cv2.aruco.DetectorParameters()
    parametros.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    detector = cv2.aruco.ArucoDetector(diccionario, parametros)
    esquinas, ids, _ = detector.detectMarkers(gris)
    if ids is None or len(ids) == 0:
        raise EstimacionPesoError("No se detectó el marcador de calibración en la imagen.")

    candidatos = [
        (int(i), e.reshape(4, 2).astype(float))
        for i, e in zip(ids.flatten(), esquinas)
        if cal.marcador_id is None or int(i) == cal.marcador_id
    ]
    if not candidatos:
        raise EstimacionPesoError(f"No se encontró el marcador con id {cal.marcador_id}.")
    if len(candidatos) > 1:
        raise EstimacionPesoError("Hay más de un marcador en la imagen: indique 'marcador_id'.")

    _, c = candidatos[0]
    lados = [float(np.linalg.norm(c[k] - c[(k + 1) % 4])) for k in range(4)]
    lado_px = sum(lados) / 4.0
    if lado_px < LADO_MARCADOR_MIN_PX:
        raise EstimacionPesoError("El marcador se ve demasiado pequeño: acérquese o imprímalo más grande.")
    if min(lados) <= 0:
        raise EstimacionPesoError("El marcador detectado es degenerado.")
    inclinacion = max(lados) / min(lados)
    if inclinacion > INCLINACION_MARCADOR_MAX:
        raise EstimacionPesoError("El marcador está demasiado inclinado respecto de la cámara.")
    return MarcadorDetectado(esquinas_px=c, lado_px=lado_px, inclinacion=inclinacion)


# ---------------------------------------------------------------------------
# Preparación de una vista
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class VistaPreparada:
    vista: z.Vista
    gris: np.ndarray | None
    marcador: MarcadorDetectado | None
    perimetro_cinta_cm: float | None
    fuente: Literal["ARUCO", "REFERENCIA"]


def _validar_puntos_en_imagen(puntos: np.ndarray, alto: int, ancho: int) -> None:
    nombres = ("punta_hombro", "punta_nalga", "cruz", "pecho_inferior")
    for nombre, (x, y) in zip(nombres, puntos):
        if not (0 <= x < ancho and 0 <= y < alto):
            raise EstimacionPesoError(f"El punto '{nombre}' está fuera de la imagen.")


def _sigma_punto(payload: EstimacionPesoInput, diagonal_px: float, params: ParametrosZoometria) -> float:
    if payload.incertidumbre_punto_px is not None:
        return payload.incertidumbre_punto_px
    return max(params.sigma_punto_min_px, params.sigma_punto_relativo_diagonal * diagonal_px)


def preparar_vista(payload: EstimacionPesoInput, params: ParametrosZoometria) -> VistaPreparada:
    puntos = payload.puntos.como_arreglo()
    img = decodificar_fotograma(payload.imagen_base64) if payload.imagen_base64 else None
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img is not None else None

    if img is not None:
        alto, ancho = img.shape[:2]
        _validar_puntos_en_imagen(puntos, alto, ancho)
        diagonal = math.hypot(alto, ancho)
    else:
        # Sin imagen se usa la extensión de los puntos marcados como tamaño de referencia.
        extension = np.ptp(puntos, axis=0)
        diagonal = float(math.hypot(*extension))

    sigma = _sigma_punto(payload, diagonal, params)
    cal = payload.calibracion
    if isinstance(cal, CalibracionAruco):
        assert img is not None  # garantizado por el validador del contrato
        marcador = detectar_marcador_aruco(img, cal)
        residuo = z.residuo_similitud_px(marcador.esquinas_px, cal.lado_cm)
        base = z.Vista(puntos_px=puntos, sigma_punto_px=sigma, esquinas_px=marcador.esquinas_px, lado_cm=cal.lado_cm)
        vista = seleccionar_rectificacion(base, payload.perimetro_toracico_cm, params)
        marcador = MarcadorDetectado(marcador.esquinas_px, marcador.lado_px, marcador.inclinacion, residuo)
        return VistaPreparada(vista, gris, marcador, payload.perimetro_toracico_cm, "ARUCO")

    referencia = np.array([cal.punto_a, cal.punto_b], dtype=float)
    if float(np.linalg.norm(referencia[0] - referencia[1])) < LADO_MARCADOR_MIN_PX:
        raise EstimacionPesoError("La referencia de calibración es demasiado corta en la imagen.")
    vista = z.Vista(puntos_px=puntos, sigma_punto_px=sigma, referencia_px=referencia, distancia_cm=cal.distancia_cm)
    return VistaPreparada(vista, gris, None, payload.perimetro_toracico_cm, "REFERENCIA")


def seleccionar_rectificacion(
    base: z.Vista, perimetro_cinta_cm: float | None, params: ParametrosZoometria
) -> z.Vista:
    """
    Elige SIMILITUD u HOMOGRAFIA por error cuadrático medio en ln(peso):
      - var_H, var_S: varianza (robusta) debida al ruido de las esquinas con cada modelo;
      - d = ln W_H - ln W_S con las esquinas detectadas. Como E[d^2] ≈ sesgo^2 + var_H,
        el sesgo^2 de la similitud se estima como max(0, d^2 - var_H).
    Se usa la similitud si sesgo^2 + var_S <= var_H, y su sesgo se suma al intervalo
    como la fuente "perspectiva". Detectar perspectiva no basta: corregirla con un
    marcador pequeño puede aumentar el error total.
    """
    n = params.n_simulaciones_seleccion
    rng = np.random.default_rng(params.semilla + 7)
    extr = z.Extracciones.nuevas(rng, n)
    ruido = z.ruido_por_vista(rng, n)
    v_h, v_s = replace(base, rectificacion="HOMOGRAFIA"), replace(base, rectificacion="SIMILITUD")
    solo_esquinas, nada = frozenset({"esquinas"}), frozenset()

    def central(v: z.Vista) -> float:
        return float(z.log_peso(v, perimetro_cinta_cm, params, extr, ruido, nada)[0])

    var_h = z.varianza_robusta(z.log_peso(v_h, perimetro_cinta_cm, params, extr, ruido, solo_esquinas))
    var_s = z.varianza_robusta(z.log_peso(v_s, perimetro_cinta_cm, params, extr, ruido, solo_esquinas))
    sesgo2 = max(0.0, (central(v_h) - central(v_s)) ** 2 - var_h)
    if sesgo2 + var_s <= var_h:
        return replace(v_s, sigma_sesgo_perspectiva_log=math.sqrt(sesgo2))
    return v_h


def _fuentes_aplicables(prep: VistaPreparada) -> tuple[str, ...]:
    fuentes = ["puntos"]
    fuentes += ["esquinas", "impresion_marcador"] if prep.vista.usa_aruco else ["referencia"]
    if prep.vista.sigma_sesgo_perspectiva_log > 0:
        fuentes.append("perspectiva")
    fuentes.append("cinta" if prep.perimetro_cinta_cm is not None else "relacion_ancho")
    fuentes.append("modelo")
    return tuple(fuentes)


# ---------------------------------------------------------------------------
# Validaciones duras y controles de calidad
# ---------------------------------------------------------------------------

def _en_rango(valor: float, rango: tuple[float, float], etiqueta: str) -> None:
    if not (rango[0] <= valor <= rango[1]):
        raise EstimacionPesoError(
            f"{etiqueta} de {valor:.1f} fuera del rango plausible ({rango[0]:.0f}-{rango[1]:.0f}): "
            "revise los puntos o la calibración."
        )


def _angulo_grados(v: np.ndarray, w: np.ndarray) -> float:
    cos = float(np.dot(v, w) / (np.linalg.norm(v) * np.linalg.norm(w)))
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def controles_calidad(prep: VistaPreparada, largo_cm: float, profundidad_cm: float) -> list[ControlCalidad]:
    p = prep.vista.puntos_px
    eje_cuerpo = p[z.NALGA] - p[z.HOMBRO]
    eje_pecho = p[z.PECHO] - p[z.CRUZ]
    controles: list[ControlCalidad] = []

    def agregar(codigo: str, ok: bool | None, valor: float | None, umbral: str, detalle: str) -> None:
        estado = "NO_EVALUADO" if ok is None else ("OK" if ok else "ADVERTENCIA")
        controles.append(
            ControlCalidad(codigo=codigo, estado=estado, valor=None if valor is None else round(valor, 3),
                           umbral=umbral, detalle=detalle)
        )

    if prep.gris is not None:
        x0, y0 = np.floor(p.min(axis=0)).astype(int)
        x1, y1 = np.ceil(p.max(axis=0)).astype(int) + 1
        zona = prep.gris[max(0, y0):y1, max(0, x0):x1]
        nitidez = float(cv2.Laplacian(zona, cv2.CV_64F).var()) if zona.size else 0.0
        agregar("NITIDEZ", nitidez >= UMBRAL_NITIDEZ_LAPLACIANO, nitidez, f">= {UMBRAL_NITIDEZ_LAPLACIANO:.0f}",
                "Varianza del laplaciano en la zona del animal; baja = foto movida o desenfocada.")
    else:
        agregar("NITIDEZ", None, None, f">= {UMBRAL_NITIDEZ_LAPLACIANO:.0f}", "Sin imagen: no se evalúa.")

    if prep.marcador is not None:
        m = prep.marcador
        agregar("INCLINACION_MARCADOR", m.inclinacion <= UMBRAL_INCLINACION_ADVERTENCIA, m.inclinacion,
                f"<= {UMBRAL_INCLINACION_ADVERTENCIA}",
                "La homografía corrige la inclinación del plano del marcador, pero solo si el animal está en ese plano.")
        relativo = m.lado_px / float(np.linalg.norm(eje_cuerpo))
        agregar("TAMANO_MARCADOR", relativo >= UMBRAL_MARCADOR_RELATIVO, relativo, f">= {UMBRAL_MARCADOR_RELATIVO}",
                "Un marcador pequeño frente al animal extrapola la escala y amplifica el error de sus esquinas.")

    angulo_perfil = math.degrees(math.atan2(abs(eje_cuerpo[1]), abs(eje_cuerpo[0])))
    agregar("PERFIL", angulo_perfil <= UMBRAL_ANGULO_PERFIL_GRADOS, angulo_perfil,
            f"<= {UMBRAL_ANGULO_PERFIL_GRADOS:.0f} grados",
            "Ángulo del eje hombro-nalga con la horizontal; alto = cámara girada o animal no está de perfil.")

    desvio = abs(90.0 - _angulo_grados(eje_cuerpo, eje_pecho))
    agregar("ORTOGONALIDAD", desvio <= UMBRAL_ORTOGONALIDAD_GRADOS, desvio,
            f"<= {UMBRAL_ORTOGONALIDAD_GRADOS:.0f} grados",
            "La línea cruz-pecho debería ser casi perpendicular al eje del cuerpo.")

    agregar("ORIENTACION", bool(p[z.CRUZ][1] < p[z.PECHO][1]), None, "cruz por encima del pecho",
            "Si la cruz queda debajo del pecho, los puntos están invertidos o la foto está rotada.")

    proporcion = profundidad_cm / largo_cm
    lo, hi = PROPORCION_PROFUNDIDAD_LARGO
    agregar("PROPORCION", lo <= proporcion <= hi, proporcion, f"{lo}-{hi}",
            "Profundidad de pecho / largo corporal fuera de lo habitual en bovinos.")
    return controles


# ---------------------------------------------------------------------------
# Simulación
# ---------------------------------------------------------------------------

def _central(prep: VistaPreparada, params: ParametrosZoometria) -> tuple[float, z.MedidasVista, float]:
    extr = z.Extracciones.nuevas(np.random.default_rng(0), 1)
    sin_ruido = frozenset()
    medidas = z.medir_vista(prep.vista, params, extr, z.ruido_por_vista(np.random.default_rng(0), 1), sin_ruido)
    perimetro = float(z.perimetro_simulado(medidas.profundidad_cm, prep.perimetro_cinta_cm, params, extr, sin_ruido)[0])
    peso = float(z.peso_modelo_kg(perimetro, medidas.largo_cm[0], params))
    return peso, medidas, perimetro


def _contribuciones(
    preps: list[VistaPreparada], pesos_vistas: np.ndarray, params: ParametrosZoometria
) -> list[ContribucionIncertidumbre]:
    """Varianza de ln(peso) con UNA sola fuente activa (aproximación de primer orden)."""
    n = max(500, params.n_simulaciones // 4)
    fuentes = []
    for prep in preps:
        for f in _fuentes_aplicables(prep):
            if f not in fuentes:
                fuentes.append(f)
    varianzas: dict[str, float] = {}
    for indice, fuente in enumerate(fuentes):
        rng = np.random.default_rng(params.semilla + 1 + indice)
        extr = z.Extracciones.nuevas(rng, n)
        if fuente == "modelo":
            varianzas[fuente] = params.sigma_modelo_log**2
            continue
        activas = frozenset({fuente})
        combinado = np.zeros(n)
        for w, prep in zip(pesos_vistas, preps):
            combinado += w * z.log_peso(prep.vista, prep.perimetro_cinta_cm, params, extr,
                                        z.ruido_por_vista(rng, n), activas)
        varianzas[fuente] = float(np.var(combinado))
    total = sum(varianzas.values()) or 1.0
    return [
        ContribucionIncertidumbre(
            fuente=f, descripcion=DESCRIPCION_FUENTES[f], contribucion=round(v / total, 4),
            por_vista=f in z.FUENTES_POR_VISTA,
        )
        for f, v in sorted(varianzas.items(), key=lambda kv: -kv[1])
    ]


@dataclass(frozen=True)
class SimulacionCombinada:
    muestras_log: np.ndarray
    pesos_vistas: np.ndarray
    combinacion: z.Combinacion | None


def _simular(preps: list[VistaPreparada], centrales_log: np.ndarray, params: ParametrosZoometria) -> SimulacionCombinada:
    n = params.n_simulaciones
    rng = np.random.default_rng(params.semilla)
    extr = z.Extracciones.nuevas(rng, n)  # comunes: compartidas por todas las vistas
    todas = frozenset(z.FUENTES)
    por_vista_activas = frozenset(z.FUENTES_POR_VISTA)

    completas, varianzas_propias = [], []
    for prep in preps:
        completas.append(z.log_peso(prep.vista, prep.perimetro_cinta_cm, params, extr, z.ruido_por_vista(rng, n), todas))
        # Números aleatorios comunes: la varianza propia de cada vista se estima con la
        # MISMA semilla, así dos vistas de igual geometría reciben exactamente el mismo peso.
        ruido_comun = z.ruido_por_vista(np.random.default_rng(params.semilla + 999), n)
        propias = z.log_peso(prep.vista, prep.perimetro_cinta_cm, params, extr, ruido_comun, por_vista_activas)
        varianzas_propias.append(z.varianza_robusta(propias))

    if len(preps) == 1:
        pesos = np.array([1.0])
        combinacion = None
        muestras = completas[0]
    else:
        combinacion = z.combinar_vistas(centrales_log, np.array(varianzas_propias))
        pesos = combinacion.pesos
        muestras = np.sum(pesos[:, None] * np.stack(completas), axis=0)
        if combinacion.factor_inflacion > 1.0:
            var_propia_combinada = 1.0 / np.sum(1.0 / np.maximum(varianzas_propias, 1e-12))
            extra = math.sqrt((combinacion.factor_inflacion - 1.0) * var_propia_combinada)
            muestras = muestras + rng.standard_normal(n) * extra

    muestras = muestras + extr.comunes["modelo"] * params.sigma_modelo_log
    return SimulacionCombinada(muestras_log=muestras, pesos_vistas=pesos, combinacion=combinacion)


def _incertidumbre(sim: SimulacionCombinada, preps: list[VistaPreparada], params: ParametrosZoometria) -> Incertidumbre:
    sd = float(np.std(sim.muestras_log))
    return Incertidumbre(
        nivel_confianza=params.nivel_confianza,
        desviacion_log=round(sd, 4),
        coeficiente_variacion=round(math.sqrt(math.exp(sd**2) - 1), 4),
        n_simulaciones=params.n_simulaciones,
        semilla=params.semilla,
        contribuciones=_contribuciones(preps, sim.pesos_vistas, params),
    )


def _muestra(prep: VistaPreparada, medidas: z.MedidasVista, perimetro: float, params: ParametrosZoometria) -> MuestraZoometrica:
    p = prep.vista.puntos_px
    largo_px = float(np.linalg.norm(p[z.HOMBRO] - p[z.NALGA]))
    m = prep.marcador
    return MuestraZoometrica(
        cm_por_pixel=round(float(medidas.largo_cm[0]) / largo_px, 5),
        fuente_calibracion=prep.fuente,
        rectificacion=prep.vista.rectificacion if prep.vista.usa_aruco else "ESCALA",
        residuo_similitud_px=round(m.residuo_similitud_px, 4) if m and m.residuo_similitud_px is not None else None,
        sesgo_perspectiva_log=round(prep.vista.sigma_sesgo_perspectiva_log, 5) if prep.vista.usa_aruco else None,
        lado_marcador_px=round(m.lado_px, 2) if m else None,
        inclinacion_marcador=round(m.inclinacion, 4) if m else None,
        largo_corporal_cm=round(float(medidas.largo_cm[0]), 1),
        profundidad_pecho_cm=round(float(medidas.profundidad_cm[0]), 1),
        perimetro_toracico_cm=round(perimetro, 1),
        perimetro_medido=prep.perimetro_cinta_cm is not None,
        relacion_ancho_profundidad_supuesta=None if prep.perimetro_cinta_cm is not None else params.relacion_ancho_central,
        sigma_punto_px=round(prep.vista.sigma_punto_px, 3),
    )


def _evaluar_vista(payload: EstimacionPesoInput, params: ParametrosZoometria):
    prep = preparar_vista(payload, params)
    peso, medidas, perimetro = _central(prep, params)
    largo, profundidad = float(medidas.largo_cm[0]), float(medidas.profundidad_cm[0])
    _en_rango(largo, LARGO_CM_RANGO, "Largo corporal (cm)")
    _en_rango(profundidad, PROFUNDIDAD_CM_RANGO, "Profundidad de pecho (cm)")
    if prep.perimetro_cinta_cm is not None:
        _en_rango(prep.perimetro_cinta_cm, PERIMETRO_CM_RANGO, "Perímetro torácico (cm)")
    _en_rango(peso, PESO_KG_RANGO, "Peso estimado (kg)")
    return prep, peso, medidas, perimetro, controles_calidad(prep, largo, profundidad)


def _advertencias_base(preps: list[VistaPreparada], controles: list[ControlCalidad]) -> list[str]:
    advertencias = [
        "Estimación orientativa: no es un pesaje y puede equivocarse.",
        "No usar para liquidar por kilogramo; la puja es por el precio total del lote.",
        "Parámetros del modelo aún sin calibrar con pesajes reales del piloto.",
    ]
    if any(p.vista.usa_aruco for p in preps):
        advertencias.append("El marcador debe estar junto al animal y en su mismo plano.")
    if any(p.perimetro_cinta_cm is None for p in preps):
        advertencias.append(
            "Perímetro torácico aproximado a partir de la profundidad de pecho con un ancho supuesto, "
            "aún no calibrado con pesajes reales."
        )
    observados = sorted({c.codigo for c in controles if c.estado == "ADVERTENCIA"})
    if observados:
        advertencias.append("Controles de calidad con observaciones: " + ", ".join(observados) + ".")
    return advertencias


# ---------------------------------------------------------------------------
# Casos de uso
# ---------------------------------------------------------------------------

def estimar_peso(payload: EstimacionPesoInput, params: ParametrosZoometria = PARAMETROS_VIGENTES) -> EstimacionPesoResult:
    prep, peso, medidas, perimetro, calidad = _evaluar_vista(payload, params)
    sim = _simular([prep], np.array([math.log(peso)]), params)
    bajo, alto = z.cuantiles_intervalo(sim.muestras_log, params.nivel_confianza)
    return EstimacionPesoResult(
        peso_estimado_kg=round(peso, 1),
        rango_min_kg=round(min(bajo, peso), 1),
        rango_max_kg=round(max(alto, peso), 1),
        version_parametros=params.version,
        advertencias=_advertencias_base([prep], calidad),
        incertidumbre=_incertidumbre(sim, [prep], params),
        calidad=calidad,
        muestra=_muestra(prep, medidas, perimetro, params),
    )


def estimar_peso_multivista(
    payload: EstimacionMultivistaInput, params: ParametrosZoometria = PARAMETROS_VIGENTES
) -> EstimacionMultivistaResult:
    evaluadas = []
    for indice, vista in enumerate(payload.vistas):
        try:
            evaluadas.append(_evaluar_vista(vista, params))
        except EstimacionPesoError as err:
            raise EstimacionPesoError(f"Vista {indice}: {err}") from err
    preps = [e[0] for e in evaluadas]
    centrales_log = np.log([e[1] for e in evaluadas])
    sim = _simular(preps, centrales_log, params)
    assert sim.combinacion is not None
    peso = math.exp(float(np.sum(sim.pesos_vistas * centrales_log)))
    bajo, alto = z.cuantiles_intervalo(sim.muestras_log, params.nivel_confianza)

    controles = [c for e in evaluadas for c in e[4]]
    advertencias = _advertencias_base(preps, controles)
    advertencias.append("Promediar vistas reduce el error de marcado, no el del ancho supuesto ni el del modelo.")
    if not sim.combinacion.consistente:
        advertencias.append(
            "Las vistas discrepan más de lo esperado por su error: se amplió el rango. "
            "Verifique que todas sean del mismo animal y que los puntos estén bien marcados."
        )
    return EstimacionMultivistaResult(
        peso_estimado_kg=round(peso, 1),
        rango_min_kg=round(min(bajo, peso), 1),
        rango_max_kg=round(max(alto, peso), 1),
        version_parametros=params.version,
        advertencias=advertencias,
        incertidumbre=_incertidumbre(sim, preps, params),
        heterogeneidad=Heterogeneidad(
            q_cochran=round(sim.combinacion.q, 4),
            grados_libertad=sim.combinacion.gl,
            consistente=sim.combinacion.consistente,
            factor_inflacion=round(sim.combinacion.factor_inflacion, 4),
        ),
        vistas=[
            ResumenVista(
                indice=i, peso_estimado_kg=round(e[1], 1), ponderacion=round(float(w), 4),
                muestra=_muestra(e[0], e[2], e[3], params), calidad=e[4],
            )
            for i, (e, w) in enumerate(zip(evaluadas, sim.pesos_vistas))
        ],
    )
