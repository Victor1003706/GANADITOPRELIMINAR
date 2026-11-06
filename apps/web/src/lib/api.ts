import { get } from 'svelte/store';
import { apiUrl } from './config';
import { clearSession, session } from './session';

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) { super(message); }
}

export async function apiRequest<T>(path: string, options: RequestInit & { auth?: boolean; expectedStatus?: number } = {}): Promise<T> {
  const { auth = true, expectedStatus, ...init } = options;
  const token = auth ? get(session).token : null;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(apiUrl(path), { ...init, headers, signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (response.status === 401 && token && get(session).token === token) clearSession('expired', 'Tu sesión venció o fue revocada. Inicia sesión de nuevo.');
    let data: unknown;
    try { data = await response.json(); } catch {
      throw new ApiError('La API devolvió una respuesta no válida.', response.status || 502);
    }
    if (!response.ok) {
      const serverMessage = data && typeof data === 'object' && 'message' in data ? String(data.message) : '';
      throw new ApiError(response.status === 403 ? `Acceso denegado. ${serverMessage}`.trim() : serverMessage || `La solicitud falló (${response.status}).`, response.status, data);
    }
    if (expectedStatus !== undefined && response.status !== expectedStatus) {
      throw new ApiError('No se pudo verificar la confirmación de la operación.', response.status, data);
    }
    // A response from a previous context must never populate the new context's screen.
    if (token && get(session).token !== token) throw new ApiError('La sesión cambió. Vuelve a consultar los datos.', 409);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (init.signal?.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
    throw new ApiError(controller.signal.aborted ? 'La API tardó demasiado. Intenta de nuevo.' : 'No se pudo conectar con la API. Intenta de nuevo.', 0);
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}
