import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { assertIsolatedRealEnvironment } from './environment.mjs';

assertIsolatedRealEnvironment(process.env);

const api = 'http://127.0.0.1:4181/api/v1';
const authorization = (token: string) => ({ Authorization: `Bearer ${token}` });
const money = (amount: number) => new Intl.NumberFormat('es-PE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(amount);

async function registerBuyer(request: APIRequestContext, suffix: string) {
  const account = {
    email: `${suffix}-${randomUUID()}@example.test`, password: `${randomUUID()}-fixture`,
    nombre: `Persona ficticia ${suffix}`, organizacion_nombre: `Organización ficticia ${suffix}`,
    rol_inicial: 'COMPRADOR'
  };
  const response = await request.post(`${api}/auth/register`, { data: account });
  expect(response.status()).toBe(201);
  const session = await response.json();
  expect(session.active_context.rol).toBe('COMPRADOR');
  return { ...account, token: session.access_token as string, organizationId: session.active_context.organizacion_id as string };
}

test('registro y publicación web, puja persistida, cierre automático y orden autorizada real', async ({ page, request }) => {
  test.setTimeout(270_000);
  const run = randomUUID();
  const seller = {
    email: `seller-${run}@example.test`, password: `${randomUUID()}-fixture`,
    name: 'Vendedora ficticia de integración', organization: `Establo ficticio ${run.slice(0, 8)}`
  };
  const socketUrls: string[] = [];
  page.on('websocket', socket => socketUrls.push(socket.url()));

  const health = await request.get('http://127.0.0.1:4181/health');
  expect(health.status()).toBe(200);
  expect((await health.json()).db).toBe('ok');

  await page.goto('/acceso');
  await page.getByRole('button', { name: 'Crear una cuenta', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill(seller.name);
  await page.getByLabel('Nombre de la organización', { exact: true }).fill(seller.organization);
  await page.getByRole('combobox', { name: 'Quiero operar como', exact: true }).selectOption('VENDEDOR');
  await page.getByLabel('Correo electrónico').fill(seller.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(seller.password);
  const registered = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/register') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  const registration = await registered;
  expect(registration.status()).toBe(201);
  const sellerSession = await registration.json();
  expect(sellerSession.active_context.rol).toBe('VENDEDOR');
  await expect(page).toHaveURL(/\/contexto$/);
  await expect(page.getByText('Organización activa:')).toContainText(seller.organization);
  await expect(page.getByText('Rol activo:')).toContainText('VENDEDOR');

  await page.getByRole('link', { name: 'Ir a subastas' }).click();
  const uiCode = `WEB-${run.slice(0, 8)}`;
  await page.getByLabel('Código del lote (opcional)').fill(uiCode);
  await page.getByLabel('Precio base del lote completo (S/)').fill('4200');
  await page.getByLabel('Incremento mínimo (S/)').fill('100');
  // The normal UI uses minute precision and the API's default 60-second anti-sniping.
  // Leave at least two minutes before close so the bid does not extend the auction.
  // No request interception or test-only publication route changes the UI payload.
  const closesAt = Math.ceil((Date.now() + 120_000) / 60_000) * 60_000;
  await page.getByLabel('Fecha y hora local de cierre').fill(new Date(closesAt).toISOString().slice(0, 16));
  const published = page.waitForResponse(response => response.url().endsWith('/api/v1/subastas') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publicar lote', exact: true }).click();
  const publication = await published;
  expect