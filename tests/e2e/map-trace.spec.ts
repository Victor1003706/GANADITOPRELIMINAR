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
    await blockMapTiles(page);
    await page.route('**/api/v1/establecimientos/cercanos?**', route => route.fulfill({ json: { establecimientos: [{ ...establecimiento, ubicacion_aproximada: flag }] } }));
    await page.route('**/api/v1/cotizaciones/pizarra?**', route => route.fulfill({ json: { cotizaciones: [{ ...cotizacion, ubicacion_aproximada: flag }] } }));
    await page.goto('/');
    await expect(page.getByRole('alert').filter({ hasText: 'lista de establecimientos válida' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'lista de cotizaciones válida' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mapa de establecimientos' }).getByRole('listitem')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Pizarra Spot' }).getByRole('listitem')).toHaveCount(0);
  });
}

test('V05 Spot admite coordenadas nulas sin inventar una posición seleccionable', async ({ page }) => {
  await blockMapTiles(page);
  await page.route('**/api/v1/establecimientos/cercanos?**', route => route.fulfill({ json: { establecimientos: [] } }));
  await page.route('**/api/v1/cotizaciones/pizarra?**', route => route.fulfill({ json: { cotizaciones: [{ ...cotizacion, establecimiento_id: null, establecimiento_nombre: null, latitud: null, longitud: null }] } }));
  await page.goto('/');
  const item = page.getByRole('region', { name: 'Pizarra Spot' }).getByRole('listitem');
  await expect(item).toContainText('Ubicación no disponible');
  await expect(item).toContainText('Establecimiento no informado');
  await expect(item.getByRole('button')).toBeDisabled();
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('V05 muestra la vista PUBLICA en la ruta regular: eventos sin hashes ni autor y verificación en el servidor', async ({ page }) => {
  await installSession(page);
  let verificaciones = 0;
  await page.route('**/api/v1/trazabilidad/bovinos/ajeno/pasaporte', route => route.fulfill({ json: pasaporte('PUBLICA', 'ajeno') }));
  await page.route('**/api/v1/trazabilidad/bovinos/ajeno/verificar', route => { verificaciones++; return route.fulfill({ json: { integro: true, total_eventos: 1 } }); });
  await page.goto('/trazabilidad/ajeno');
  await expect(page.getByRole('heading', { name: 'ARETE-ajeno', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Vista pública' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'pasaporte válido' })).toHaveCount(0);
  await expect(page.getByText('420', { exact: true })).toBeVisible();
  await expect(page.getByText('Autor reservado')).toBeVisible();
  await expect(page.getByText(/Autor:|Hash Previo|Hash Bloque/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Verificar cadena', exact: true }).click();
  await expect(page.getByText('El servidor confirmó la integridad de la cadena.')).toBeVisible();
  expect(verificaciones).toBe(1);
});

test('V05 QR público: /publico consulta sin token aunque haya sesión y muestra la vista PUBLICA', async ({ page }) => {
  await installSession(page);
  const autorizaciones: (string | undefined)[] = [];
  await page.route('**/api/v1/trazabilidad/bovinos/qr/pasaporte', route => {
    autorizaciones.push(route.request().headers()['authorization']);
    return route.fulfill({ json: pasaporte('PUBLICA', 'qr') });
  });
  await page.route('**/api/v1/trazabilidad/bovinos/qr/verificar', route => {
    autorizaciones.push(route.request().headers()['authorization']);
    return route.fulfill({ json: { integro: true, total_eventos: 1 } });
  });
  await page.goto('/trazabilidad/qr/publico');
  await expect(page.getByRole('heading', { name: 'ARETE-qr', exact: true })).toBeVisible();
  await expect(page.getByText(/Hash Previo|Hash Bloque/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Verificar cadena', exact: true }).click();
  await expect(page.getByText('El servidor confirmó la integridad de la cadena.')).toBeVisible();
  expect(autorizaciones).toEqual([undefined, undefined]);
});

test('V05 QR público rechaza una vista COMPLETA servida a un anónimo', async ({ page }) => {
  await page.route('**/api/v1/trazabilidad/bovinos/qr2/pasaporte', route => route.fulfill({ json: pasaporte('COMPLETA', 'qr2') }));
  await page.goto('/trazabilidad/qr2/publico');
  await expect(page.getByRole('alert').filter({ hasText: 'pasaporte válido' })).toBeVisible();
  await expect(page.getByText(/Hash Bloque/)).toHaveCount(0);
});

test('V05 COMPLETA solo se representa si coincide con la organización activa', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/trazabilidad/bovinos/ajeno/pasaporte', route => route.fulfill({ json: pasaporte('COMPLETA', 'ajeno', 'org-b') }));
  await page.goto('/trazabilidad/ajeno');
  await expect(page.getByRole('alert').filter({ hasText: 'pasaporte válido' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ARETE-ajeno', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verificar cadena', exact: true })).toHaveCount(0);
});

for (const tipo of ['HITO_HISTORICO_DESCONOCIDO', 'constructor', 'toString', '__proto__']) {
  test(`V05 lee evento histórico COMPLETA como texto con fallback seguro: ${tipo}`, async ({ page }) => {
    await installSession(page);
    const errores: string[] = [];
    page.on('pageerror', error => errores.push(error.message));
    const data = pasaporte('COMPLETA', 'historico');
    data.eventos[0].event_type = tipo;
    await page.route('**/api/v1/trazabilidad/bovinos/historico/pasaporte', route => route.fulfill({ json: data }));
    await page.goto('/trazabilidad/historico');
    await expect(page.getByRole('heading', { name: 'ARETE-historico', exact: true })).toBeVisible();
    // Both the fallback title and the original type remain visible, even for
    // names inherited by ordinary JavaScript objects.
    await expect(page.getByText(tipo, { exact: true })).toHaveCount(2);
    await expect(page.getByText('📌', { exact: true })).toBeVisible();
    await expect(page.getByText('420', { exact: true })).toBeVisible();
    await expect(page.locator('[title="' + 'a'.repeat(64) + '"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verificar cadena', exact: true })).toBeVisible();
    expect(errores).toEqual([]);
  });

  test(`V05 reconoce PUBLICA histórica sin mostrar datos privados: ${tipo}`, async ({ page }) => {
    await installSession(page);
    const data = pasaporte('PUBLICA', 'historico-publico');
    data.eventos[0].event_type = tipo;
    await page.route('**/api/v1/trazabilidad/bovinos/historico-publico/pasaporte', route => route.fulfill({ json: data }));
    await page.goto('/trazabilidad/historico-publico');
    await expect(page.getByRole('status').filter({ hasText: 'Vista pública' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'pasaporte válido' })).toHaveCount(0);
    await expect(page.getByText(tipo, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Autor:|Hash Previo|Hash Bloque/)).toHaveCount(0);
  });
}

for (const caso of ['sin vista', 'pública con autor', 'pública con organización', 'pública con hash', 'completa sin autor', 'completa sin hash', 'sexo como arreglo', 'estado como arreglo']) {
  test(`V05 rechaza pasaporte discriminado malformado: ${caso}`, async ({ page }) => {
    await installSession(page);
    const data: any = pasaporte(caso.startsWith('pública') ? 'PUBLICA' : 'COMPLETA', 'malformado');
    if (caso === 'sin vista') delete data.vista;
    if (caso === 'pública con autor') data.eventos[0].autor_id = 'usuario-privado';
    if (caso === 'pública con organización') data.bovino.organizacion_id = 'org-b';
    if (caso === 'pública con hash') data.eventos[0].current_hash = 'b'.repeat(64);
    if (caso === 'completa sin autor') data.eventos[0].autor_id = null;
    if (caso === 'completa sin hash') delete data.eventos[0].prev_hash;
    if (caso === 'sexo como arreglo') data.bovino.sexo = ['MACHO'];
    if (caso === 'estado como arreglo') data.bovino.estado = ['VIVO'];
    await page.route('**/api/v1/trazabilidad/bovinos/malformado/pasaporte', route => route.fulfill({ json: data }));
    await page.goto('/trazabilidad/malformado');
    await expect(page.getByRole('alert').filter({ hasText: 'pasaporte válido' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ARETE-malformado', exact: true })).toHaveCount(0);
  });
}

test('V05 COMPLETA representa eventos y metadata como texto y espera la verificación del servidor', async ({ page }) => {
  await installSession(page);
  const inyeccion = '<img src=x onerror="window.__traceXss=1">';
  const data = pasaporte('COMPLETA', 'propio');
  data.bovino.codigo_arete = inyeccion;
  const metadata = { peso_kg: 420, observacion: inyeccion, detalle: { texto: '<script>window.__traceXss=2</script>' }, lista: ['áéíóú', inyeccion] };
  await page.route('**/api/v1/trazabilidad/bovinos/propio/pasaporte', route => route.fulfill({ json: { ...data, eventos: [{ ...data.eventos[0], metadata }] } }));
  let verificaciones = 0;
  await page.route('**/api/v1/trazabilidad/bovinos/propio/verificar', route => {
    verificaciones++;
    return route.fulfill({ json: { integro: false, total_eventos: 1, secuencia_corrupta: 1 } });
  });
  await page.goto('/trazabilidad/propio');
  await expect(page.getByRole('heading', { name: inyeccion, exact: true })).toBeVisible();
  await expect(page.getByText('Control de Pesaje Periódico', { exact: true })).toBeVisible();
  await expect(page.getByText('USR-user-a', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copiar', exact: true })).toBeVisible();
  await expect(page.locator('[title="' + 'a'.repeat(64) + '"]')).toBeVisible();
  await expect(page.getByText(JSON.stringify(metadata.detalle), { exact: true })).toBeVisible();
  await expect(page.locator('main img, main script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __traceXss?: number }).__traceXss)).toBeUndefined();
  expect(verificaciones).toBe(0);
  await page.getByRole('button', { name: 'Verificar cadena', exact: true }).click();
  await expect(page.getByText('El servidor detectó una inconsistencia en la cadena.')).toBeVisible();
  expect(verificaciones).toBe(1);
});

test('V05 cerrar sesión retira dirección exacta y descarta respuestas tardías de mapa y Spot', async ({ page }) => {
  await blockMapTiles(page);
  await installSession(page);
  let retrasar = false;
  const liberar: (() => void)[] = [];
  const completadas: Promise<void>[] = [];
  const canceladas: string[] = [];
  page.on('requestfailed', request => {
    if (/\/api\/v1\/(establecimientos\/cercanos|cotizaciones\/pizarra)/.test(request.url())) canceladas.push(request.url());
  });
  await page.route('**/api/v1/establecimientos/cercanos?**', async route => {
    const privada = !!route.request().headers().authorization;
    if (privada && retrasar) {
      completadas.push(new Promise<void>(resolve => liberar.push(resolve)));
      await completadas.at(-1);
    }
    await route.fulfill({ json: { establecimientos: [{ ...establecimiento, nombre_comercial: privada ? 'Establo privado' : 'Establo público', ubicacion_aproximada: !privada, direccion_texto: privada ? 'Dirección reservada' : null }] } });
  });
  await page.route('**/api/v1/cotizaciones/pizarra?**', async route => {
    const privada = !!route.request().headers().authorization;
    if (privada && retrasar) {
      completadas.push(new Promise<void>(resolve => liberar.push(resolve)));
      await completadas.at(-1);
    }
    await route.fulfill({ json: { cotizaciones: [{ ...cotizacion, establecimiento_nombre: privada ? 'Cotización privada' : 'Cotización pública', ubicacion_aproximada: !privada }] } });
  });
  await page.goto('/');
  await page.getByRole('region', { name: 'Mapa de establecimientos' }).getByRole('button').filter({ hasText: 'Establo privado' }).click();
  await expect(page.locator('.leaflet-popup-content')).toContainText('Dirección reservada');
  retrasar = true;
  await page.getByRole('button', { name: 'Consultar mercado', exact: true }).click();
  await expect.poll(() => liberar.length).toBe(2);
  const canceladasAntes = canceladas.length;
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect.poll(() => canceladas.length - canceladasAntes).toBe(2);
  await expect(page.getByRole('region', { name: 'Mapa de establecimientos' }).getByRole('button').filter({ hasText: 'Establo público' })).toBeVisible();
  for (const resolver of liberar) resolver();
  await Promise.all(completadas);
  await expect(page.getByRole('region', { name: 'Pizarra Spot' }).getByRole('listitem')).toContainText('Cotización pública');
  await expect(page.getByText(/Establo privado|Cotización privada|Dirección reservada/)).toHaveCount(0);
  await expect(page.locator('path.ubicacion-exacta')).toHaveCount(0);
  await expect(page.locator('path.ubicacion-aproximada')).toHaveCount(1);
});

test('V05 cambiar de organización cancela el pasaporte y la auditoría pendientes del contexto anterior', async ({ page }) => {
  await installSession(page);
  let cambiado = false;
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: cambiado ? profile('org-b', 'VENDEDOR') : profile() }));
  await page.route('**/api/v1/auth/organizations/switch-context', route => {
    cambiado = true;
    return route.fulfill({ json: { access_token: fakeToken('org-b', 'VENDEDOR'), active_context: profile('org-b', 'VENDEDOR').activeContext } });
  });
  let retrasarPasaporte = false;
  let liberarPasaporte: (() => void) | undefined;
  let liberarAuditoria: (() => void) | undefined;
  const canceladas: string[] = [];
  page.on('requestfailed', request => {
    if (request.url().includes('/api/v1/trazabilidad/bovinos/contexto/')) canceladas.push(request.url());
  });
  await page.route('**/api/v1/trazabilidad/bovinos/contexto/pasaporte', async route => {
    const anterior = !cambiado;
    if (anterior && retrasarPasaporte) await new Promise<void>(resolve => { liberarPasaporte = resolve; });
    await route.fulfill({ json: pasaporte(anterior ? 'COMPLETA' : 'PUBLICA', 'contexto') });
  });
  await page.route('**/api/v1/trazabilidad/bovinos/contexto/verificar', async route => {
    await new Promise<void>(resolve => { liberarAuditoria = resolve; });
    await route.fulfill({ json: { integro: true, total_eventos: 1 } });
  });
  await page.goto('/trazabilidad/contexto');
  await expect(page.getByRole('heading', { name: 'ARETE-contexto', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verificar cadena', exact: true }).click();
  await expect.poll(() => !!liberarAuditoria).toBe(true);
  retrasarPasaporte = true;
  await page.getByRole('button', { name: 'Actualizar pasaporte', exact: true }).click();
  await expect.poll(() => !!liberarPasaporte).toBe(true);
  await expect.poll(() => canceladas.some(url => url.endsWith('/verificar'))).toBe(true);
  await page.getByRole('link', { name: 'Ganadería A', exact: false }).click();
  await page.getByRole('button', { name: 'Usar Ganadería B como VENDEDOR' }).click();
  await expect(page.getByText('Organización activa:')).toContainText('Ganadería B');
  await expect.poll(() => canceladas.some(url => url.endsWith('/pasaporte'))).toBe(true);
  await page.getByRole('navigation').getByRole('link', { name: 'Trazabilidad', exact: true }).click();
  await page.getByLabel('Identificador del bovino').fill('contexto');
  await page.getByRole('button', { name: 'Consultar pasaporte', exact: true }).click();
  // El nuevo contexto recibe la vista PUBLICA; la COMPLETA y la auditoría del contexto
  // anterior, liberadas tarde, no deben pintarse sobre ella.
  await expect(page.getByRole('status').filter({ hasText: 'Vista pública' })).toBeVisible();
  liberarPasaporte!();
  liberarAuditoria!();
  await expect(page.getByRole('status').filter({ hasText: 'Vista pública' })).toBeVisible();
  await expect(page.getByText(/servidor confirmó la integridad|Hash Previo|USR-user-a/)).toHaveCount(0);
});

test('los errores de mapa y Spot quedan visibles sin sustituirse por datos ficticios', async ({ page }) => {
  await blockMapTiles(page);
  await page.route('**/api/v1/establecimientos/cercanos?**', route => route.fulfill({ status: 503, json: { message: 'Mapa temporalmente no disponible' } }));
  await page.route('**/api/v1/cotizaciones/pizarra?**', route => route.fulfill({ status: 503, json: { message: 'Precios temporalmente no disponibles' } }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Mapa temporalmente no disponible' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Precios temporalmente no disponibles' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mapa de establecimientos' }).getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pizarra Spot' }).getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('Ganado Vacuno en Pie', { exact: true })).toHaveCount(0);
});

test('la consulta envía filtros geográficos y comerciales reales y conserva los resultados vacíos', async ({ page }) => {
  await blockMapTiles(page);
  await page.route('**/api/v1/establecimientos/cercanos?**', route => route.fulfill({ json: { total: 0, establecimientos: [] } }));
  await page.route('**/api/v1/cotizaciones/pizarra?**', route => route.fulfill({ json: { total: 0, cotizaciones: [] } }));
  await page.goto('/');
  await expect(page.getByText('No se encontraron establecimientos para esta consulta.')).toBeVisible();
  await expect(page.getByText('No hay cotizaciones disponibles para esta consulta.')).toBeVisible();
  await page.getByLabel('Latitud del centro').fill('-13.5');
  await page.getByLabel('Longitud del centro').fill('-72.1');
  await page.getByLabel('Radio del mapa (km)').fill('25');
  await page.getByLabel('Tipo de establecimiento').selectOption('ESTABLO');
  await page.getByLabel('Producto Spot').selectOption('CARNE_EN_CANAL');
  await page.getByLabel('Categoría Spot').fill('TORETE');
  await page.getByLabel('Calidad Spot').fill('PRIMERA');
  await page.getByLabel('Ubigeo Spot').fill('150101');
  const [mapa, spot] = await Promise.all([
    page.waitForRequest(request => request.url().includes('/establecimientos/cercanos?') && new URL(request.url()).searchParams.get('radio_km') === '25'),
    page.waitForRequest(request => request.url().includes('/cotizaciones/pizarra?') && new URL(request.url()).searchParams.get('producto') === 'CARNE_EN_CANAL'),
    page.getByRole('button', { name: 'Consultar mercado', exact: true }).click()
  ]);
  const geo = new URL(mapa.url()).searchParams;
  expect(Object.fromEntries(geo)).toEqual({ lat: '-13.5', lon: '-72.1', radio_km: '25', tipo: 'ESTABLO', limit: '50', offset: '0' });
  const comercial = new URL(spot.url()).searchParams;
  expect(Object.fromEntries(comercial)).toEqual({ producto: 'CARNE_EN_CANAL', categoria: 'TORETE', calidad: 'PRIMERA', ubigeo: '150101', limit: '50', offset: '0' });
  await expect(page.getByText('No se encontraron establecimientos para esta consulta.')).toBeVisible();
  await expect(page.getByText('No hay cotizaciones disponibles para esta consulta.')).toBeVisible();
});

test('el pasaporte usa el identificador solicitado y la auditoría refleja el resultado de la API', async ({ page }) => {
  await installSession(page);
  const ids: string[] = [];
  await page.route('**/api/v1/trazabilidad/bovinos/*/pasaporte', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    ids.push(id);
    return route.fulfill({ json: {
      vista: 'COMPLETA',
      bovino: { id, codigo_arete: 'ARETE-' + id, organizacion_id: 'org-a', raza: null, sexo: 'MACHO', fecha_nacimiento: null, estado: 'VIVO' },
      eventos: []
    } });
  });
  await page.route('**/api/v1/trazabilidad/bovinos/cow-17/verificar', route => route.fulfill({ json: { integro: false, total_eventos: 2, secuencia_corrupta: 2, detalle: 'La secuencia 2 no coincide.' } }));
  await page.goto('/trazabilidad/cow-17');
  await expect(page.getByRole('heading', { name: 'ARETE-cow-17', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verificar cadena', exact: true }).click();
  await expect(page.getByText('El servidor detectó una inconsistencia en la cadena.')).toBeVisible();
  await expect(page.getByText('La secuencia 2 no coincide.')).toBeVisible();
  await page.goto('/trazabilidad/cow-18');
  await expect(page.getByRole('heading', { name: 'ARETE-cow-18', exact: true })).toBeVisible();
  await expect(page.getByText('ARETE-cow-17', { exact: true })).toHaveCount(0);
  expect(ids).toContain('cow-17');
  expect(ids).toContain('cow-18');
});

test('un rechazo de trazabilidad no muestra el pasaporte y la vista pública no consulta datos privados', async ({ page }) => {
  await installSession(page);
  let consultas = 0;
  await page.route('**/api/v1/trazabilidad/bovinos/*/pasaporte', route => {
    consultas++;
    return route.fulfill({ status: 403, json: { message: 'Bovino de otra organización.' } });
  });
  await page.goto('/trazabilidad/ajeno');
  await expect(page.getByRole('alert').filter({ hasText: 'Acceso denegado' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verificar cadena', exact: true })).toHaveCount(0);
  // La ruta del QR consulta SIN token y muestra el rechazo de la API, sin datos.
  const autorizaciones: (string | undefined)[] = [];
  page.on('request', r => { if (r.url().includes('/pasaporte')) autorizaciones.push(r.headers()['authorization']); });
  await page.goto('/trazabilidad/ajeno/publico');
  await expect(page.getByRole('alert').filter({ hasText: 'Acceso denegado' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verificar cadena', exact: true })).toHaveCount(0);
  expect(consultas).toBe(2);
  expect(autorizaciones).toEqual([undefined]);
});

test('los nombres del mapa se muestran como texto y no ejecutan HTML recibido por la API', async ({ page }) => {
  await blockMapTiles(page);
  const nombre = '<img src=x onerror="window.__mapXss=1">';
  await page.route('**/api/v1/establecimientos/cercanos?**', route => route.fulfill({ json: { total: 1, establecimientos: [
    { id: 'est-safe', nombre_comercial: nombre, tipo: 'ESTABLO', latitud: -12.04, longitud: -77.03, direccion_texto: '<script>window.__mapXss=2</script>', distancia_km: 1.5, ubicacion_aproximada: false }
  ] } }));
  await page.route('**/api/v1/cotizaciones/pizarra?**', route => route.fulfill({ json: { total: 0, cotizaciones: [] } }));
  await page.goto('/');
  await page.getByRole('button').filter({ hasText: nombre }).click();
  const popup = page.locator('.leaflet-popup-content');
  await expect(popup).toContainText(nombre);
  await expect(popup.locator('img,script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __mapXss?: number }).__mapXss)).toBeUndefined();
});

test('las respuestas malformadas se rechazan con un error visible sin romper el navegador', async ({ page }) => {
  const erroresDelNavegador: string[] = [];
  page.on('pageerror', error => erroresDelNavegador.push(error.message));
  await blockMapTiles(page);
  await installSession(page);
  await page.route('**/api/v1/establecimientos/cercanos?**', route => route.fulfill({ json: { establecimientos: [null] } }));
  await page.route('**/api/v1/cotizaciones/pizarra?**', route => route.fulfill({ json: { cotizaciones: [{ id: 'invalid-price', producto: null }] } }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'La API no devolvió una lista de establecimientos válida.' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'La API no devolvió una lista de cotizaciones válida.' })).toBeVisible();
  await page.route('**/api/v1/trazabilidad/bovinos/cow-invalid/pasaporte', route => route.fulfill({ json: {
    bovino: { id: 'cow-invalid', codigo_arete: 'ARETE-INVALIDO', organizacion_id: 'org-a', raza: null, sexo: 'MACHO', fecha_nacimiento: null, estado: 'VIVO' },
    eventos: [{ bovino_id: 'cow-invalid', secuencia: 1, event_type: 'PESAJE', metadata: {} }]
  } }));
  await page.goto('/trazabilidad/cow-invalid');
  await expect(page.getByRole('alert').filter({ hasText: 'La API no devolvió un pasaporte válido' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ARETE-INVALIDO', exact: true })).toHaveCount(0);
  expect(erroresDelNavegador).toEqual([]);
});
