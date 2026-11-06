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
    assert d["peso_estimado_kg"] == pytest.approx(esperado, rel=0.005)
    assert d["rango_min_kg"] < d["peso_estimado_kg"] < d["rango_max_kg"]
    assert d["es_vinculante"] is False and d["validado"] is False
    assert d["metodo"] == "ZOOMETRIA_SCHAEFFER_V1"
    assert d["version_parametros"] == z.PARAMETROS_VIGENTES.version
    assert any("no es un pesaje" in a for a in d["advertencias"])

    inc = d["incertidumbre"]
    assert inc["nivel_confianza"] == 0.90
    assert sum(c["contribucion"] for c in inc["contribuciones"]) == pytest.approx(1.0, abs=0.01)
    fuentes = {c["fuente"]: c for c in inc["contribuciones"]}
    assert set(fuentes) == {"puntos", "esquinas", "impresion_marcador", "relacion_ancho", "modelo"}
    # Sin cinta, el ancho supuesto y el modelo dominan el error; el marcado, mucho menos.
    assert fuentes["relacion_ancho"]["contribucion"] + fuentes["modelo"]["contribucion"] > 0.8
    assert fuentes["puntos"]["por_vista"] is True and fuentes["modelo"]["por_vista"] is False


def test_misma_entrada_da_exactamente_la_misma_salida():
    cuerpo = _cuerpo_aruco()
    assert client.post(URL, json=cuerpo).json() == client.post(URL, json=cuerpo).json()


def test_homografia_corrige_la_perspectiva_que_la_escala_unica_no_corrige():
    h = np.array([[1.0, 0.04, 40.0], [0.03, 1.0, 30.0], [2.0e-4, 1.0e-4, 1.0]])
    cuerpo = _vista_en_perspectiva(h)
    r = client.post(URL, json=cuerpo)
    assert r.status_code == 200, r.text
    d = r.json()
    m = d["muestra"]
    assert m["rectificacion"] == "HOMOGRAFIA"
    assert m["largo_corporal_cm"] == pytest.approx(140, rel=0.025)
    assert m["profundidad_pecho_cm"] == pytest.approx(70, rel=0.025)
    # La homografía extrapolada desde un marcador pequeño es sensible a sus esquinas:
    # el intervalo lo refleja.
    fuentes = {c["fuente"]: c["contribucion"] for c in d["incertidumbre"]["contribuciones"]}
    assert fuentes["esquinas"] > 0.05

    # El método V0 (lado medio del marcador como escala única) se equivoca bastante más.
    esquinas = np.array([[50, 50], [150, 50], [150, 150], [50, 150]], dtype=np.float32).reshape(-1, 1, 2)
    c = cv2.perspectiveTransform(esquinas, h).reshape(-1, 2)
    lado_px = np.mean([np.linalg.norm(c[k] - c[(k + 1) % 4]) for k in range(4)])
    p = cuerpo["puntos"]
    largo_v0 = math.dist(p["punta_hombro"], p["punta_nalga"]) * LADO_MARCADOR_CM / lado_px
    assert abs(largo_v0 / 140 - 1) > 0.05
    assert abs(m["largo_corporal_cm"] / 140 - 1) < abs(largo_v0 / 140 - 1) / 2


def test_marcador_demasiado_escorzado_responde_422():
    h = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.6e-2, 0.0, 1.0]])
    r = client.post(URL, json=_vista_en_perspectiva(h))
    assert r.status_code == 422
    assert "inclinado" in r.json()["detail"] or "marcador" in r.json()["detail"]


def test_perimetro_con_cinta_reduce_la_incertidumbre():
    sin = client.post(URL, json=_cuerpo_aruco()).json()
    con = client.post(URL, json=_cuerpo_aruco(perimetro_toracico_cm=180)).json()

    largo = con["muestra"]["largo_corporal_cm"]
    assert con["peso_estimado_kg"] == pytest.approx(float(z.peso_schaeffer_kg(180, largo)), abs=0.2)
    assert con["muestra"]["perimetro_medido"] is True
    assert con["muestra"]["relacion_ancho_profundidad_supuesta"] is None
    fuentes = {c["fuente"] for c in con["incertidumbre"]["contribuciones"]}
    assert "cinta" in fuentes and "relacion_ancho" not in fuentes
    assert con["incertidumbre"]["desviacion_log"] < sin["incertidumbre"]["desviacion_log"]
    ancho_con = con["rango_max_kg"] / con["rango_min_kg"]
    ancho_sin = sin["rango_max_kg"] / sin["rango_min_kg"]
    assert ancho_con < ancho_sin


