import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertIsolatedRealEnvironment, isolatedWebEnvironment } from './environment.mjs';

const isolated = () => ({
  GANADITO_ALLOW_REAL_E2E: 'isolated-local-fixtures',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://fixture:fictional@127.0.0.1:5432/ganadito_e2e_test',
  REDIS_URL: 'redis://127.0.0.1:6379/15',
  PAYMENTS_ENABLED: 'false'
});

test('acepta únicamente destinos literales de loopback con bases dedicadas', () => {
  for (const protocol of ['postgres', 'postgresql']) {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      assert.doesNotThrow(() => assertIsolatedRealEnvironment({
        ...isolated(),
        DATABASE_URL: `${protocol}://fixture:fictional@${host}:5432/ganadito_e2e_test`,
        REDIS_URL: `redis://${host}:6379/15`
      }));
    }
  }
});

const rejected = [
  ['flag ausente', { GANADITO_ALLOW_REAL_E2E: undefined }],
  ['flag distinto', { GANADITO_ALLOW_REAL_E2E: 'true' }],
  ['entorno de producción', { NODE_ENV: 'production' }],
  ['entorno no explícito', { NODE_ENV: undefined }],
  ['base local de desarrollo', { DATABASE_URL: 'postgres://fixture:fictional@127.0.0.1:5432/ganadito' }],
  ['base con sufijo', { DATABASE_URL: 'postgres://fixture:fictional@localhost/ganadito_e2e_test_other' }],
  ['base remota', { DATABASE_URL: 'postgresql://fixture:fictional@example.test/ganadito_e2e_test' }],
  ['base ausente', { DATABASE_URL: undefined }],
  ['query que sobrescribe host', { DATABASE_URL: 'postgres://fixture:fictional@localhost/ganadito_e2e_test?host=example.test' }],
  ['query que sobrescribe base', { DATABASE_URL: 'postgres://fixture:fictional@localhost/ganadito_e2e_test?dbname=ganadito' }],
  ['query vacía', { DATABASE_URL: 'postgres://fixture:fictional@localhost/ganadito_e2e_test?' }],
  ['fragmento', { DATABASE_URL: 'postgres://fixture:fictional@localhost/ganadito_e2e_test#ignored' }],
  ['fragmento vacío', { DATABASE_URL: 'postgres://fixture:fictional@localhost/ganadito_e2e_test#' }],
  ['host numérico abreviado', { DATABASE_URL: 'postgres://fixture:fictional@127.1/ganadito_e2e_test' }],
  ['host numérico alternativo', { DATABASE_URL: 'postgres://fixture:fictional@2130706433/ganadito_e2e_test' }],
  ['nombre de base codificado', { DATABASE_URL: 'postgres://fixture:fictional@localhost/ganadito%5fe2e_test' }],
  ['espacio en URL', { DATABASE_URL: ' postgres://fixture:fictional@localhost/ganadito_e2e_test' }],
  ['salto de línea al final de URL', { DATABASE_URL: 'postgres://fixture:fictional@localhost/ganadito_e2e_test\n' }],
  ['puerto inválido', { DATABASE_URL: 'postgres://fixture:fictional@localhost:65536/ganadito_e2e_test' }],
  ['Redis remoto', { REDIS_URL: 'redis://example.test:6379/15' }],
  ['Redis compartido', { REDIS_URL: 'redis://localhost:6379/0' }],
  ['Redis sin base', { REDIS_URL: 'redis://localhost:6379' }],
  ['Redis con query', { REDIS_URL: 'redis://localhost:6379/15?db=0' }],
  ['Redis con fragmento', { REDIS_URL: 'redis://localhost:6379/15#ignored' }],
  ['Redis ausente', { REDIS_URL: undefined }],
  ['pagos habilitados', { PAYMENTS_ENABLED: 'true' }],
  ['pagos habilitados numéricamente', { PAYMENTS_ENABLED: '1' }],
  ['pagos sin deshabilitación explícita', { PAYMENTS_ENABLED: undefined }]
];

for (const [name, override] of rejected) {
  test(`rechaza ${name} sin divulgar la conexión`, () => {
    assert.throws(() => assertIsolatedRealEnvironment({ ...isolated(), ...override }), error => {
      assert.match(error.message, /real E2E/i);
      assert.doesNotMatch(error.message, /fictional|postgres:\/\/|redis:\/\/|example\.test/);
      return true;
    });
  });
}

test('el launcher rechaza antes de importar el backend o cargar variables .env', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, ...isolated(), GANADITO_ALLOW_REAL_E2E: '' },
    encoding: 'utf8', timeout: 5_000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /real E2E/i);
  assert.doesNotMatch(result.stderr, /ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND|fictional|postgres:\/\//);
});

test('la web compilada exige un SHA completo sin divulgar otros valores de entorno', () => {
  for (const release of [undefined, 'development', 'abc123', `${'a'.repeat(40)}\n`]) {
    assert.throws(() => isolatedWebEnvironment({ ...isolated(), GANADITO_RELEASE_SHA: release }), error => {
      assert.match(error.message, /SHA/i);
      assert.doesNotMatch(error.message, /fictional|postgres:\/\//);
      return true;
    });
  }
});

test('el proceso web recibe solo configuración pública y su upstream de loopback', () => {
  const env = isolatedWebEnvironment({
    ...isolated(), GANADITO_RELEASE_SHA: 'a'.repeat(40), PATH: 'fixture-toolchain',
    JWT_SECRET: 'must-not-pass', PUBLIC_OTHER_SECRET: 'must-not-pass',
    API_INTERNAL_URL: 'https://must-not-pass.example.test', PUBLIC_API_URL: 'https://must-not-pass.example.test',
    PUBLIC_LIVE_AUCTIONS_ENABLED: 'true', NODE_OPTIONS: '--require must-not-pass'
  });
  assert.deepEqual(env, {
    PATH: 'fixture-toolchain', NODE_ENV: 'production', GANADITO_RELEASE_SHA: 'a'.repeat(40),
    HOST: '127.0.0.1', PORT: '4180', ORIGIN: 'http://127.0.0.1:4180',
    API_INTERNAL_URL: 'http://127.0.0.1:4181', PUBLIC_API_URL: '', PUBLIC_WS_URL: '',
    PUBLIC_LIVE_AUCTIONS_ENABLED: 'false'
  });
});

test('el launcher web rechaza antes de importar Vite o construir el artefacto', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./web.mjs', import.meta.url)), '--build-only'], {
    env: { ...process.env, ...isolated(), GANADITO_ALLOW_REAL_E2E: '' },
    encoding: 'utf8', timeout: 5_000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /real E2E/i);
  assert.doesNotMatch(result.stderr, /ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND|fictional|postgres:\/\//);
});
