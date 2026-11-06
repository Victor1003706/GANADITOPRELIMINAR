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
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeDisabled();
});

for (const revisit of [false, true]) test(`a late bid receipt from a disposed panel is ignored${revisit ? ' after returning to its lot' : ' in another lot'}`, async ({ page }) => {
  await installSession(page);
  const nextLot = 'ca5f2fd1-4761-4d64-a20a-b7ae89199b6c';
  let pending: import('@playwright/test').Route | undefined;
  await page.route(`**/api/v1/subastas/${lotId}/pujas`, route => { pending = route; });
  await page.route(`**/api/v1/subastas/${nextLot}/snapshot`, route => route.fulfill({ json: snapshot({ id: nextLot, codigo_lote: 'OTRO-LOTE', precio_actual: 500, precio_base: 500, proxima_puja_minima: 510 }) }));
  await page.routeWebSocket(`**/api/v1/subastas/${nextLot}/live?*`, () => {});
  await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja', exact: true })).toBeEnabled();
  await page.getByLabel('Importe de tu puja (S/)').fill('110');
  await page.getByRole('button', { name: 'Confirmar puja', exact: true }).click();
  await expect.poll(() => !!pending).toBe(true);
  // Client-side navigation reuses the route component; a full reload hides this race.
  await page.evaluate(path => {
    const link = document.createElement('a'); link.href = path; link.textContent = 'Otro lote';
    document.body.append(link); link.click();
  }, `/subastas/${nextLot}`);
  await expect(page.getByRole('heading', { name: 'OTRO-LOTE', exact: true })).toBeVisible();
  if (revisit) {
    await page.evaluate(path => {
      const link = document.createElement('a'); link.href = path; link.textContent = 'Regresar al lote';
      document.body.append(link); link.click();
    }, `/subastas/${lotId}`);
    await expect(page.getByRole('heading', { name: 'LOTE-PRUEBA-101', exact: true })).toBeVisible();
  }
  const key = pending!.request().headers()['idempotency-key'];
  const delivered = page.waitForResponse(response => response.url().endsWith(`/${lotId}/pujas`));
  await pending!.fulfill({ status: 201, json: { ...liveBid(1).data, lote_id: lotId, idempotency_key: key } });
  // Flush receipt delivery and the component's completion callback before asserting.
  expect(await (await delivered).finished()).toBeNull();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText('Secuencia 1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: revisit ? 'LOTE-PRUEBA-101' : 'OTRO-LOTE', exact: true })).toBeVisible();
});

test('missing and incomplete lots expose errors and never display a sample lot', async ({ page }) => {
  await page.route('**/api/v1/subastas/missing/snapshot', route => route.fulfill({ status: 404, json: { message: 'Lote no encontrado.' } }));
  await page.routeWebSocket('**/api/v1/subastas/*/live', () => {});
  await page.goto('/subastas/missing');
  await expect(page.getByRole('alert')).toContainText('Lote no encontrado.');
  await expect(page.getByLabel('Estado oficial del lote')).toHaveCount(0);
  await room(page, () => ({}));
  await expect(page.getByRole('alert')).toContainText('respuesta de la API');
  await expect(page.getByLabel('Estado oficial del lote')).toHaveCount(0);
});

test('a rejected server bid is never presented as a successful bid', async ({ page }) => {
  await installSession(page);
  await page.route(`**/api/v1/subastas/${lotId}/pujas`, route => route.fulfill({ status: 409, json: { message: 'La puja fue superada por otro postor.' } }));
  await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  await page.getByLabel('Importe de tu puja (S/)').fill('110');
  await page.getByRole('button', { name: 'Confirmar puja' }).click();
  await expect(page.getByRole('alert')).toContainText('superada');
  await expect(page.getByText(/El servidor confirmó tu puja/)).toHaveCount(0);
  await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 100.00', { exact: true })).toHaveCount(2);
});

test('a valid bid body with HTTP 200 never confirms acceptance and keeps the original retry key', async ({ page }) => {
  await installSession(page);
  const keys: string[] = [];
  await page.route(`**/api/v1/subastas/${lotId}/pujas`, async route => {
    const body = route.request().postDataJSON();
    keys.push(route.request().headers()['idempotency-key']);
    await route.fulfill({ status: 200, json: { ...liveBid(1).data, lote_id: lotId, idempotency_key: body.idempotency_key } });
  });
  await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  await page.getByLabel('Importe de tu puja (S/)').fill('110');
  await page.getByRole('button', { name: 'Confirmar puja' }).click();
  const retry = page.getByRole('button', { name: 'Reintentar la misma puja' });
  await expect(retry).toBeEnabled();
  await expect(page.getByText(/El servidor confirmó tu puja/)).toHaveCount(0);
  await retry.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(page.getByText(/El servidor confirmó tu puja/)).toHaveCount(0);
});

test('an uncertain bid retries the same amount and key; a new intention gets a new key', async ({ page }) => {
  await installSession(page);
  let price = 100;
  let sequence = 0;
  const attempts: { amount: number; key: string }[] = [];
  await page.route(`**/api/v1/subastas/${lotId}/pujas`, async route => {
    const body = route.request().postDataJSON();
    attempts.push({ amount: body.monto, key: route.request().headers()['idempotency-key'] });
    if (attempts.length === 1) return route.abort('failed');
    price = body.monto;
    sequence += 1;
    await route.fulfill({ status: 201, json: { puja_id: `bid-${sequence}`, lote_id: lotId,
      monto: body.monto, secuencia: sequence, nueva_version: sequence + 1,
      nuevo_precio_actual: price, extension_aplicada: false,
      nueva_fecha_cierre: new Date(Date.now() + 3600_000).toISOString(),
      idempotency_key: body.idempotency_key, created_at: new Date().toISOString() } });
  });
  await room(page, () => snapshot({ precio_actual: price, proxima_puja_minima: price + 10, secuencia_maxima: sequence, version: sequence + 1 }));
  await page.getByLabel('Importe de tu puja (S/)').fill('110');
  await page.getByRole('button', { name: 'Confirmar puja' }).click();
  await expect(page.getByRole('button', { name: 'Reintentar la misma puja' })).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar la misma puja' }).click();
  await expect(page.getByText(/El servidor confirmó tu puja de S\/ 110.00/)).toBeVisible();
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 110.00', { exact: true })).toBeVisible();
  await page.getByLabel('Importe de tu puja (S/)').fill('120');
  await page.getByRole('button', { name: 'Confirmar puja' }).click();
  await expect(page.getByText(/El servidor confirmó tu puja de S\/ 120.00/)).toBeVisible();
  expect(attempts[2].key).not.toBe(attempts[0].key);
  expect(attempts[2].amount).toBe(120);
});

test('reconnection restores the official snapshot; the local clock does not adjudicate', async ({ page }) => {
  await installSession(page);
  let official = snapshot({ tiempo_restante_segundos: 0, es_abierta: false });
  const { sockets, requested } = await room(page, () => official);
  await expect(page.getByText('Esperando la confirmación del cierre por el servidor.')).toBeVisible();
  await expect(page.getByLabel('Estado oficial del lote').getByText('ACTIVO', { exact: true })).toBeVisible();
  await expect(page.getByText('ADJUDICADO', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'En Vivo' })).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThanOrEqual(1);
  const baseline = sockets.length;
  const currentSocket = sockets.at(-1)!;
  const before = requested.length;
  official = snapshot({ precio_actual: 140, proxima_puja_minima: 150, version: 5, secuencia_maxima: 4 });
  await currentSocket.close({ code: 1012, reason: 'Prueba de reconexión' });
  await expect.poll(() => sockets.length, { timeout: 10000 }).toBeGreaterThan(baseline);
  await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 140.00', { exact: true })).toBeVisible();
  expect(requested.length).toBeGreaterThan(before);
  official = snapshot({ estado: 'ADJUDICADO', tiempo_restante_segundos: 0, es_abierta: false });
  sockets.at(-1)!.send(JSON.stringify({ event_type: 'SUBASTA_ADJUDICADA', lote_id: lotId,
    data: { codigo_lote: 'LOTE-PRUEBA-101', estado: 'ADJUDICADO', monto_adjudicado: 140 } }));
  await expect(page.getByLabel('Estado oficial del lote').getByText('ADJUDICADO', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Consultar información de órdenes' })).toHaveAttribute('href', `/ordenes?lote_id=${lotId}`);
  await expect(page.getByText('Los pagos permanecen deshabilitados.')).toBeVisible();
});

test('polling lets a slow official query finish instead of cancelling it every ten seconds', async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  let failedQueries = 0;
  let release: (() => void) | undefined;
  let hold = true;
  page.on('requestfailed', request => { if (request.url().endsWith(`/subastas/${lotId}/snapshot`)) failedQueries += 1; });
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, async route => {
    requests += 1;
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: snapshot() });
  });
  await page.routeWebSocket(`**/api/v1/subastas/${lotId}/live?*`, () => {});
  await page.goto(`/subastas/${lotId}`);
  await expect.poll(() => requests).toBe(1);
  await page.clock.runFor(11000);
  expect(requests).toBe(1);
  expect(failedQueries).toBe(0);
  hold = false;
  release!();
  await expect(page.getByRole('heading', { name: 'LOTE-PRUEBA-101' })).toBeVisible();
});

