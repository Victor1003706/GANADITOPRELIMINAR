import { test, expect } from '@playwright/test';
import { fakeToken, installSession, profile } from './fixtures';

for (const registration of [
  { role: 'COMPRADOR', organization: 'org-a', label: 'Ganadería A' },
  { role: 'VENDEDOR', organization: 'org-b', label: 'Ganadería B' }
]) {
  test(`registro ${registration.role} envía la intención y usa el contexto confirmado`, async ({ page }) => {
    const token = fakeToken(registration.organization, registration.role);
    await page.route('**/api/v1/auth/register', async route => {
      expect(route.request().postDataJSON()).toEqual({
        email: 'registro@example.test', password: 'registration-password', nombre: 'Persona de prueba',
        organizacion_nombre: 'Organización de prueba', rol_inicial: registration.role
      });
      await route.fulfill({ status: 201, json: { access_token: token, active_context: profile(registration.organization, registration.role).activeContext } });
    });
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: profile(registration.organization, registration.role) }));
    await page.goto('/acceso');
    await page.getByRole('button', { name: 'Crear una cuenta', exact: true }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Persona de prueba');
    await page.getByLabel('Nombre de la organización', { exact: true }).fill('Organización de prueba');
    const role = page.getByRole('combobox', { name: 'Quiero operar como', exact: true });
    await expect(role).toHaveValue('COMPRADOR');
    expect(await role.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
      .toEqual(['COMPRADOR', 'VENDEDOR']);
    await role.selectOption(registration.role);
    await page.getByLabel('Correo electrónico').fill('registro@example.test');
    await page.getByLabel('Contraseña', { exact: true }).fill('registration-password');
    await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await expect(page).toHaveURL(/\/contexto$/);
    await expect(page.getByText('Organización activa:')).toContainText(registration.label);
    await expect(page.getByText('Rol activo:', { exact: false })).toContainText(registration.role);
  });
}

test('acceso, cambio confirmado de organización y cierre de sesión', async ({ page }) => {
  let organization = 'org-a';
  let role = 'COMPRADOR';
  const initialToken = fakeToken();
  await page.route('**/api/v1/auth/login', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'victor@example.test', password: 'correct-password' });
    await route.fulfill({ json: { access_token: initialToken, active_context: profile().activeContext } });
  });
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: profile(organization, role) }));
  await page.route('**/api/v1/auth/organizations/switch-context', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${initialToken}`);
    expect(route.request().postDataJSON()).toEqual({ organizacion_id: 'org-b', rol: 'VENDEDOR' });
    organization = 'org-b'; role = 'VENDEDOR';
    await route.fulfill({ json: { access_token: fakeToken(organization, role), active_context: profile(organization, role).activeContext } });
  });
  await page.goto('/acceso');
  await page.getByLabel('Correo electrónico').fill('victor@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/contexto$/);
  await expect(page.getByText('Organización activa:')).toContainText('Ganadería A');
  await page.getByRole('button', { name: 'Usar Ganadería B como VENDEDOR' }).click();
  await expect(page.getByText('Organización activa:')).toContainText('Ganadería B');
  await expect(page.getByText('Rol activo:', { exact: false })).toContainText('VENDEDOR');
  await page.reload();
  await expect(page.getByText('Organización activa:')).toContainText('Ganadería B');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByText('Inicia sesión para consultar tus organizaciones.')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('ganadito.session.token'))).toBeNull();
});

test('credenciales rechazadas no crean sesión', async ({ page }) => {
  await page.route('**/api/v1/auth/login', route => route.fulfill({ status: 401, json: { message: 'Credenciales inválidas.' } }));
  await page.goto('/acceso');
  await page.getByLabel('Correo electrónico').fill('victor@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Credenciales inválidas');
  expect(await page.evaluate(() => sessionStorage.getItem('ganadito.session.token'))).toBeNull();
});

test('403 al cambiar organización conserva el contexto confirmado', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/auth/organizations/switch-context', route => route.fulfill({ status: 403, json: { message: 'Membresía revocada.' } }));
  await page.goto('/contexto');
  await page.getByRole('button', { name: 'Usar Ganadería B como VENDEDOR' }).click();
  await expect(page.getByRole('alert')).toContainText('Acceso denegado');
  await expect(page.getByText('Organización activa:')).toContainText('Ganadería A');
});

test('401 al validar sesión borra el acceso y pide autenticación', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, json: { message: 'Token revocado.' } }));
  await page.goto('/contexto');
  await expect(page.getByRole('alert')).toContainText('sesión venció o fue revocada');
  await expect(page.getByText('Inicia sesión para consultar tus organizaciones.')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('ganadito.session.token'))).toBeNull();
});

test('contexto del perfil distinto del token no se presenta como sesión válida', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: profile('org-b', 'VENDEDOR') }));
  await page.goto('/contexto');
  await expect(page.getByRole('alert')).toContainText('contexto');
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
});

test('una respuesta 401 sin JSON también revoca la sesión local', async ({ page }) => {
  await installSession(page);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, contentType: 'text/plain', body: 'Unauthorized' }));
  await page.goto('/contexto');
  await expect(page.getByRole('alert')).toContainText('revocada');
  expect(await page.evaluate(() => sessionStorage.getItem('ganadito.session.token'))).toBeNull();
});

test('cambiar de contexto cancela el vencimiento del token anterior durante la validación', async ({ page }) => {
  await page.clock.install();
  const oldToken = fakeToken('org-a', 'COMPRADOR', Math.floor(Date.now() / 1000) + 4);
  await page.addInitScript(token => sessionStorage.setItem('ganadito.session.token', token), oldToken);
  let switched = false;
  let release: (() => void) | undefined;
  await page.route('**/api/v1/auth/me', async route => {
    if (switched) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: switched ? profile('org-b', 'VENDEDOR') : profile() });
  });
  await page.route('**/api/v1/auth/organizations/switch-context', async route => {
    switched = true;
    await route.fulfill({ json: { access_token: fakeToken('org-b', 'VENDEDOR'), active_context: profile('org-b', 'VENDEDOR').activeContext } });
  });
  await page.goto('/contexto');
  await page.getByRole('button', { name: 'Usar Ganadería B como VENDEDOR' }).click();
  await expect.poll(() => !!release).toBe(true);
  await page.clock.runFor(5000);
  release!();
  await expect(page.getByText('Organización activa:')).toContainText('Ganadería B');
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});

test('módulos posteriores no ejecutan simulaciones ni solicitudes externas', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/v1/')) requests.push(request.url()); });
  for (const path of ['/ia', '/tributario', '/logistica', '/gmx', '/mayorista']) {
    await page.goto(path);
    await expect(page.getByText('Este módulo todavía no está habilitado para operar.')).toBeVisible();
  }
  expect(requests).toEqual([]);
});

test('navegación móvil permite acceder a las pantallas principales', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/acceso');
  for (const name of ['Mapa y Spot', 'Subastas', 'Órdenes', 'Trazabilidad']) await expect(page.getByRole('navigation').getByRole('link', { name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
