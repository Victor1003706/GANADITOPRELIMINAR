import { test, expect, type Page, type Route } from '@playwright/test';
import { fakeToken, installSession, profile } from './fixtures';

const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const lotId = '00000000-0000-4000-8000-000000000010';
const order = {
  id: firstId, lote_id: lotId, codigo_lote: 'LOTE-ORDEN-A', estado: 'PENDIENTE_PAGO',
  monto_adjudicado: 4500, comision_plataforma: 45, total_a_pagar: 4600.25,
  organizacion_compradora_id: 'org-a', organizacion_vendedora_id: 'org-b',
  created_at: '2026-11-04T12:00:00.000Z'
};

// Network fixtures are isolated to this browser suite; the UI and session store are real.
async function changeSession(page: Page, organizationId: string, role: string) {
  await page.evaluate(async ({ token, nextProfile }) => {
    const modulePath = '/src/lib/session.ts';
    const { setSession } = await import(/* @vite-ignore */ modulePath);
    setSession(token, nextProfile.user, nextProfile.activeContext, nextProfile.memberships);
  }, { token: fakeToken(organizationId, role), nextProfile: profile(organizationId, role) });
}

test('lista y detalle muestran los importes del servidor y mantienen el pago desactivado', async ({ page }) => {
  const token = await installSession(page);
  await page.route('**/api/v1/ordenes?**', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    const url = new URL(route.request().url());
    expect(url.searchParams.get('rol')).toBe('comprador');
    expect(url.searchParams.get('limit')).toBe('20');
    await route.fulfill({ json: { data: [order], next_cursor: null } });
  });
  await page.route(`**/api/v1/ordenes/${firstId}`, route => route.fulfill({ json: order }));
  await page.goto('/ordenes');
  await page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` }).click();
  await expect(page).toHaveURL(`/ordenes/${firstId}`);
  await expect(page.getByRole('heading', { name: order.codigo_lote })).toBeVisible();
  await expect(page.getByText('4,500.00')).toBeVisible();
  await expect(page.getByText('45.00', { exact: true })).toBeVisible();
  await expect(page.getByText('4,600.25')).toBeVisible();
  await expect(page.getByText('4,545.00')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pago no disponible' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: order.codigo_lote })).toBeVisible();
});

test('comprador nulo es válido y no se inventa una organización compradora', async ({ page }) => {
  await installSession(page, { organizationId: 'org-b', role: 'VENDEDOR' });
  await page.route(`**/api/v1/ordenes/${firstId}`, route => route.fulfill({ json: { ...order, organizacion_compradora_id: null } }));
  await page.goto(`/ordenes/${firstId}`);
  await expect(page.getByText('Sin organización compradora registrada')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pago no disponible' })).toBeDisabled();
});

test('sin sesión no consulta órdenes privadas', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/v1/ordenes')) requests.push(request.url()); });
  await page.goto('/ordenes');
  await expect(page.getByText('Inicia sesión para consultar tus órdenes.')).toBeVisible();
  await page.goto(`/ordenes/${firstId}`);
  await expect(page.getByText('Inicia sesión para consultar esta orden.')).toBeVisible();
  expect(requests).toEqual([]);
});

test('lista vacía informa únicamente sobre la consulta realizada', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/ordenes?**', route => route.fulfill({ json: { data: [], next_cursor: null } }));
  await page.goto('/ordenes');
  await expect(page.getByText('No se recibieron órdenes en esta consulta.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cargar más órdenes' })).toHaveCount(0);
});

test('403 en lista ofrec