test('bids remain disabled after disconnect until the reconnected socket receives a fresh official snapshot', async ({ page }) => {
  await installSession(page);
  const sockets: WebSocketRoute[] = [];
  let holdRecovery = false;
  let releaseRecovery: (() => void) | undefined;
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, async route => {
    if (holdRecovery) await new Promise<void>(resolve => { releaseRecovery = resolve; });
    await route.fulfill({ json: snapshot() });
  });
  await page.routeWebSocket(`**/api/v1/subastas/${lotId}/live?*`, socket => { sockets.push(socket); });
  await page.goto(`/subastas/${lotId}`);
  const bidButton = page.getByRole('button', { name: 'Confirmar puja' });
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'En Vivo' })).toBeVisible();
  await expect(bidButton).toBeEnabled();
  await page.getByLabel('Importe de tu puja (S/)').fill('110');
  holdRecovery = true;
  const before = sockets.length;
  try {
    await sockets.at(-1)!.close({ code: 1012, reason: 'Reconexión con recuperación pendiente' });
    await expect(bidButton).toBeDisabled();
    await expect.poll(() => sockets.length, { timeout: 10000 }).toBeGreaterThan(before);
    await expect.poll(() => !!releaseRecovery).toBeTruthy();
    // The transport is open again, but its official recovery query is still pending.
    await expect(bidButton).toBeDisabled();
    holdRecovery = false;
    releaseRecovery!();
    await expect(page.getByRole('status').filter({ hasText: 'En Vivo' })).toBeVisible();
    await expect(bidButton).toBeEnabled();
  } finally {
    holdRecovery = false;
    releaseRecovery?.();
  }
});

