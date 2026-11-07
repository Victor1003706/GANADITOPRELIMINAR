"""Pruebas de la estimación orientativa de peso vivo (V1: homografía + Monte Carlo + calidad)."""

import base64
import math

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import zoometria as z
from main import app

client = TestClient(app)

URL = "/api/v1/peso/estimar"
URL_MULTI = "/api/v1/peso/estimar-multivista"
LADO_MARCADOR_PX = 100
LADO_MARCADOR_CM = 20.0  # => 0,2 cm por píxel en el plano métrico

# Largo 700 px = 140 cm; profundidad 350 px = 70 cm.
PUNTOS = {
    "punta_hombro": [300, 400],
    "punta_nalga": [1000, 400],
    "cruz": [400, 250],
    "pecho_inferior": [400, 600],
}
ORDEN = ("punta_hombro", "punta_nalga", "cruz", "pecho_inferior")


def _png_b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


def _lienzo(marcadores: list[tuple[int, int, int]], alto=800, ancho=1200) -> np.ndarray:
    """Fondo blanco con marcadores ArUco (id, x, y) de 100 px y un patrón con textura."""
    img = np.full((alto, ancho, 3), 255, dtype=np.uint8)
    # Textura en la zona del animal para que el control de nitidez tenga bordes reales.
    rng = np.random.default_rng(0)
    img[250:600, 300:1000] = rng.integers(0, 255, (350, 700, 1), dtype=np.uint8)
    dic = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    for marcador_id, x, y in marcadores:
        m = cv2.aruco.generateImageMarker(dic, marcador_id, LADO_MARCADOR_PX)
        # Margen blanco (zona de silencio) alrededor del marcador.
        img[y - 20 : y + LADO_MARCADOR_PX + 20, x - 20 : x + LADO_MARCADOR_PX + 20] = 255
        img[y : y + LADO_MARCADOR_PX, x : x + LADO_MARCADOR_PX] = cv2.cvtColor(m, cv2.COLOR_GRAY2BGR)
    return img


def _imagen(marcadores: list[tuple[int, int, int]]) -> str:
    return _png_b64(_lienzo(marcadores))


def _cuerpo_aruco(**extra) -> dict:
    return {
        "imagen_base64": _imagen([(7, 50, 50)]),
        "puntos": PUNTOS,
        "calibracion": {"tipo": "ARUCO", "lado_cm": LADO_MARCADOR_CM},
        **extra,
    }


def _cuerpo_referencia(distancia_cm=100.0, **extra) -> dict:
    return {
        "puntos": PUNTOS,
        "calibracion": {"tipo": "REFERENCIA", "punto_a": [100, 700], "punto_b": [600, 700], "distancia_cm": distancia_cm},
        **extra,
    }


def _vista_en_perspectiva(h: np.ndarray) -> dict:
    """Lienzo métrico deformado por una homografía conocida, con los puntos transformados."""
    img = cv2.warpPerspective(_lienzo([(7, 50, 50)]), h, (1500, 1100), borderValue=(255, 255, 255))
    pts = np.array([PUNTOS[k] for k in ORDEN], dtype=np.float32).reshape(-1, 1, 2)
    transformados = cv2.perspectiveTransform(pts, h).reshape(-1, 2)
    return {
        "imagen_base64": _png_b64(img),
        "puntos": {k: [float(x), float(y)] for k, (x, y) in zip(ORDEN, transformados)},
        "calibracion": {"tipo": "ARUCO", "lado_cm": LADO_MARCADOR_CM},
    }


# ---------------------------------------------------------------------------
# Vista única
# ---------------------------------------------------------------------------

def test_aruco_calibra_y_estima_con_intervalo_y_sin_ser_vinculante():
    r = client.post(URL, json=_cuerpo_aruco())
    assert r.status_code == 200, r.text
    d = r.json()

    m = d["muestra"]
    assert m["fuente_calibracion"] == "ARUCO"
    # Marcador frontal: la perspectiva no es detectable y se usa la similitud (4 GL).
    assert m["rectificacion"] == "SIMILITUD"
    assert m["residuo_similitud_px"] < 0.9
    assert m["cm_por_pixel"] == pytest.approx(0.2, rel=0.01)
    assert m["largo_corporal_cm"] == pytest.approx(140, rel=0.01)
    assert m["profundidad_pecho_cm"] == pytest.approx(70, rel=0.01)
    assert m["perimetro_medido"] is False
    assert m["relacion_ancho_profundidad_supuesta"] == 0.65

    esperado = float(z.peso_schaeffer_kg(z.perimetro_elipse_cm(m["profundidad_pecho_cm"], 0.65), m["largo_corporal_cm"]))
    assert d["peso_estimado_kg"] == pytest.app