def test_intervalo_del_modelo_solo_coincide_con_la_teoria_lognormal():
    # Con cinta y marcado casi perfecto, el intervalo lo fija sigma_modelo = 0.10:
    # al 90 %, exp(±1.645 * 0.10) ≈ [0.848, 1.179] alrededor del central.
    d = client.post(URL, json=_cuerpo_aruco(perimetro_toracico_cm=180, incertidumbre_punto_px=0.5)).json()
    c = d["peso_estimado_kg"]
    assert d["rango_min_kg"] / c == pytest.approx(math.exp(-1.645 * 0.10), abs=0.015)
    assert d["rango_max_kg"] / c == pytest.approx(math.exp(1.645 * 0.10), abs=0.015)


def test_calibracion_por_referencia_sin_imagen():
    r = client.post(URL, json=_cuerpo_referencia())
    assert r.status_code == 200, r.text
    d = r.json()
    m = d["muestra"]
    assert m["rectificacion"] == "ESCALA"
    assert m["cm_por_pixel"] == pytest.approx(0.2)
    assert m["largo_corporal_cm"] == pytest.approx(140)
    assert m["lado_marcador_px"] is None
    assert {c["codigo"]: c["estado"] for c in d["calidad"]}["NITIDEZ"] == "NO_EVALUADO"
    assert "referencia" in {c["fuente"] for c in d["incertidumbre"]["contribuciones"]}


def test_controles_de_calidad_detectan_foto_movida_y_puntos_invertidos():
    nitida = client.post(URL, json=_cuerpo_aruco()).json()
    assert {c["codigo"]: c["estado"] for c in nitida["calidad"]}["NITIDEZ"] == "OK"

    lienzo = _lienzo([(7, 50, 50)])
    lienzo[230:620, 280:1020] = cv2.GaussianBlur(lienzo[230:620, 280:1020], (0, 0), 6)
    movida = client.post(URL, json={**_cuerpo_aruco(), "imagen_base64": _png_b64(lienzo)}).json()
    estados = {c["codigo"]: c["estado"] for c in movida["calidad"]}
    assert estados["NITIDEZ"] == "ADVERTENCIA"
    assert any("NITIDEZ" in a for a in movida["advertencias"])

    invertidos = {**PUNTOS, "cruz": [400, 600], "pecho_inferior": [400, 250]}
    d = client.post(URL, json=_cuerpo_aruco(puntos=invertidos)).json()
    assert {c["codigo"]: c["estado"] for c in d["calidad"]}["ORIENTACION"] == "ADVERTENCIA"


def test_sin_marcador_responde_422():
    cuerpo = _cuerpo_aruco()
    cuerpo["imagen_base64"] = _imagen([])
    r = client.post(URL, json=cuerpo)
    assert r.status_code == 422
    assert "marcador" in r.json()["detail"]


def test_dos_marcadores_sin_id_responde_422_y_con_id_funciona():
    cuerpo = _cuerpo_aruco()
    cuerpo["imagen_base64"] = _imagen([(7, 50, 50), (3, 1050, 650)])
    assert client.post(URL, json=cuerpo).status_code == 422

    cuerpo["calibracion"]["marcador_id"] = 7
    r = client.post(URL, json=cuerpo)
    assert r.status_code == 200, r.text


def test_medidas_implausibles_responden_422():
    cuerpo = _cuerpo_aruco()
    cuerpo["calibracion"]["lado_cm"] = 80
    r = client.post(URL, json=cuerpo)
    assert r.status_code == 422
    assert "fuera del rango plausible" in r.json()["detail"]