test('an uncertain bid cannot be retried while the reconnection snapshot is pending', async ({ page }) => {
  await installSession(page);
  await page.route(`**/api/v1/subastas/${lotId}/pujas`, route => route.abort('failed'));
  const { sockets } = await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  await page.getByLabel('Importe de tu puja (S/)').fill('110');
  await page.getByRole('button', { name: 'Confirmar puja' }).click();
  const retryButton = page.getByRole('button', { name: 'Reintentar la misma puja' });
  await expect(retryButton).toBeEnabled();
  let releaseRecovery: (() => void) | undefined;
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, async route => {
    await new Promise<void>(resolve => { releaseRecovery = resolve; });
    await route.fulfill({ json: snapshot() });
  });
  const before = sockets.length;
  try {
    await sockets.at(-1)!.close({ code: 1012, reason: 'Reintento pendiente durante reconexión' });
    await expect(retryButton).toBeDisabled();
    await expect.poll(() => sockets.length, { timeout: 10000 }).toBeGreaterThan(before);
    await expect.poll(() => !!releaseRecovery).toBeTruthy();
    await expect(retryButton).toBeDisabled();
    releaseRecovery!();
    await expect(retryButton).toBeEnabled();
  } finally { releaseRecovery?.(); }
});

test('the live transport opens with a one-time ticket (never the JWT) and stops reconnecting when the session is revoked', async ({ page }) => {
  await page.clock.install();
  const token = await installSession(page);
  const { sockets } = await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  const url = new URL(sockets.at(-1)!.url());
  expect(url.searchParams.get('ticket')).toMatch(/^ticket-fixture-0001-/);
  expect(url.searchParams.has('access_token')).toBe(false);
  expect(url.toString()).not.toContain(token);
  await sockets.at(-1)!.close({ code: 1008, reason: 'Sesión revocada.' });
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeDisabled();
  await page.clock.runFor(31000);
  expect(sockets).toHaveLength(1);
});

