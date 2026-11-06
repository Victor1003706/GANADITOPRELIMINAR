import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../apps/api/src/app.js';

// Reutiliza Fastify y el pool entre solicitudes atendidas por la misma instancia.
const app = buildApp({ logger: false });
const ready = app.ready();

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true
  }
};

function normalizeVercelRequest(request: IncomingMessage): void {
  const url = new URL(request.url ?? '/', 'http://localhost');
  // Vercel agrega estos parámetros al enrutar una función catch-all. No pertenecen
  // a la API ni deben aparecer en los logs o llegar a los controladores.
  url.searchParams.delete('...all');
  url.searchParams.delete('_vercel_share');

  // Fastify expone el health check en /health, mientras que los clientes usan
  // /api/health para las funciones de Vercel.
  if (url.pathname === '/api/health') {
    url.pathname = '/health';
  }

  request.url = `${url.pathname}${url.search}`;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await ready;
  normalizeVercelRequest(request);
  app.server.emit('request', request, response);
}
