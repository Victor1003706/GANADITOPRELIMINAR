import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { isolatedWebEnvironment } from './environment.mjs';

const webEnvironment = isolatedWebEnvironment(process.env);
const api = 'http://127.0.0.1:4181/api/v1';
const authorization = (token?: string): Record<string, string> => token ? { Authorization: `Bearer ${token}` } : {};

async function register(request: APIRequestContext, role: 'VENDEDOR' | 'COMPRADOR', label: string) {
  const account = {
    email: `v05-${label}-${randomUUID()}@example.test`, password: `${randomUUID()}-fixture`,
    nombre: `Persona ficticia V05 ${label}`, organizacion_nombre: `Organización ficticia V05 ${label}`,
    rol_inicial: role
  };
  const response = await request.post(`${api}/auth/register`, { data: account });
  expect(response.status()).toBe(201);
  const session = await response.json();
  expect(session.active_context.rol).toBe(role);
  return { ...account, token: session.access_token as string, userId: session.user.id as string,
    organizationId: session.active_context.organizacion_id as string };
}

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/acceso');
  await page.getByLabel('Correo electrónico').fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/contexto$/);
}

test('V05 real: mapa y Spot aíslan coordenadas; pasaporte privado conserva cadena y API pública redacta', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const run = randomUUID().slice(0, 8);
  const socketUrls: string[] = [];
  // Only third-party map tiles are blocked; all business HTTP responses are real.
  await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
  page.on('websocket', socket => socketUrls.push(socket.url()));

  // Verify the actual served adapter-node artifact, not a development server or
  // an unlabelled previous build. The record contains a public SHA only.
  const versionResponse = await request.get('http://127.0.0.1:4180/_app/version.json');
  expect(versionResponse.status()).toBe(200);
  expect((await versionResponse.json()).version).toBe(webEnvironment.GANADITO_RELEASE_SHA);
  const record = JSON.parse(await readFile(resolve(testInfo.config.rootDir, '../../../test-results/real/release.json'), 'utf8'));
  expect(record).toEqual({ release_sha: webEnvironment.GANADITO_RELEASE_SHA });

  const owner = await register(request, 'VENDEDOR', `owner-${run}`);
  const outsider = await register(request, 'COMPRADOR', `outsider-${run}`);
  const stable = {
    nombre_comercial: `Establo ficticio V05 ${run}`, tipo: 'ESTABLO',
    latitud: -12.04631, longitud: -77.04267, direccion_texto: `Dirección privada ficticia V05 ${run}`,
    ubigeo: '150101'
  };
  const publicPlace = {
    nombre_comercial: `Camal público ficticio V05 ${run}`, tipo: 'CAMAL',
    latitud: -12.04173, longitud: -77.03321, direccion_texto: `Dirección pública ficticia V05 ${run}`,
    ubigeo: '150101'
  };
  const locations: Array<{ id: string; input: typeof stable }> = [];
  for (const input of [stable, publicPlace]) {
    const response = await request.post(`${api}/establecimientos`, { headers: authorization(owner.token), data: input });
    expect(response.status()).toBe(201);
    const created = await response.json();
    expect(created.organizacion_id).toBe(owner.organizationId);
    locations.push({ id: created.id, input });
    const quote = await request.post(`${api}/cotizaciones`, {
      headers: authorization(owner.token), data: {
        establecimiento_id: created.id, producto: 'GANADO_EN_PIE', categoria: 'TORETE', calidad: 'PRIMERA',
        unidad_medida: 'KG_VIVO', precio_unitario: 12.5, moneda: 'PEN',