test('an expired live session reconnects at once with a NEW ticket', async ({ page }) => {
  await installSession(page);
  const { sockets } = await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  const first = new URL(sockets.at(-1)!.url()).searchParams.get('ticket');
  await sockets.at(-1)!.close({ code: 1008, reason: 'Sesión expirada; reconecte con un ticket nuevo.' });
  await expect.poll(() => sockets.length).toBe(2);
  const second = new URL(sockets.at(-1)!.url()).searchParams.get('ticket');
  expect(second).not.toBe(first);
  await expect(page.getByRole('status').filter({ hasText: 'En Vivo' })).toBeVisible();
});

test('a rejected ticket is retried once with a new one, then the room gives up', async ({ page }) => {
  await page.clock.install();
  await installSession(page);
  const { sockets } = await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  await sockets.at(-1)!.close({ code: 1008, reason: 'Ticket inválido, vencido o ya usado.' });
  await expect.poll(() => sockets.length).toBe(2);
  await sockets.at(-1)!.close({ code: 1008, reason: 'Ticket inválido, vencido o ya usado.' });
  await page.clock.runFor(31000);
  expect(sockets).toHaveLength(2);
});

test('without a valid context the ticket request fails and no socket is opened', async ({ page }) => {
  await page.clock.install();
  await installSession(page);
  await page.route('**/api/v1/subastas/*/live/ticket', route => route.fulfill({ status: 403, json: { message: 'Sin contexto' } }));
  const { sockets } = await room(page, () => snapshot());
  await expect(page.getByRole('heading', { name: 'LOTE-PRUEBA-101' })).toBeVisible();
  await page.clock.runFor(31000);
  expect(sockets).toHaveLength(0);
});

test('anonymous visitors never open a live transport even when the live flag is enabled', async ({ page }) => {
  await page.clock.install();
  const opened: string[] = [];
  await page.routeWebSocket('**/api/v1/subastas/*/live*', socket => { opened.push(socket.url()); });
  await room(page, () => snapshot());
  await expect(page.getByRole('heading', { name: 'LOTE-PRUEBA-101' })).toBeVisible();
  await expect(page.getByText('Actualización periódica', { exact: true })).toBeVisible();
  await page.clock.runFor(11000);
  expect(opened).toEqual([]);
});

test('duplicate and delayed public bids are discarded against the official snapshot sequence', async ({ page }) => {
  await page.clock.install();
  await installSession(page);
  const { sockets, requested } = await room(page, () => snapshot({ secuencia_maxima: 2, version: 3, precio_actual: 120, proxima_puja_minima: 130 }));
  await expect(page.getByRole('status').filter({ hasText: 'En Vivo' })).toBeVisible();
  const before = requested.length;
  sockets.at(-1)!.send(JSON.stringify(liveBid(1)));
  sockets.at(-1)!.send(JSON.stringify(liveBid(2)));
  await page.clock.runFor(100);
  expect(requested).toHaveLength(before);
  await expect(page.getByText('Todavía no se recibieron pujas en esta visita.')).toBeVisible();
});

test('a public sequence gap suspends bids until the official snapshot recovers', async ({ page }) => {
  await installSession(page);
  const { sockets } = await room(page, () => snapshot({ secuencia_maxima: 2, version: 3 }));
  const bidButton = page.getByRole('button', { name: 'Confirmar puja' });
  await expect(bidButton).toBeEnabled();
  let release: (() => void) | undefined;
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: snapshot({ secuencia_maxima: 5, version: 6, precio_actual: 150, proxima_puja_minima: 160 }) });
  });
  try {
    sockets.at(-1)!.send(JSON.stringify(liveBid(5, { monto: 999, nuevo_precio_actual: 999 })));
    await expect.poll(() => !!release).toBeTruthy();
    await expect(bidButton).toBeDisabled();
    await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 999.00', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Secuencia 5', { exact: true })).toHaveCount(0);
    release!();
    await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 150.00', { exact: true })).toBeVisible();
    await expect(bidButton).toBeEnabled();
  } finally { release?.(); }
});

