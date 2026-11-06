import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../../apps/api/src/app.js';

// Mount the existing Fastify API below /api/v1 so nested REST paths are routed
// consistently by Vercel's function router.
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
  // Remove only routing metadata injected by Vercel.
  url.searchParams.delete('...path');
  url.searchParams.delete('...all');
  url.searchParams.delete('_vercel_share');
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
