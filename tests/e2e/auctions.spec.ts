import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { installSession } from './fixtures';

const lotId = '1b647cf3-4204-437e-96ab-7a0eb96fab1d';
const httpPolling = process.env.E2E_HTTP_POLLING === 'true';
test.beforeEach(({}, testInfo) => {
  test.skip(httpPolling !== testInfo.title.startsWith('HTTP polling'), 'Run HTTP polling separately with E2E_HTTP_POLLING=true.');
});

function liveBid(sequence: number, overrides: Record<string, unknown> = {}) {
  return { event_type: 'PUJA_ACEPTADA', lote_id: lotId, data: { puja_id: `bid-${sequence}`,
    monto: 100 + sequence * 10, secuencia: sequence, nueva_version: sequence + 1,
    nuevo_precio_actual: 100 + sequence * 10, extension_aplicada: false,
    nueva_fecha_cierre: '2099-12-31T23:00:00.000Z', created_at: '2026-11-04T12:00:00.000Z', ...overrides } };
}
function snapshot(overrides: Record<string, unknown> = {}) {
  return { id: lotId, codigo_lote: 'LOTE-PRUEBA-101', estado: 'ACTIVO', precio_base: 100,
    precio_actual: 100, incremento_minimo: 10, proxima_puja_minima: 110,
    postor_ganador_id: null, postor_ganador_nombre: null, tiempo_restante_segundos: 3600,
    fecha_cierre: new Date(Date.now() + 3600_000).toISOString(), secuencia_maxima: 0,
    version: 1, es_abierta: true, ...overrides };
}

async function room(page: Page, official: () => Record<string, unknown>) {
  const sockets: WebSocketRoute[] = [];
  const requested: string[] = [];
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, async route => {
    requested.push(route.request().url());
    await route.fulfill({ json: official() });
  });
  await page.routeWebSocket(`**/api/v1/subastas/${lotId}/live?*`, socket => { sockets.push(socket); });
  await page.goto(`/subastas/${lotId}`);
  await expect(page.getByRole('heading', { name: 'Sala de subasta' })).toBeVisible();
  return { sockets, requested };
}

test('publication waits for the server and opens only the confirmed lot', async ({ page }) => {
  await installSession(page, { role: 'VENDEDOR', organizationId: 'org-b' });
  let submitted: Record<string, unknown> | undefined;
  let confirm: (() => Promise<void>) | undefined;
  await page.route('**/api/v1/subastas', async route => {
    submitted = route.request().postDataJSON();
    await new Promise<void>(resolve => { confirm = async () => { await route.fulfill({ status: 201, json: { id: lotId, codigo_lote: 'NUEVO-101', estado: 'ACTIVO' } }); resolve(); }; });
  });
  await page.goto('/subastas');
  await page.getByLabel('Código del lote (opcional)').fill('NUEVO-101');
  await page.getByLabel('Precio base del lote completo (S/)').fill('100');
  await page.getByLabel('Incremento mínimo (S/)').fill('10');
  await page.getByLabel('Fecha y hora local de cierre').fill('2099-12-31T18:00');
  await page.getByRole('button', { name: 'Publicar lote' }).click();
  await expect(page.getByRole('button', { name: 'Esperando confirmación…' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Abrir lote publicado' })).toHaveCount(0);
  await expect.poll(() => !!confirm).toBeTruthy();
  expect(submitted).toMatchObject({ codigo_lote: 'NUEVO-101', precio_base: 100, incremento_minimo: 10, estado: 'ACTIVO' });
  expect(submitted).not.toHaveProperty('organizacion_id');
  await confirm!();
  await expect(page.getByRole('link', { name: 'Abrir lote publicado' })).toHaveAttribute('href', `/subastas/${lotId}`);
});

test('the requested lot loads its official snapshot without demo substitutions', async ({ page }) => {
  const { requested } = await room(page, () => snapshot());
  await expect(page.getByRole('heading', { name: 'LOTE-PRUEBA-101' })).toBeVisible();
  await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 100.00', { exact: true })).toHaveCount(2);
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.every(url => new URL(url).pathname === `/api/v1/subastas/${lotId}/snapshot`)).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Co