test('a contiguous public bid is shown as received while its price still waits for the official snapshot', async ({ page }) => {
  await installSession(page);
  const { sockets } = await room(page, () => snapshot());
  const bidButton = page.getByRole('button', { name: 'Confirmar puja' });
  await expect(bidButton).toBeEnabled();
  let release: (() => void) | undefined;
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: snapshot({ precio_actual: 110, proxima_puja_minima: 120, secuencia_maxima: 1, version: 2 }) });
  });
  try {
    sockets.at(-1)!.send(JSON.stringify(liveBid(1)));
    await expect.poll(() => !!release).toBeTruthy();
    await expect(page.getByText('Secuencia 1', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 110.00', { exact: true })).toHaveCount(0);
    await expect(bidButton).toBeDisabled();
    release!();
    await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 110.00', { exact: true })).toBeVisible();
    await expect(bidButton).toBeEnabled();
  } finally { release?.(); }
});

test('a public closure waits for the official snapshot before showing its order lookup link', async ({ page }) => {
  await installSession(page);
  const { sockets } = await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  let release: (() => void) | undefined;
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: snapshot({ estado: 'ADJUDICADO', es_abierta: false, tiempo_restante_segundos: 0 }) });
  });
  try {
    sockets.at(-1)!.send(JSON.stringify({ event_type: 'SUBASTA_ADJUDICADA', lote_id: lotId,
      data: { codigo_lote: 'LOTE-PRUEBA-101', estado: 'ADJUDICADO', monto_adjudicado: 100 } }));
    await expect.poll(() => !!release).toBeTruthy();
    await expect(page.getByLabel('Estado oficial del lote').getByText('ACTIVO', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Consultar información de órdenes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeDisabled();
    release!();
    await expect(page.getByRole('link', { name: 'Consultar información de órdenes' })).toHaveAttribute('href', `/ordenes?lote_id=${lotId}`);
  } finally { release?.(); }
});

test('session expiration closes the authenticated live transport without reconnecting anonymously', async ({ page }) => {
  await page.clock.install();
  await installSession(page);
  const { sockets } = await room(page, () => snapshot());
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  let closed = false;
  sockets.at(-1)!.onClose(() => { closed = true; });
  await page.clock.fastForward(901000);
  await expect(page.getByRole('link', { name: 'Inicia sesión', exact: true })).toBeVisible();
  await expect.poll(() => closed).toBeTruthy();
  await expect(page.getByText('Actualización periódica', { exact: true })).toBeVisible();
  await page.clock.runFor(11000);
  expect(sockets).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeDisabled();
});

