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

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await ready;
  app.server.emit('request', request, response);
}
