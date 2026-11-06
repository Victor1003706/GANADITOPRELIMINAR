import { writable } from 'svelte/store';
import type { RolOrganizacion } from '@ganadito/contracts';

export interface SessionUser { id: string; email: string; nombre: string }
export interface Membership {
  organizacion_id: string;
  razon_social: string;
  rol: RolOrganizacion;
  is_active_context?: boolean;
}
export interface SessionState {
  token: string | null;
  user: SessionUser | null;
  organizationId: string | null;
  role: RolOrganizacion | null;
  context: Membership | null;
  memberships: Membership[];
  status: 'anonymous' | 'checking' | 'authenticated' | 'expired' | 'error';
  message: string;
}
const empty: SessionState = {
  token: null, user: null, organizationId: null, role: null, context: null,
  memberships: [], status: 'anonymous', message: ''
};
export const session = writable<SessionState>({ ...empty });
export const sessionStorageKey = 'ganadito.session.token';
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

export function beginSessionValidation(token: string) {
  clearTimeout(expiryTimer);
  session.set({ ...empty, token, status: 'checking' });
}

export function clearSession(status: SessionState['status'] = 'anonymous', message = '') {
  clearTimeout(expiryTimer);
  if (typeof window !== 'undefined') sessionStorage.removeItem(sessionStorageKey);
  session.set({ ...empty, status, message });
}

// Decoding is used only for expiry/display consistency. The API verifies the JWT.
export function tokenContext(token: string): { exp: number; user_id: string; active_organization_id?: string; active_role?: string } {
  const part = token.split('.')[1];
  if (!part) throw new Error('La API devolvió un token incompleto.');
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = JSON.parse(atob(normalized));
  if (!Number.isFinite(decoded.exp)) throw new Error('La sesión no incluye vencimiento.');
  return decoded;
}

export function setSession(token: string, user: SessionUser, context: Membership | null, memberships: Membership[]) {
  const claims = tokenContext(token);
  if (!user || typeof user.id !== 'string' || user.id !== claims.user_id || !Array.isArray(memberships)) {
    throw new Error('La API devolvió un perfil de sesión no válido.');
  }
  if (claims.exp * 1000 <= Date.now()) {
    clearSession('expired', 'Tu sesión venció. Inicia sesión de nuevo.');
    throw new Error('Tu sesión venció.');
  }
  if ((claims.active_organization_id ?? null) !== (context?.organizacion_id ?? null) ||
      (claims.active_role ?? null) !== (context?.rol ?? null)) {
    clearSession('error', 'El contexto de la API cambió. Inicia sesión de nuevo para sincronizarlo.');
    throw new Error('El contexto de la API no coincide con el token de esta sesión.');
  }
  clearTimeout(expiryTimer);
  sessionStorage.setItem(sessionStorageKey, token);
  session.set({ token, user, context, organizationId: context?.organizacion_id ?? null,
    role: context?.rol ?? null, memberships, status: 'authenticated', message: '' });
  expiryTimer = setTimeout(() => clearSession('expired', 'Tu sesión venció. Inicia sesión de nuevo.'),
    Math.min(claims.exp * 1000 - Date.now(), 2_147_483_647));
}
