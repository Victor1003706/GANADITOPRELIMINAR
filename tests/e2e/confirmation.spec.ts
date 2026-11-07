import { expect, test } from '@playwright/test';
import { fakeToken, installSession, profile } from './fixtures';

test('registro con HTTP 200 inesperado no establece sesión', async ({ page }) => {
  await page.route('**/api/v1/auth/register', route => route.fulfill({ status: 200,
    json: { access_token: fakeToken(), active_context: profile().activeContext } }));
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: profile() }));
  await page.goto('/acceso');
  await page.getByRole('button', { name: 'Crear una cuenta', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Persona ficticia');
  await page.getByLabel('Nombre de la organización', { exact: true }).fill('Organización ficticia');
  await page.getByLabel('Correo electrónico').fill('status@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('fictional-password');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('confirmación');
  await expect(page).toHaveURL(/\/acceso$/);
  expect(await page.evaluate(() => sessionStorage.getItem('ganadito.session.token'))).toBeNull();
});

test('publicación con HTTP 200 inesperado conserva resultado incierto y evita duplicar', async ({ page }) => {
  await installSession(page, { role: 'VENDEDOR', organizationId: 'org-b' });
  await page.route('**/api/v1/subastas', route => route.fulfill({ status: 200,
    json: { id: 'unexpected-lot', codigo_lote: 'SIN-CONFIRMAR', estado: 'ACTIVO' } }));
  await page.goto('/subastas');
  await page.getByLabel('Precio base del lote completo (S/)').fill('100');
  await page.getByLabel('Incremento mínimo (S/)').fill('10');
  await page.getByLabel('Fecha y hora local de cierre').fill('2099-12-31T18:00');
  await page.getByRole('button', { name: 'Publicar lote', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'resultado de la publicación es incierto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicar lote', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Abrir lote publicado' })).toHaveCount(0);
});

test('puja todavía en proceso conserva la clave al consultar su resultado', async ({ page }) => {
  const lotId = '1b647cf3-4204-437e-96ab-7a0eb96fab1d';
  await installSession(page);
  const closing = new Date(Date.now() + 3600_000).toISOString();
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, route => route.fulfill({ json: {
    id: lotId, codigo_lote: 'PROCESANDO', estado: 'ACTIVO', precio_base: 100, precio_actual: 100,
    incremento_minimo: 10, proxima_puja_minima: 110, postor_ganador_id: null, postor_ganador_nombre: null,
    tiempo_restante_segundos: 3600, fecha_cierre: closing, secuencia_maxima: 0, version: 1, es_abierta: true
  } }));
  await page.routeWebSocket(`**/api/v1/subastas/${lotId}/live?*`, () => {});
  const keys: string[] = [];
  await page.route(`**/api/v1/subastas/${lotId}/pujas`, async route => {
    const key = route.request().headers()['idempotency-key'];
    keys.push(key);
    if (keys.length === 1) await route.fulfill({ status: 409,
      json: { message: 'La misma clave sigue en proceso.', code: 'IDEMPOTENCY_IN_PROGRESS' } });
    else await route.fulfill({ status: 201, json: {
      puja_id: 'confirmed-bid', lote_id: lotId, monto: 110, secuencia: 1, nueva_version: 2,
      nuevo_precio_actual: 110, extension_aplicada: false, nueva_fecha_cierre: closing,
      idempotency_key: key, created_at: new Date().toISOString()
    } });
  });
  await page.goto(`/subastas/${lotId}`);
  await expect(page.getByRole('button', { name: 'Confirmar puja', exact: true })).toBeEnabled();
  await page.getByLabel('Importe de tu puja (S/)').fill('110');
  await page.getByRole('button', { name: 'Confirmar puja', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar puja', exact: true })).toBeDisabled();
  await