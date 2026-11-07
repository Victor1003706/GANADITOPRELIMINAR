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
        vigencia_hasta: new Date(Date.now() + 3_600_000).toISOString()
      }
    });
    expect(quote.status()).toBe(201);
    expect((await quote.json()).establecimiento_id).toBe(created.id);
  }
  const stableId = locations[0].id;
  const publicId = locations[1].id;

  // Literal expected snapped point is independent of the backend's grid helper.
  // The original position deliberately does not lie on the 0.01-degree grid.
  for (const [context, token] of [['anónimo', undefined], ['ajeno', outsider.token], ['dueño', owner.token]] as const) {
    const mapResponse = await request.get(`${api}/establecimientos/cercanos?lat=-12.046&lon=-77.042&radio_km=50&limit=50`, { headers: authorization(token) });
    expect(mapResponse.status(), context).toBe(200);
    const map = await mapResponse.json();
    const privateItem = map.establecimientos.find((item: { id: string }) => item.id === stableId);
    const publicItem = map.establecimientos.find((item: { id: string }) => item.id === publicId);
    expect(privateItem).toBeDefined();
    expect(publicItem).toBeDefined();
    const owns = context === 'dueño';
    expect(privateItem.ubicacion_aproximada).toBe(!owns);
    expect(privateItem.latitud).toBeCloseTo(owns ? -12.04631 : -12.05, 7);
    expect(privateItem.longitud).toBeCloseTo(owns ? -77.04267 : -77.04, 7);
    expect(privateItem.direccion_texto).toBe(owns ? stable.direccion_texto : null);
    expect(typeof privateItem.distancia_km).toBe('number');
    expect(publicItem.ubicacion_aproximada).toBe(false);
    expect(publicItem.latitud).toBeCloseTo(-12.04173, 7);
    expect(publicItem.longitud).toBeCloseTo(-77.03321, 7);
    expect(publicItem.direccion_texto).toBe(publicPlace.direccion_texto);

    const spotResponse = await request.get(`${api}/cotizaciones/pizarra?limit=100`, { headers: authorization(token) });
    expect(spotResponse.status(), context).toBe(200);
    const spot = await spotResponse.json();
    const privateQuote = spot.cotizaciones.find((item: { establecimiento_id: string }) => item.establecimiento_id === stableId);
    const publicQuote = spot.cotizaciones.find((item: { establecimiento_id: string }) => item.establecimiento_id === publicId);
    expect(privateQuote.ubicacion_aproximada).toBe(!owns);
    expect(privateQuote.latitud).toBeCloseTo(owns ? -12.04631 : -12.05, 7);
    expect(privateQuote.longitud).toBeCloseTo(owns ? -77.04267 : -77.04, 7);
    expect(publicQuote.ubicacion_aproximada).toBe(false);
    expect(publicQuote.latitud).toBeCloseTo(-12.04173, 7);
    expect(publicQuote.longitud).toBeCloseTo(-77.03321, 7);
  }

  async function verifyMarket(owns: boolean) {
    await page.goto('/');
    const map = page.getByRole('region', { name: 'Mapa de establecimientos', exact: true });
    const mapButton = map.getByRole('button').filter({ hasText: stable.nombre_comercial });
    const spotButton = page.getByRole('region', { name: 'Pizarra Spot', exact: true }).getByRole('button').filter({ hasText: stable.nombre_comercial });
    await expect(mapButton).toContainText(owns ? 'Ubicación exacta' : 'Ubicación aproximada');
    if (!owns) await expect(mapButton).toContainText('Distancia aproximada:');
    await expect(spotButton).toContainText(owns ? 'Ubicación exacta' : 'Ubicación aproximada');
    await expect(map.locator('path.ubicacion-aproximada')).toHaveCount(owns ? 0 : 1);
    await expect(map.locator('path.ubicacion-exacta')).toHaveCount(owns ? 2 : 1);
    await mapButton.click();
    const popup = page.locator('.leaflet-popup-content');
    await expect(popup).toContainText(stable.nombre_comercial);
    await expect(popup).toContainText(owns ? 'Ubicación exacta' : 'Ubicación aproximada');
    if (owns) await expect(popup).toContainText(stable.direccion_texto);
    else {
      await expect(popup).not.toContainText(stable.direccion_texto);
      await expect(page.locator('body')).not.toContainText(stable.direccion_texto);
    }
    const publicButton = map.getByRole('button').filter({ hasText: publicPlace.nombre_comercial });
    await expect(publicButton).toContainText('Ubicación exacta');
    await publicButton.click();
    await expect(popup).toContainText(publicPlace.nombre_comercial);
    await expect(popup).toContainText(publicPlace.direccion_texto);
    // Begin from a different selection so this fails if the Spot handler stops
    // selecting its establishment or substitutes a precise public marker.
    await spotButton.click();
    await expect(popup).toContainText(stable.nombre_comercial);
    await expect(popup).toContainText(owns ? 'Ubicación exacta' : 'Ubicación aproximada');
    if (!owns) await expect(popup).not.toContainText(stable.direccion_texto);
  }

  await verifyMarket(false); // anonymous, no browser session seeded or intercepted
  await login(page, outsider);
  await verifyMarket(false);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await login(page, owner);
  await verifyMarket(true);

  const privateNote = `Contacto privado ficticio ${run}`;
  const genesisMetadata = { raza: 'Holstein', peso_nacimiento_kg: 34, direccion: stable.direccion_texto,
    notas: privateNote, latitud: stable.latitud, datos: { telefono: 'ficticio' } };
  const bovineResponse = await request.post(`${api}/trazabilidad/bovinos`, {
    headers: authorization(owner.token), data: { codigo_arete: `V05-${run}`, raza: 'Holstein', sexo: 'HEMBRA', metadata: genesisMetadata }
  });
  expect(bovineResponse.status()).toBe(201);
  const { bovino, eventoGenesis } = await bovineResponse.json();
  const eventResponse = await request.post(`${api}/trazabilidad/bovinos/${bovino.id}/eventos`, {
    headers: authorization(owner.token), data: {
      event_type: 'VACUNACION', metadata: { vacuna: 'Fiebre aftosa', dosis_ml: 2, notas: privateNote,
        lote: ['objeto no público'], ubicacion: { latitud: stable.latitud, longitud: stable.longitud } }
    }
  });
  expect(eventResponse.status()).toBe(201);
  const registeredEvent = await eventResponse.json();
  const passportUrl = `${api}/trazabilidad/bovinos/${bovino.id}/pasaporte`;
  const completeResponse = await request.get(passportUrl, { headers: authorization(owner.token) });
  expect(completeResponse.status()).toBe(200);
  const complete = await completeResponse.json();
  expect(complete.vista).toBe('COMPLETA');
  expect(complete.bovino.organizacion_id).toBe(owner.organizationId);
  expect(complete.eventos).toHaveLength(2);
  expect(complete.eventos[0].metadata).toEqual(genesisMetadata);
  expect(complete.eventos[0].current_hash).toBe(eventoGenesis.current_hash);
  expect(complete.eventos[0].prev_hash).toBe('0'.repeat(64));
  expect(complete.eventos[1].prev_hash).toBe(eventoGenesis.current_hash);
  expect(complete.eventos[1].current_hash).toBe(registeredEvent.current_hash);
  for (const event of complete.eventos) {
    expect(event.autor_id).toBe(owner.userId);
    expect(event.current_hash).toMatch(/^[a-f0-9]{64}$/);
  }

  for (const token of [undefined, outsider.token]) {
    const response = await request.get(passportUrl, { headers: authorization(token) });
    expect(response.status()).toBe(200);
    const passport = await response.json();
    expect(passport.vista).toBe('PUBLICA');
    expect(passport.bovino.organizacion_id).toBeNull();
    expect(passport.eventos).toHaveLength(2);
    for (const event of passport.eventos) {
      expect(event.autor_id).toBeNull();
      expect(event).not.toHaveProperty('prev_hash');
      expect(event).not.toHaveProperty('current_hash');
    }
    expect(passport.eventos[0].metadata).toEqual({ raza: 'Holstein', peso_nacimiento_kg: 34,
      direccion: '[REDACTADO]', notas: '[REDACTADO]', latitud: '[REDACTADO]', datos: '[REDACTADO]' });
    expect(passport.eventos[1].metadata).toEqual({ vacuna: 'Fiebre aftosa', dosis_ml: 2,
      notas: '[REDACTADO]', lote: '[REDACTADO]', ubicacion: '[REDACTADO]' });
    expect(JSON.stringify(passport)).not.toContain(privateNote);
    expect(JSON.stringify(passport)).not.toContain(stable.direccion_texto);
  }
  const verification = await request.get(`${api}/trazabilidad/bovinos/${bovino.id}/verificar`);
  expect(verification.status()).toBe(200);
  expect(await verification.json()).toEqual({ integro: true, total_eventos: 2 });

  await page.goto(`/trazabilidad/${bovino.id}`);
  await expect(page.getByText(`V05-${run}`, { exact: true })).toBeVisible();
  await expect(page.getByText(privateNote, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Verificar cadena', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Integridad de la cadena' })).toContainText('El servidor confirmó la integridad de la cadena.');
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await login(page, outsider);
  await page.goto(`/trazabilidad/${bovino.id}`);
  // Otra organización recibe la vista PUBLICA real: sin la nota privada, sin hashes ni
  // autor, y con la integridad confirmada por el servidor.
  await expect(page.getByRole('status').filter({ hasText: 'Vista pública' })).toBeVisible();
  await expect(page.getByText(`V05-${run}`, { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(privateNote);
  await expect(page.getByText(/Hash Previo|Hash Bloque|USR-/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Verificar cadena', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Integridad de la cadena' })).toContainText('El servidor confirmó la integridad de la cadena.');

  // Ruta del QR: siempre sin token, aunque haya sesión.
  const qrAuthorization: (string | undefined)[] = [];
  page.on('request', pending => {
    if (pending.url().includes(`/api/v1/trazabilidad/bovinos/${bovino.id}/`)) qrAuthorization.push(pending.headers()['authorization']);
  });
  await page.goto(`/trazabilidad/${bovino.id}/publico`);
  await expect(page.getByRole('heading', { name: 'Pasaporte bovino público', exact: true })).toBeVisible();
  await expect(page.getByText(`V05-${run}`, { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(privateNote);
  await expect(page.getByText(/Hash Previo|Hash Bloque|USR-/)).toHaveCount(0);
  expect(qrAuthorization.length).toBeGreaterThan(0);
  expect(qrAuthorization.every(value => value === undefined)).toBe(true);

  // Existing HTTP routes only; no test SQL, seeds, business-response interception
  // or special publication routes make these privacy assertions pass.
  const invalidToken = await request.get(passportUrl, { headers: authorization('invalid-fixture-token') });
  expect(invalidToken.status()).toBe(401);
  const anonymousWrite = await request.post(`${api}/establecimientos`, { data: stable });
  expect(anonymousWrite.status()).toBe(401);
  for (const endpoint of ['pasaporte', 'verificar']) {
    const missing = await request.get(`${api}/trazabilidad/bovinos/${randomUUID()}/${endpoint}`);
    expect(missing.status()).toBe(404);
  }
  expect(socketUrls).toEqual([]);
});
