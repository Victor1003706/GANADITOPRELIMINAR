import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../apps/api/src/app.js';

const app = buildApp({ logger: false });
const ready = app.ready();

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true
  }
};

function normalizeVercelRequest(request: IncomingMessage): void {
  const incoming = new URL(request.url ?? '/', 'http://localhost');
  const originalPath = incoming.searchParams.get('__ganadito_path');
  const forwarded = originalPath
    ? new URL(originalPath, 'http://localhost')
    : incoming;
  forwarded.search = incoming.search;
  forwarded.searchParams.delete('__ganadito_path');
  forwarded.searchParams.delete('...all');
  forwarded.searchParams.delete('_vercel_share');

  // Fastify serves health at /health while public clients use /api/health.
  if (forwarded.pathname === '/api/health') forwarded.pathname = '/health';
  request.url = `${forwarded.pathname}${forwarded.search}`;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await ready;
  normalizeVercelRequest(request);
  app.server.emit('request', request, response);
}
