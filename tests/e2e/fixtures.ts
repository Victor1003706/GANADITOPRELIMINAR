import type { Page } from '@playwright/test';

export function fakeToken(organizationId = 'org-a', role = 'COMPRADOR', expiry = Math.floor(Date.now() / 1000) + 900) {
  const payload = Buffer.from(JSON.stringify({ user_id: 'user-a', email: 'victor@example.test', active_organization_id: organizationId, active_role: role, exp: expiry })).toString('base64url');
  return `fixture.${payload}.not-a-real-signature`;
}
export function profile(organizationId = 'org-a', role = 'COMPRADOR') {
  const memberships = [
    { organizacion_id: 'org-a', razon_social: 'Ganadería A', rol: 'COMPRADOR', is_active_context: organizationId === 'org-a' },
    { organizacion_id: 'org-b', razon_social: 'Ganadería B', rol: 'VENDEDOR', is_active_context: organizationId === 'org-b' }
  ];
  return { user: { id: 'user-a', nombre: 'Víctor de prueba', email: 'victor@example.test' }, memberships,
    activeContext: memberships.find(m => m.organizacion_id === organizationId && m.rol === role) ?? null };
}
// These fixtures run exclusively inside Playwright. They do not replace production API calls.
export async function installSession(page: Page, options: { organizationId?: string; role?: string } = {}) {
  const { organizationId = 'org-a', role = 'COMPRADOR' } = options;
  const token = fakeToken(organizationId, role);
  await page.addInitScript(token => sessionStorage.setItem('ganadito.session.token', token), token);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: profile(organizationId, role) }));
  // Catálogo vacío por defecto (las pruebas que lo necesitan lo sobrescriben).
  await page.route('**/api/v1/subastas?*', route => route.fulfill({ json: { data: [], next_cursor: null } }));
  // Ticket de un solo uso para el WebSocket (POST /live/ticket): uno distinto por pedido.
  let emitidos = 0;
  await page.route('**/api/v1/subastas/*/live/ticket', route => {
    emitidos += 1;
    return route.fulfill({ status: 201, json: { ticket: 'ticket-fixture-' + String(emitidos).padStart(4, '0') + '-' + 'x'.repeat(24), expira_en_segundos: 30 } });
  });
  return token;
}
