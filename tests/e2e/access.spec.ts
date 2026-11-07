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
  await expect(