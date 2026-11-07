"""
Pruebas de Integración y Validación Bromatológica / Visión Computacional
para services/ai-satellite (pytest + FastAPI TestClient + OpenCV/NumPy).
"""

import base64
import cv2
import numpy as np
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def generar_png_base64_bgr(b: int, g: int, r: int, width: int = 64, height: int = 64) -> str:
    """Genera una imagen PNG real en memoria usando OpenCV y la codifica en Base64."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:, :] = [b, g, r]
    ok, buf = cv2.imencode(".png", img)
    assert ok, "Error al codificar imagen PNG con OpenCV"
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def test_cielab_carne_oscura_dfd_activa_alerta():
    """
    Imagen sintética oscura (L* < 46.0) debe activar alerta_dfd = True
    con diagnóstico 'Posible Carne Oscura, Firme y Seca DFD'.
    """
    # Color rojo muy oscuro / morado oscuro (BGR = [25, 20, 65]) -> L* ~ 14.5 < 46.0
    img_b64 = generar_png_base64_bgr(25, 20, 65)

    response = client.post(
        "/api/v1/bromatologia/analizar-color",
        json={"imagen_base64": img_b64},
    )
    assert response.status_code == 200
    data = response.json()

    assert data["l_star_promedio"] < 46.0, f"Se esperaba L* < 46.0, obtenido: {data['l_star_promedio']}"
    assert data["alerta_dfd"] is True
    assert "Posible Carne Oscura, Firme y Seca DFD" in data["diagnostico"]


def test_cielab_carne_roja_normal_sin_alerta_dfd():
    """
    Imagen con coloración roja cereza brillante normal (L* > 50.0)
    debe retornar alerta_dfd = False.
    """
    # Color rojo cereza brillante (BGR = [95, 100, 225]) -> L* ~ 57.5 > 50.0
    img_b64 = generar_png_base64_bgr(95, 100, 225)

    response = client.post(
        "/api/v1/bromatologia/analizar-color",
        json={"imagen_base64": img_b64},
    )
    assert response.status_code == 200
    data = response.json()

    assert data["l_star_promedio"] > 50.0, f"Se esperaba L* > 50.0, obtenido: {data['l_star_promedio']}"
    assert data["alerta_dfd"] is False


def test_checklist_minsa_rechazo_por_temperatura_mayor_a_4c():
    """
    Validación de checklist RM N.° 822-2018/MINSA:
    rechazo sanitario obligatorio si la temperatura de recepción supera los 4.0 °C.
    """
    response = client.post(
        "/api/v1/bromatologia/checklist-minsa",
        json={
            "temperatura_recepcion_c": 6.8,
            "color_organoleptico": "ROJO_CEREZA_BRILLANTE",
            "ausencia_olores_extranos": True,
        },
    )
    assert response.status_code == 200
    data = response.json()

    assert data["normativa_referencia"] == "RM N.° 822-2018/MINSA"
    assert data["aprobado_sanitariamente"] is False
    assert data["rechazo_sanitario"] is True
    assert data["temperatura_conforme"] is False
    assert data["dictamen"] == "RECHAZO_SANITARIO_MINSA"


def test_checklist_minsa_aprobado_en_rango_0_a_4c():
    """
    Validación de checklist RM N.° 822-2018/MINSA:
    aprobación sanitaria cuando la temperatura está entre 0 °C y 4 °C (ej. 2.4 °C),
    color organoléptico normal y ausencia de olores extraños.
    """
    response = client.post(
        "/api/v1/bromatologia/checklist-minsa",
        json={
            "temperatura_recepcion_c": 2.4,
            "color_organoleptico": True,
            "ausencia_olores_extranos": True,
        },
    )
    assert response.status_code == 200
    data = response.json()

    assert data["aprobado_sanitariamente"] is True
    assert data["rechazo_sanitario"] is False
    assert data["temperatura_conforme"] is True
    assert data["dictamen"] == "APROBADO_CONFORME_MINSA"


def test_vision_analizar_video_muestreo_fotogramas():
    """
    Endpoint POST /api/v1/vision/analizar-video:
    muestrea de 3 a 5 fotogramas clave con OpenCV y retorna pre-dictamen no vinculante.
    """
    response = client.post(
        "/api/v1/vision/analizar-video",
        json={
         