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

test('403 en lista ofrece cambiar de contexto y conserva la sesión', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/ordenes?**', route => route.fulfill({ status: 403, json: { code: 'CONTEXTO_INACTIVO', message: 'Contexto inactivo.' } }));
  await page.goto('/ordenes');
  await expect(page.getByRole('alert')).toContainText('Sin acceso');
  await expect(page.getByRole('link', { name: 'Cambiar contexto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page).toHaveURL('/ordenes');
});

test('401 al paginar elimina los datos privados y pide iniciar sesión', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/ordenes?**', route => new URL(route.request().url()).searchParams.has('cursor')
    ? route.fulfill({ status: 401, json: { message: 'Token expirado.' } })
    : route.fulfill({ json: { data: [order], next_cursor: 'opaque-a' } }));
  await page.goto('/ordenes');
  await expect(page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` })).toBeVisible();
  await page.getByRole('button', { name: 'Cargar más órdenes' }).click();
  await expect(page.getByText('Inicia sesión para consultar tus órdenes.')).toBeVisible();
  await expect(page.getByText(order.codigo_lote, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('ganadito.session.token'))).toBeNull();
});

test('403 al paginar retira las órdenes consultadas sin cerrar la sesión', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/ordenes?**', route => new URL(route.request().url()).searchParams.has('cursor')
    ? route.fulfill({ status: 403, json: { code: 'CONTEXTO_INACTIVO', message: 'Membresía inactiva.' } })
    : route.fulfill({ json: { data: [order], next_cursor: 'opaque-a' } }));
  await page.goto('/ordenes');
  await expect(page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` })).toBeVisible();
  await page.getByRole('button', { name: 'Cargar más órdenes' }).click();
  await expect(page.getByRole('alert')).toContainText('Sin acceso');
  await expect(page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cargar más órdenes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});

test('404 de detalle no revela si la orden existe o pertenece a otra organización', async ({ page }) => {
  await installSession(page);
  await page.route(`**/api/v1/ordenes/${firstId}`, route => route.fulfill({ status: 404, json: { message: 'Información que no debe presentarse como existencia confirmada.' } }));
  await page.goto(`/ordenes/${firstId}`);
  await expect(page.getByRole('alert')).toHaveText('Orden no disponible para esta consulta.');
  await expect(page.getByText('Información que no debe presentarse', { exact: false })).toHaveCount(0);
});

test('403 de detalle muestra falta de acceso sin cerrar sesión', async ({ page }) => {
  await installSession(page);
  await page.route(`**/api/v1/ordenes/${firstId}`, route => route.fulfill({ status: 403, json: { message: 'Membresía inactiva.' } }));
  await page.goto(`/ordenes/${firstId}`);
  await expect(page.getByRole('alert')).toContainText('Sin acceso');
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});

test('respuesta de listado mal formada no muestra importes ni datos parciales', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/ordenes?**', route => route.fulfill({ json: { data: [order, { ...order, id: secondId, total_a_pagar: '9000' }], next_cursor: null } }));
  await page.goto('/ordenes');
  await expect(page.getByRole('alert')).toContainText('respuesta válida de órdenes');
  await expect(page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` })).toHaveCount(0);
});

test('detalle de otra referencia se rechaza aunque el resto del DTO sea válido', async ({ page }) => {
  await installSession(page);
  await page.route(`**/api/v1/ordenes/${firstId}`, route => route.fulfill({ json: { ...order, id: secondId } }));
  await page.goto(`/ordenes/${firstId}`);
  await expect(page.getByRole('alert')).toContainText('respuesta válida para esta orden');
  await expect(page.getByText('4,600.25')).toHaveCount(0);
});

test('paginación descarta duplicados y detiene un cursor repetido sin bucle', async ({ page }) => {
  await installSession(page);
  const cursors: (string | null)[] = [];
  await page.route('**/api/v1/ordenes?**', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    cursors.push(cursor);
    await route.fulfill({ json: cursor === null
      ? { data: [order], next_cursor: 'opaque-a' }
      : cursor === 'opaque-a'
        ? { data: [order, { ...order, id: secondId, codigo_lote: 'LOTE-ORDEN-B' }], next_cursor: 'opaque-b' }
        : { data: [order], next_cursor: 'opaque-a' } });
  });
  await page.goto('/ordenes');
  await page.getByRole('button', { name: 'Cargar más órdenes' }).click();
  await expect(page.getByRole('link', { name: 'Ver orden LOTE-ORDEN-B' })).toBeVisible();
  await expect(page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cargar más órdenes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'cursor repetido' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cargar más órdenes' })).toHaveCount(0);
  expect(cursors).toEqual([null, 'opaque-a', 'opaque-b']);
});

test('filtro de lote permite seguir consultando páginas sin coincidencias', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/ordenes?**', async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.has('lote_id')).toBe(false);
    await route.fulfill({ json: url.searchParams.has('cursor')
      ? { data: [order], next_cursor: null }
      : { data: [{ ...order, id: secondId, lote_id: secondId, codigo_lote: 'OTRO-LOTE' }], next_cursor: 'more' } });
  });
  await page.goto(`/ordenes?lote_id=${lotId}`);
  await expect(page.getByText('No hay coincidencias en las páginas consultadas.')).toBeVisible();
  await expect(page.getByText('Hay más páginas por consultar.')).toBeVisible();
  await expect(page.getByText('OTRO-LOTE', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cargar más órdenes' }).click();
  await expect(page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` })).toBeVisible();
});

