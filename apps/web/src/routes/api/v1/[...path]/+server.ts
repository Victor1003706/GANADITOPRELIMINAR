import { API_INTERNAL_URL } from '$app/env/private';
import type { RequestHandler } from './$types';

const forward: RequestHandler = async ({ request, params, url, fetch }) => {
  const segments = (params.path ?? '').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\?#]/.test(segment))) {
    return Response.json({ message: 'Ruta de API no válida.' }, { status: 400 });
  }
  const base = API_INTERNAL_URL;
  const target = new URL(`/api/v1/${segments.map(encodeURIComponent).join('/')}`, base);
  target.search = url.search;
  const headers = new Headers({ Accept: 'application/json' });
  for (const name of ['authorization', 'content-type', 'idempotency-key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(target, {
      method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: AbortSignal.timeout(15_000), redirect: 'error', credentials: 'omit'
    });
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
    } });
  } catch {
    return Response.json({ message: 'La API no está disponible. Intenta de nuevo.' }, { status: 502 });
  }
};
export const GET = forward;
export const POST = forward;
