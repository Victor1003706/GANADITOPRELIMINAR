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
    assert client.post(URL, json={"pares": [{"peso_real_kg": 300, "precio": 1}]}).status_code == 422


def test_todos_los_s_iguales_no_rompe_el_ajuste_libre():
    par = {"peso_real_kg": 400, "largo_corporal_cm": 140, "perimetro_cinta_cm": 180}
    pares = [{**par, "peso_real_kg": 400 + i} for i in range(12)]
    r = client.post(URL, json={"pares": pares})
    assert r.status_code == 200, r.text
    f = r.json()["calibracion_formula"]
    assert f["libre"] is None and f["recomendado"] == "solo_escala"


def test_factor_de_escala_muy_pequeno_no_se_redondea_a_cero():
    """Hallazgo #40: round(2.665556e-8, 5) devolvía 0.0. Se prueba la función de ajuste
    directamente: por la API, pesos así de pequeños ya se rechazan por implausibles."""
    factor = 2.665556e-8
    x = np.log(np.linspace(300, 600, 12))
    y = x + np.log(factor)
    ajuste = ev.ajustar_solo_escala(x, y)
    assert ajuste.factor_escala > 0
    assert ajuste.factor_escala == pytest.approx(factor, rel=1e-6)


def test_pares_fisicamente_imposibles_se_rechazan_sin_500():
    """Revisión de #49: perímetros de 1e-150 cm desbordaban exp(a) y daban 500."""
    absurdo = {"peso_real_kg": 400, "largo_corporal_cm": 1e-5, "perimetro_cinta_cm": 1e-150}
    assert client.post(URL, json={"pares": [absurdo] * 12}).status_code == 422
    assert client.post(URL, json={"pares": [{"peso_real_kg": 1e-306, "peso_estimado_kg": 400}] * 3}).status_code == 422


def test_loocv_con_apalancamiento_uno_no_publica_infinito():
    """Hallazgo #40: si toda la variación de S depende de un solo animal, h_ii = 1."""
    base = {"largo_corporal_cm": 140, "perimetro_cinta_cm": 180}
    pares = [{**base, "peso_real_kg": 400 + i} for i in range(11)]
    pares.append({"largo_corporal_cm": 160, "perimetro_cinta_cm": 200, "peso_real_kg": 560})
    r = client.post(URL, json={"pares": pares})
    assert r.status_code == 200, r.text
    f = r.json()["calibracion_formula"]
    assert f["libre"] is None
    assert f["recomendado"] == "solo_escala"
    assert f["solo_escala"]["mape_loocv"] is not None
    assert any("no es evaluable" in a for a in r.json()["advertencias"])
    # Ningún número infinito o NaN en la respuesta.
    assert "Infinity" not in r.text and "NaN" not in r.text


def test_ajuste_libre_devuelve_none_con_apalancamiento_extremo():
    x = np.array([5.0] * 11 + [6.0])
    y = x + np.random.default_rng(1).normal(0, 0.01, 12)
    assert ev.ajustar_libre(x, y) is None


def test_fold_sin_variacion_no_recomienda_el_modelo_libre():
    """Hallazgo #49 (Codex): 39 animales iguales y uno con PT 180.1 daban b=85.8 y MAPE 0."""
    pares = [{"peso_real_kg": 400, "largo_corporal_cm": 140, "perimetro_cinta_cm": 180} for _ in range(39)]
    pares.append({"peso_real_kg": 440, "largo_corporal_cm": 140, "perimetro_cinta_cm": 180.1})
    f = client.post(URL, json={"pares": pares}).json()["calibracion_formula"]
    assert f["libre"] is None
    assert f["recomendado"] == "solo_escala"


def test_exponente_fuera_de_rango_fisico_no_se_propone():
    rng = np.random.default_rng(5)
    x = rng.uniform(5.5, 6.5, 40)
    y = 3.0 * x - 10 + rng.normal(0, 0.01, 40)  # b = 3: físicamente implausible
    assert ev.ajustar_libre(x, y) is None