test('cambiar el filtro de rol descarta la respuesta anterior pendiente', async ({ page }) => {
  await installSession(page);
  let pending: Route | undefined;
  await page.route('**/api/v1/ordenes?**', async route => {
    if (new URL(route.request().url()).searchParams.get('rol') === 'comprador') pending = route;
    else await route.fulfill({ json: { data: [{ ...order, codigo_lote: 'ROL-VENDEDOR' }], next_cursor: null } });
  });
  await page.goto('/ordenes');
  await expect.poll(() => !!pending).toBe(true);
  await page.getByLabel('Ver órdenes como').selectOption('vendedor');
  await expect(page.getByRole('link', { name: 'Ver orden ROL-VENDEDOR' })).toBeVisible();
  await pending!.fulfill({ json: { data: [order], next_cursor: null } });
  await expect(page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` })).toHaveCount(0);
});

test('cambiar token organización y rol vacía datos previos y cancela su página pendiente', async ({ page }) => {
  const initialToken = await installSession(page);
  let pending: Route | undefined;
  await page.route('**/api/v1/ordenes?**', async route => {
    const request = route.request();
    if (request.headers().authorization !== `Bearer ${initialToken}`) {
      expect(new URL(request.url()).searchParams.get('rol')).toBe('vendedor');
      await route.fulfill({ json: { data: [{ ...order, id: secondId, codigo_lote: 'ORG-B-PRIVADA' }], next_cursor: null } });
    } else if (new URL(request.url()).searchParams.has('cursor')) pending = route;
    else await route.fulfill({ json: { data: [order], next_cursor: 'pending' } });
  });
  await page.goto('/ordenes');
  await page.getByRole('button', { name: 'Cargar más órdenes' }).click();
  await expect.poll(() => !!pending).toBe(true);
  await changeSession(page, 'org-b', 'VENDEDOR');
  await expect(page.getByRole('link', { name: 'Ver orden ORG-B-PRIVADA' })).toBeVisible();
  await expect(page.getByRole('link', { name: `Ver orden ${order.codigo_lote}` })).toHaveCount(0);
  await pending!.fulfill({ json: { data: [{ ...order, codigo_lote: 'RESPUESTA-ANTERIOR' }], next_cursor: null } });
  await expect(page.getByText('RESPUESTA-ANTERIOR', { exact: true })).toHaveCount(0);
});

test('cerrar sesión durante el detalle pendiente impide mostrar su respuesta', async ({ page }) => {
  await installSession(page);
  let pending: Route | undefined;
  await page.route(`**/api/v1/ordenes/${firstId}`, route => { pending = route; });
  await page.goto(`/ordenes/${firstId}`);
  await expect.poll(() => !!pending).toBe(true);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByText('Inicia sesión para consultar esta orden.')).toBeVisible();
  await pending!.fulfill({ json: order });
  await expect(page.getByRole('heading', { name: order.codigo_lote })).toHaveCount(0);
});

test('cambiar contexto en el detalle retira los importes mientras consulta el nuevo contexto', async ({ page }) => {
  const initialToken = await installSession(page);
  let pending: Route | undefined;
  await page.route(`**/api/v1/ordenes/${firstId}`, async route => {
    if (route.request().headers().authorization === `Bearer ${initialToken}`) await route.fulfill({ json: order });
    else pending = route;
  });
  await page.goto(`/ordenes/${firstId}`);
  await expect(page.getByRole('heading', { name: order.codigo_lote })).toBeVisible();
  await changeSession(page, 'org-b', 'VENDEDOR');
  await expect.poll(() => !!pending).toBe(true);
  await expect(page.getByText('4,600.25')).toHaveCount(0);
  await expect(page.getByText('Consultando orden…')).toBeVisible();
  await pending!.fulfill({ status: 404, json: { message: 'No encontrada.' } });
  await expect(page.getByRole('alert')).toHaveText('Orden no disponible para esta consulta.');
});

test('navegar a otro id descarta el detalle pendiente de la ruta anterior', async ({ page }) => {
  await installSession(page);
  let pending: Route | undefined;
  await page.route(`**/api/v1/ordenes/${firstId}`, route => { pending = route; });
  await page.route(`**/api/v1/ordenes/${secondId}`, route => route.fulfill({ json: { ...order, id: secondId, codigo_lote: 'SEGUNDA-REFERENCIA' } }));
  await page.goto(`/ordenes/${firstId}`);
  await expect.poll(() => !!pending).toBe(true);
  // A native link exercises SvelteKit client navigation while retaining the route component.
  await page.evaluate(id => {
    const link = document.createElement('a');
    link.href = `/ordenes/${id}`;
    link.textContent = 'Consultar otra referencia';
    document.querySelector('main')!.append(link);
  }, secondId);
  await page.getByRole('link', { name: 'Consultar otra referencia' }).click();
  await expect(page).toHaveURL(`/ordenes/${secondId}`);
  await expect(page.getByRole('heading', { name: 'SEGUNDA-REFERENCIA' })).toBeVisible();
  await pending!.fulfill({ json: order });
  await expect(page.getByRole('heading', { name: order.codigo_lote })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'SEGUNDA-REFERENCIA' })).toBeVisible();
});
