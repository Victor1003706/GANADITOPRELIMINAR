import { test, expect, type Page } from '@playwright/test';
import { fakeToken, installSession, profile } from './fixtures';

async function blockMapTiles(page: Page) {
  await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
}

const establecimiento = {
  id: 'est-publico', nombre_comercial: 'Establo ajeno', tipo: 'ESTABLO',
  latitud: -12.04, longitud: -77.03, direccion_texto: null, distancia_km: 1.5,
  ubicacion_aproximada: true
};
const cotizacion = {
  id: 'spot-publico', establecimiento_id: 'est-publico', establecimiento_nombre: 'Establo ajeno',
  producto: 'GANADO_EN_PIE', categoria: 'TORETE', calidad: 'PRIMERA', precio_unitario: 7.5,
  moneda: 'PEN', unidad_medida: 'KG', procedencia_ubigeo: '150101',
  vigencia_hasta: '2030-01-01T00:00:00Z', verificado: false,
  latitud: -12.04, longitud: -77.03, ubicacion_aproximada: true
};
function pasaporte(vista: 'PUBLICA' | 'COMPLETA', id: string, organizacionId: string | null = vista === 'COMPLETA' ? 'org-a' : null) {
  return {
    vista,
    bovino: { id, codigo_arete: 'ARETE-' + id, organizacion_id: organizacionId, raza: null, sexo: 'MACHO', fecha_nacimiento: null, estado: 'VIVO' },
    eventos: [{ id: 1, bovino_id: id, secuencia: 1, event_type: 'PESAJE', metadata: { peso_kg: 420 },
      autor_id: vista === 'COMPLETA' ? 'user-a' : null, created_at: '2026-01-01T00:00:00Z',
      ...(vista === 'COMPLETA' ? { prev_hash: '0'.repeat(64), current_hash: 'a'.repeat(64) } : {}) }]
  };
}

test('V05 la posición ajena se presenta como área aproximada en mapa, lista, popup y Spot', async ({ page }) => {
  await blockMapTiles(page);
  await page.route('**/api/v1/establecimientos/cercanos?**', route => route.fulfill({ json: { establecimientos: [establecimiento,
    { ...establecimiento, id: 'est-propio', nombre_comercial: 'Establo propio', ubicacion_aproximada: false, direccion_texto: 'Dirección propia' }
  ] } }));
  await page.route('**/api/v1/cotizaciones/pizarra?**', route => route.fulfill({ json: { cotizaciones: [cotizacion] } }));
  await page.goto('/');
  const mapa = page.getByRole('region', { name: 'Mapa de establecimientos' });
  const ajeno = mapa.getByRole('button').filter({ hasText: 'Establo ajeno' });
  await expect(ajeno).toContainText('Ubicación aproximada');
  await expect(ajeno).toContainText('Distancia aproximada: 1.5 km');
  await expect(mapa.getByRole('button').filter({ hasText: 'Establo propio' })).toContainText('Ubicación exacta');
  await expect(page.getByRole('region', { name: 'Pizarra Spot' }).getByRole('listitem')).toContainText('Ubicación aproximada');
  await mapa.getByRole('button').filter({ hasText: 'Establo propio' }).click();
  await expect(page.locator('.leaflet-popup-content')).toContainText('Dirección propia');
  await ajeno.click();
  // Private content must leave the DOM immediately, including Leaflet transitions.
  expect(await page.locator('.leaflet-popup-content').count()).toBe(1);
  const area = page.locator('path.ubicacion-aproximada');
  await expect(area).toHaveCount(1);
  await expect(area).toHaveAttribute('stroke-dasharray', /.+/);
  await expect(area).toHaveAttribute('fill-opacity', '0.15');
  await expect(page.locator('path.ubicacion-exacta')).toHaveCount(1);
  await expect(page.locator('.leaflet-popup-content')).toHaveCount(1);
  await expect(page.locator('.leaflet-popup-content')).toContainText('Ubicación aproximada');
  await expect(page.locator('.leaflet-popup-content')).toContainText('Distancia aproximada: 1.5 km');
  // At a close zoom the 800 m privacy area would occupy hundreds of pixels.
  expect((await area.boundingBox())!.width).toBeLessThan(60);
  await page.getByRole('region', { name: 'Pizarra Spot' }).getByRole('listitem').getByRole('button').click();
  expect((await area.boundingBox())!.width).toBeLessThan(60);
});

for (const flag of [undefined, null, 'false', 0]) {
  test(`V05 rechaza ubicación sin precisión booleana (${String(flag)}) en mapa y Spot`, async ({ page }) => {
    await block