def test_punto_fuera_de_la_imagen_responde_422():
    cuerpo = _cuerpo_aruco()
    cuerpo["puntos"] = {**PUNTOS, "punta_nalga": [5000, 400]}
    r = client.post(URL, json=cuerpo)
    assert r.status_code == 422
    assert "fuera de la imagen" in r.json()["detail"]


def test_aruco_sin_imagen_es_rechazado_por_validacion():
    cuerpo = _cuerpo_aruco()
    del cuerpo["imagen_base64"]
    assert client.post(URL, json=cuerpo).status_code == 422


def test_base64_invalido_responde_422():
    cuerpo = _cuerpo_aruco()
    cuerpo["imagen_base64"] = "esto-no-es-base64!!"
    assert client.post(URL, json=cuerpo).status_code == 422


def test_campos_desconocidos_son_rechazados():
    assert client.post(URL, json=_cuerpo_aruco(precio_por_kg=10)).status_code == 422


# ---------------------------------------------------------------------------
# Varias vistas
# ---------------------------------------------------------------------------

def test_dos_vistas_consistentes_estrechan_solo_el_error_por_vista():
    una = client.post(URL, json=_cuerpo_referencia(incertidumbre_punto_px=15)).json()
    r = client.post(URL_MULTI, json={"vistas": [_cuerpo_referencia(incertidumbre_punto_px=15)] * 2})
    assert r.status_code == 200, r.text
    d = r.json()

    assert d["heterogeneidad"]["consistente"] is True
    assert d["peso_estimado_kg"] == pytest.approx(una["peso_estimado_kg"], abs=0.1)
    assert [v["ponderacion"] for v in d["vistas"]] == pytest.approx([0.5, 0.5])
    assert d["incertidumbre"]["desviacion_log"] < una["incertidumbre"]["desviacion_log"]
    # El error común (ancho supuesto + modelo) no baja al promediar: el piso se mantiene.
    piso = math.sqrt(z.PARAMETROS_VIGENTES.sigma_modelo_log**2)
    assert d["incertidumbre"]["desviacion_log"] > piso
    assert d["es_vinculante"] is False


