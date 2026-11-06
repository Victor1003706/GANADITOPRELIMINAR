"""Pruebas del núcleo numérico: homografía por lotes, elipse, Schaeffer y combinación de vistas."""

import math

import cv2
import numpy as np
import pytest

import zoometria as z


def test_schaeffer_metrica_coincide_con_formula_imperial():
    perimetro_in, largo_in = 200 / 2.54, 150 / 2.54
    esperado_kg = perimetro_in**2 * largo_in / 300 * 0.45359237
    assert float(z.peso_schaeffer_kg(200, 150)) == pytest.approx(esperado_kg, rel=1e-9)


def test_modelo_sin_calibrar_es_schaeffer_original():
    assert float(z.peso_modelo_kg(180, 140, z.PARAMETROS_VIGENTES)) == pytest.approx(float(z.peso_schaeffer_kg(180, 140)))


def test_dlt_por_lotes_coincide_con_opencv():
    rng = np.random.default_rng(1)
    origen = np.array([[0, 0], [100, 0], [100, 100], [0, 100]], dtype=float) + rng.normal(0, 8, (20, 4, 2))
    destino = z.cuadrado_metrico(np.full(20, 20.0))
    h = z.homografias_dlt(origen, destino)
    for i in range(20):
        ref = cv2.getPerspectiveTransform(origen[i].astype(np.float32), destino[i].astype(np.float32))
        assert h[i] == pytest.approx(ref, rel=1e-4, abs=1e-6)
    # Las esquinas de origen caen exactamente en el cuadrado métrico.
    assert z.aplicar_homografias(h, origen) == pytest.approx(destino, abs=1e-8)


def test_relacion_desde_perimetro_invierte_la_elipse():
    for relacion in (0.5, 0.65, 0.8):
        perimetro = float(z.perimetro_elipse_cm(70, relacion))
        assert z.relacion_desde_perimetro(70, perimetro) == pytest.approx(relacion, abs=1e-9)
    assert z.relacion_desde_perimetro(70, 5000) is None


def test_elipse_circular_es_pi_por_diametro():
    assert float(z.perimetro_elipse_cm(60, 1.0)) == pytest.approx(math.pi * 60, rel=1e-12)


def test_combinar_vistas_pondera_por_inversa_de_varianza_y_detecta_discrepancia():
    c = z.combinar_vistas(np.log([400.0, 410.0]), np.array([0.01, 0.04]))
    assert c.pesos == pytest.approx([0.8, 0.2])
    assert c.consistente and c.factor_inflacion == 1.0

    discrepante = z.combinar_vistas(np.log([300.0, 450.0]), np.array([0.0004, 0.0004]))
    assert not discrepante.consistente
    assert discrepante.factor_inflacion == pytest.approx(discrepante.q / discrepante.gl)
