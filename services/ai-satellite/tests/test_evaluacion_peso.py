"""Pruebas de la evaluación contra balanza y de la calibración propuesta."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

import evaluacion_peso as ev
import zoometria as z
from main import app

client = TestClient(app)
URL = "/api/v1/peso/evaluar"


def _muestra_sintetica(n=60, relacion=0.60, factor=1.08, sigma=0.05, semilla=7):
    """Animales sintéticos con verdad conocida: W = factor * Schaeffer * lognormal(sigma)."""
    rng = np.random.default_rng(semilla)
    pares = []
    for _ in range(n):
        largo = rng.uniform(110, 170)
        profundidad = rng.uniform(55, 80)
        r = relacion + rng.normal(0, 0.02)
        perimetro = float(z.perimetro_elipse_cm(profundidad, r))
        real = factor * float(z.peso_schaeffer_kg(perimetro, largo)) * float(np.exp(rng.normal(0, sigma)))
        estimado = float(z.peso_schaeffer_kg(perimetro, largo))  # el estimador sin calibrar
        pares.append({
            "peso_real_kg": real,
            "peso_estimado_kg": estimado,
            "rango_min_kg": estimado * 0.85,
            "rango_max_kg": estimado * 1.15,
            "largo_corporal_cm": largo,
            "profundidad_pecho_cm": profundidad,
            "perimetro_cinta_cm": perimetro,
        })
    return pares


def test_calibracion_recupera_parametros_conocidos():
    r = client.post(URL, json={"pares": _muestra_sintetica()})
    assert r.status_code == 200, r.text
    d = r.json()

    assert d["calibracion_relacion"]["media"] == pytest.approx(0.60, abs=0.01)
    escala = d["calibracion_formula"]["solo_escala"]
    assert escala["factor_escala"] == pytest.approx(1.08, abs=0.03)
    assert escala["sigma_log"] == pytest.approx(0.05, abs=0.015)
    # La calibración mejora el error frente a Schaeffer original (sesgo de -8 %).
    assert escala["mape_loocv"] < d["calibracion_formula"]["mape_schaeffer_original"]

    m = d["metricas"]
    assert m["sesgo_relativo"] == pytest.approx(1 / 1.08 - 1, abs=0.02)
    assert m["bland_altman_limites"][0] < m["bland_altman_factor_medio"] < m["bland_altman_limites"][1]
    assert 0 <= m["cobertura_intervalo"] <= 1

    p = d["propuesta"]
    assert p["aplicado"] is False
    assert p["version_base"] == z.PARAMETROS_VIGENTES.version
    assert p["relacion_ancho_rango"][0] < p["relacion_ancho_central"] < p["relacion_ancho_rango"][1]


def test_loocv_cerrado_coincide_con_reajuste_explicito():
    rng = np.random.default_rng(3)
    x = rng.uniform(5.5, 6.5, 25)
    y = 0.1 + 0.97 * x + rng.normal(0, 0.05, 25)

    libre = ev.ajustar_libre(x, y)
    errores = []
    for i in range(len(x)):
        m = np.ones(len(x), bool)
        m[i] = False
        coef = np.polyfit(x[m], y[m], 1)
        pred = np.polyval(coef, x[i])
        errores.append(abs(np.exp(pred) - np.exp(y[i])) / np.exp(y[i]))
    assert libre.mape_loocv == pytest.approx(np.mean(errores), abs=1e-4)

    escala = ev.ajustar_solo_escala(x, y)
    d = y - x
    explicito = [abs(np.exp(x[i] + np.delete(d, i).mean()) - np.exp(y[i])) / np.exp(y[i]) for i in range(len(x))]
    assert escala.mape_loocv == pytest.approx(np.mean(explicito), abs=1e-4)


def test_pocos_pares_no_proponen_calibracion():
    r = client.post(URL, json={"pares": _muestra_sintetica(n=2)})
    assert r.status_code == 200
    d = r.json()
    assert d["metricas"] is None
    assert d["calibracion_formula"] is None
    assert d["propuesta"]["factor_escala_modelo"] is None
    assert any("al menos" in a for a in d["advertencias"])


def test_cobertura_baja_advierte_incertidumbre_subestimada():
    pares = _muestra_sintetica(n=30)
    for p in pares:
        p["rango_min_kg"] = p["peso_estimado_kg"] * 0.999
        p["rango_max_kg"] = p["peso_estimado_kg"] * 1.001
    d = client.post(URL, json={"pares": pares}).json()
    assert d["metricas"]["cobertura_intervalo"] < 0.5
    assert any("subestimada" in a for a in d["advertencias"])


def test_campos_desconocidos_son_rechazados():
    assert client.post(URL, json={"pares": 