def test_vistas_discrepantes_amplian_el_rango_y_advierten():
    r = client.post(URL_MULTI, json={"vistas": [_cuerpo_referencia(100.0), _cuerpo_referencia(125.0)]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["heterogeneidad"]["consistente"] is False
    assert d["heterogeneidad"]["factor_inflacion"] > 1
    assert any("discrepan" in a for a in d["advertencias"])


def test_multivista_rechaza_perimetros_distintos_y_una_sola_vista():
    vistas = [_cuerpo_referencia(perimetro_toracico_cm=180), _cuerpo_referencia(perimetro_toracico_cm=190)]
    assert client.post(URL_MULTI, json={"vistas": vistas}).status_code == 422
    assert client.post(URL_MULTI, json={"vistas": [_cuerpo_referencia()]}).status_code == 422


def test_multivista_indica_que_vista_fallo():
    mala = _cuerpo_referencia()
    mala["calibracion"]["distancia_cm"] = 400  # animal de 5,6 m
    r = client.post(URL_MULTI, json={"vistas": [_cuerpo_referencia(), mala]})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("Vista 1:")


def test_cobertura_empirica_del_intervalo_cerca_del_90_por_ciento():
    """
    Validación de la propagación: animales sintéticos cuya verdad sigue los mismos
    supuestos del modelo. Si el Monte Carlo está bien hecho, ~90 % de los pesos reales
    caen dentro del intervalo del 90 %. (No valida los supuestos: eso exige balanza.)
    """
    from dataclasses import replace

    from peso import EstimacionPesoInput, estimar_peso

    params = replace(z.PARAMETROS_VIGENTES, n_simulaciones=1500)
    rng = np.random.default_rng(42)
    sigma_px, casos, dentro = 4.0, 120, 0
    for _ in range(casos):
        largo_px, prof_px = rng.uniform(560, 800), rng.uniform(300, 400)
        verdad = np.array([[300, 400], [300 + largo_px, 400], [400, 250], [400, 250 + prof_px]])
        relacion = rng.uniform(*params.relacion_ancho_rango)
        cm_px = 0.2
        real = float(z.peso_schaeffer_kg(z.perimetro_elipse_cm(prof_px * cm_px, relacion), largo_px * cm_px))
        real *= float(np.exp(rng.normal(0, params.sigma_modelo_log)))
        marcados = verdad + rng.normal(0, sigma_px, verdad.shape)
        ref = np.array([[100, 700], [600, 700]]) + rng.normal(0, sigma_px, (2, 2))
        payload = EstimacionPesoInput.model_validate({
            "puntos": dict(zip(ORDEN, marcados.tolist())),
            "calibracion": {"tipo": "REFERENCIA", "punto_a": ref[0].tolist(), "punto_b": ref[1].tolist(),
                            "distancia_cm": 100.0 * (1 + rng.normal(0, params.sigma_referencia_relativo))},
            "incertidumbre_punto_px": sigma_px,
        })
        r = estimar_peso(payload, params)
        dentro += r.rango_min_kg <= real <= r.rango_max_kg
    assert 0.80 <= dentro / casos <= 0.97, dentro / casos


# ---------------------------------------------------------------------------
# Límites de recursos
# ---------------------------------------------------------------------------

def test_cabecera_jpeg_y_png_se_leen_sin_decodificar():
    from peso import dimensiones_cabecera

    img = np.zeros((321, 654, 3), dtype=np.uint8)
    for ext in (".png", ".jpg"):
        ok, buf = cv2.imencode(ext, img)
        assert ok
        assert dimensiones_cabecera(buf.tobytes()) == (654, 321)
    assert dimensiones_cabecera(b"GIF89a....") is None


def test_bomba_de_descompresion_se_rechaza_por_cabecera_con_413():
    ok, buf = cv2.imencode(".png", np.zeros((10, 10, 3), dtype=np.uint8))
    raw = bytearray(buf.tobytes())
    raw[16:24] = (60000).to_bytes(4, "big") + (60000).to_bytes(4, "big")  # IHDR falsificado
    cuerpo = {**_cuerpo_aruco(), "imagen_base64": base64.b64encode(bytes(raw)).decode()}
    r = client.post(URL, json=cuerpo)
    assert r.status_code == 413


def test_cuerpo_demasiado_grande_se_rechaza_antes_de_parsear():
    import main

    r = client.post(URL, content=b"x" * (main.MAX_CUERPO_PESO_BYTES + 1),
                    headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_sin_turno_disponible_responde_503(monkeypatch):
    import threading

    import main

    monkeypatch.setattr(main, "_turnos_peso", threading.BoundedSemaphore(1))
    monkeypatch.setattr(main, "ESPERA_TURNO_SEGUNDOS", 0.01)
    main._turnos_peso.acquire()
    try:
        assert client.post(URL, json=_cuerpo_referencia()).status_code == 503
    finally:
        main._turnos_peso.release()
    assert client.post(URL, json=_cuerpo_referencia()).status_code == 200


@pytest.mark.parametrize("proyectivo", [2e-5, 5e-5, 1e-4, 2e-4])
def test_con_perspectiva_el_intervalo_contiene_el_peso_frontal(proyectivo):
    """
    Selección por error cuadrático medio: con perspectiva leve gana la similitud (sesgada
    pero estable) y su sesgo entra al intervalo; con perspectiva fuerte, la homografía.
    En todos los casos el peso de la vista frontal (la verdad) debe quedar dentro.
    """
    verdad = client.post(URL, json=_cuerpo_aruco()).json()["peso_estimado_kg"]
    h = np.array([[1.0, 0.0, 40.0], [0.0, 1.0, 30.0], [proyectivo, 0.0, 1.0]])
    d = client.post(URL, json=_vista_en_perspectiva(h)).json()
    assert d["rango_min_kg"] <= verdad <= d["rango_max_kg"]
    if d["muestra"]["rectificacion"] == "SIMILITUD" and d["muestra"]["sesgo_perspectiva_log"] > 0:
        assert "perspectiva" in {c["fuente"] for c in d["incertidumbre"]["contribuciones"]}
