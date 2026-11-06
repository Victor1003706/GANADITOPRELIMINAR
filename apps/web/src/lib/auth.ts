import { get } from 'svelte/store';
import { apiRequest } from './api';
import { beginSessionValidation, clearSession, session, sessionStorageKey, setSession, type Membership, type SessionUser } from './session';

interface Profile { user: SessionUser; activeContext: Membership | null; memberships: Membership[] }
interface AuthResponse { access_token: string; user?: SessionUser; active_context: Membership | null }
export type RegistrationRole = 'COMPRADOR' | 'VENDEDOR';
let generation = 0;

async function loadProfile(token: string, currentGeneration: number) {
  beginSessionValidation(token);
  try {
    const profile = await apiRequest<Profile>('/api/v1/auth/me');
    if (generation === currentGeneration) setSession(token, profile.user, profile.activeContext, profile.memberships);
  } catch (error) {
    if (generation === currentGeneration && get(session).status !== 'expired') clearSession('error', error instanceof Error ? error.message : 'No se pudo validar la sesión.');
    throw error;
  }
}

export async function restoreSession() {
  const token = sessionStorage.getItem(sessionStorageKey);
  if (token) await loadProfile(token, ++generation);
}

export async function signIn(email: string, password: string) {
  const current = ++generation;
  const result = await apiRequest<AuthResponse>('/api/v1/auth/login', { auth: false, method: 'POST', body: JSON.stringify({ email, password }) });
  if (current === generation) await loadProfile(result.access_token, current);
}

export async function registerAccount(data: { email: string; password: string; nombre: string; organizacion_nombre: string; rol_inicial: RegistrationRole }) {
  const current = ++generation;
  const result = await apiRequest<AuthResponse>('/api/v1/auth/register', { auth: false, method: 'POST', expectedStatus: 201, body: JSON.stringify(data) });
  if (current === generation) await loadProfile(result.access_token, current);
}

export async function switchContext(membership: Membership) {
  const current = ++generation;
  const result = await apiRequest<AuthResponse>('/api/v1/auth/organizations/switch-context', {
    method: 'POST', body: JSON.stringify({ organizacion_id: membership.organizacion_id, rol: membership.rol })
  });
  if (current === generation) await loadProfile(result.access_token, current);
}

export function signOut() { generation++; clearSession(); }