test('legacy private order messages never authorize or navigate to an order', async ({ page }) => {
  await page.clock.install();
  await installSession(page);
  const { sockets, requested } = await room(page, () => snapshot());
  await expect(page.getByRole('status').filter({ hasText: 'En Vivo' })).toBeVisible();
  const before = requested.length;
  sockets.at(-1)!.send(JSON.stringify({ lote_id: lotId, orden_id: 'private-order', comprador_id: 'buyer-a',
    organizacion_compradora_id: 'org-a', organizacion_vendedora_id: 'org-b',
    monto_adjudicado: 999, comision_plataforma: 10, total_a_pagar: 1009, estado: 'PENDIENTE_PAGO' }));
  await page.clock.runFor(100);
  expect(requested).toHaveLength(before);
  await expect(page.getByText('private-order', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Consultar información de órdenes' })).toHaveCount(0);
});

test('HTTP polling defaults to snapshots and REST bids without opening a JWT transport', async ({ page }) => {
  await page.clock.install();
  await installSession(page);
  const opened: string[] = [];
  await page.routeWebSocket('**/api/v1/subastas/*/live*', socket => { opened.push(socket.url()); });
  let price = 100;
  await page.route(`**/api/v1/subastas/${lotId}/pujas`, async route => {
    const body = route.request().postDataJSON();
    price = body.monto;
    await route.fulfill({ status: 201, json: { ...liveBid(1).data, lote_id: lotId, monto: price,
      nuevo_precio_actual: price, idempotency_key: body.idempotency_key } });
  });
  const { requested } = await room(page, () => snapshot({ precio_actual: price, proxima_puja_minima: price + 10, secuencia_maxima: price === 100 ? 0 : 1 }));
  await expect(page.getByText('Actualización periódica', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  await page.getByLabel('Importe de tu puja (S/)').fill('110');
  await page.getByRole('button', { name: 'Confirmar puja' }).click();
  await expect(page.getByText(/El servidor confirmó tu puja de S\/ 110.00/)).toBeVisible();
  await expect(page.getByLabel('Estado oficial del lote').getByText('S/ 110.00', { exact: true })).toBeVisible();
  const before = requested.length;
  await page.clock.runFor(11000);
  await expect.poll(() => requested.length).toBeGreaterThan(before);
  expect(opened).toEqual([]);
  expect(requested.every(url => !new URL(url).searchParams.has('access_token'))).toBeTruthy();
});

test('HTTP polling cannot bid before a valid snapshot or after a failed refresh', async ({ page }) => {
  await installSession(page);
  let release: (() => void) | undefined;
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: snapshot() });
  });
  await page.goto(`/subastas/${lotId}`);
  await expect.poll(() => !!release).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toHaveCount(0);
  release!();
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeEnabled();
  await page.route(`**/api/v1/subastas/${lotId}/snapshot`, route => route.fulfill({ status: 503, json: { message: 'Consulta no disponible.' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('alert')).toContainText('Consulta no disponible.');
  await expect(page.getByRole('button', { name: 'Confirmar puja' })).toBeDisabled();
});


test('el catálogo muestra los lotes del servidor y "Mis lotes" pide mios=true; un error no se rellena con datos', async ({ page }) => {
  await installSession(page, { role: 'VENDEDOR', organizationId: 'org-b' });
  const pedidos: string[] = [];
  const lote = (id: string, codigo: string, extra: Record<string, unknown> = {}) => ({
    id, codigo_lote: codigo, estado: 'ACTIVO', precio_base: 4000, precio_actual: 4200, incremento_minimo: 100,
    fecha_inicio: '2026-11-05T10:00:00Z', fecha_cierre: '2099-12-31T18:00:00Z', es_abierta: true, total_pujas: 2,
    cantidad_animales: 12, categoria: 'TORETE', raza: 'Brown Swiss', descripcion: null, establecimiento_id: null,
    origen: { ubigeo: '210101', latitud: -15.84, longitud: -70.02, ubicacion_aproximada: true },
    peso_estimado_total_kg: 5100, es_mio: false, ...extra
  });
  await page.route('**/api/v1/subastas?*', route => {
    const url = new URL(route.request().url());
    pedidos.push(url.search);
    return route.fulfill({ json: { data: url.searchParams.get('mios') === 'true'
      ? [lote('9d1b1c34-6a8f-4c8e-9f2a-1a2b3c4d5e6f', 'MIO-1', { estado: 'BORRADOR', es_abierta: false, es_mio: true })]
      : [lote('8c0a0b23-5a7e-4b7d-8e19-0a1b2c3d4e5f', 'PUBLICO-1')], next_cursor: null } });
  });
  await page.goto('/subastas');
  const catalogo = page.getByRole('region', { name: 'Catálogo de lotes' });
  await expect(catalogo.getByRole('link', { name: 'PUBLICO-1' })).toHaveAttribute('href', '/subastas/8c0a0b23-5a7e-4b7d-8e19-0a1b2c3d4e5f');
  await expect(catalogo).toContainText('12 animales · TORETE · Brown Swiss');
  await expect(catalogo).toContainText('ubicación aproximada');
  await expect(catalogo).toContainText('precio total del lote');
  await catalogo.getByRole('button', { name: 'Mis lotes' }).click();
  await expect(catalogo.getByRole('link', { name: 'MIO-1' })).toBeVisible();
  expect(pedidos.some(q => q.includes('mios=true'))).toBe(true);

  await page.route('**/api/v1/subastas?*', route => route.fulfill({ status: 500, json: { message: 'caído' } }));
  await catalogo.getByRole('button', { name: 'Lotes activos' }).click();
  await expect(catalogo.getByRole('alert')).toBeVisible();
  await expect(catalogo.getByRole('link', { name: 'PUBLICO-1' })).toHaveCount(0);
});
