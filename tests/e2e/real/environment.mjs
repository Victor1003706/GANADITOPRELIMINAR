// Pure validation: importing this module never loads .env files or backend modules.
// Match the literal destination as well as URL syntax; URL normalization must not
// turn an abbreviated/numeric hostname or encoded database name into an allowlist hit.
const loopback = '(?:127\\.0\\.0\\.1|localhost|\\[::1\\])';
const authority = `(?:[^\\s/?#@\\\\]*@)?${loopback}(?::([1-9]\\d{0,4}))?`;
const database = new RegExp(`^postgres(?:ql)?://${authority}/ganadito_e2e_test$`);
const redis = new RegExp(`^redis://${authority}/15$`);

function requireDestination(value, pattern, name) {
  const match = typeof value === 'string' ? pattern.exec(value) : null;
  if (!match || (match[1] && Number(match[1]) > 65535)) {
    throw new Error(`[real E2E] ${name} debe apuntar al destino literal de loopback aislado, sin query ni fragmento.`);
  }
  try { new URL(value); }
  catch { throw new Error(`[real E2E] ${name} no es una URL válida para pruebas aisladas.`); }
}

export function assertIsolatedRealEnvironment(env) {
  if (env.GANADITO_ALLOW_REAL_E2E !== 'isolated-local-fixtures') {
    throw new Error('[real E2E] Falta la autorización explícita del entorno aislado GANADITO_ALLOW_REAL_E2E.');
  }
  if (env.NODE_ENV !== 'test') throw new Error('[real E2E] NODE_ENV debe ser test.');
  requireDestination(env.DATABASE_URL, database, 'DATABASE_URL');
  requireDestination(env.REDIS_URL, redis, 'REDIS_URL');
  if (env.PAYMENTS_ENABLED !== 'false') throw new Error('[real E2E] PAYMENTS_ENABLED debe ser false explícitamente.');
}

// Never forward API credentials, inherited PUBLIC_* values or Node preload options
// to Vite/adapter-node. This is also used before importing the build toolchain.
export function isolatedWebEnvironment(env) {
  assertIsolatedRealEnvironment(env);
  if (typeof env.GANADITO_RELEASE_SHA !== 'string' || !/^[a-f0-9]{40}$/.test(env.GANADITO_RELEASE_SHA)) {
    throw new Error('[real E2E] GANADITO_RELEASE_SHA debe ser el SHA completo del checkout probado.');
  }
  const safe = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'Path', 'CI']) {
    if (env[key] !== undefined) safe[key] = env[key];
  }
  return {
    ...safe, NODE_ENV: 'production', GANADITO_RELEASE_SHA: env.GANADITO_RELEASE_SHA,
    HOST: '127.0.0.1', PORT: '4180', ORIGIN: 'http://127.0.0.1:4180',
    API_INTERNAL_URL: 'http://127.0.0.1:4181', PUBLIC_API_URL: '', PUBLIC_WS_URL: '',
    PUBLIC_LIVE_AUCTIONS_ENABLED: 'false'
  };
}
