import { defineEnvVars } from '@sveltejs/kit/env';

function url(value: string | undefined, fallback: string, protocols: string[]) {
  const result = value ?? fallback;
  if (result && !protocols.includes(new URL(result).protocol)) throw new Error('Protocolo de URL no permitido.');
  return result;
}

export const variables = defineEnvVars({
  PUBLIC_API_URL: { public: true, schema: (value) => url(value, '', ['http:', 'https:']) },
  PUBLIC_WS_URL: { public: true, schema: (value) => url(value, '', ['ws:', 'wss:', 'http:', 'https:']) },
  PUBLIC_LIVE_AUCTIONS_ENABLED: { public: true, schema: (value) => value === 'true' },
  PUBLIC_DEMO_ENABLED: { public: true, schema: (value) => value === 'true' },
  API_INTERNAL_URL: { schema: (value) => url(value, 'http://127.0.0.1:4000', ['http:', 'https:']) }
});
