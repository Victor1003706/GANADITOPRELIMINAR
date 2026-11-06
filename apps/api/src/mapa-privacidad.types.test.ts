import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EstablecimientoCercanoResponse, EstablecimientoResponse } from './mapa/mapa.types.js';

// El typecheck debe admitir la respuesta HTTP pública real sin debilitar el DTO
// privado que devuelve la creación de un establecimiento.
const direccionPublica: Pick<EstablecimientoCercanoResponse, 'direccion_texto' | 'ubicacion_aproximada'> = {
  direccion_texto: null,
  ubicacion_aproximada: true
};
// @ts-expect-error El DTO privado de creación conserva una dirección obligatoria.
const direccionPrivadaInvalida: Pick<EstablecimientoResponse, 'direccion_texto'> = { direccion_texto: null };

test('V05: la lectura pública admite dirección nula y exige indicar aproximación', () => {
  assert.equal(direccionPublica.direccion_texto, null);
  assert.equal(direccionPublica.ubicacion_aproximada, true);
  void direccionPrivadaInvalida;
});
