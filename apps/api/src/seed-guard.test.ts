import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarDestinoSeed } from './seed/seed.js';

// Hosts ficticios: nunca se abre conexión en estas pruebas.
const env = (extra: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...extra });

describe('Guardia del seed: destino efectivo de la conexión (P1 #26)', () => {
  test('acepta destinos locales permitidos', () => {
    assert.strictEqual(validarDestinoSeed(env({ DATABASE_URL: 'postgres://u:p@localhost:5432/ganadito' })), null);
    assert.strictEqual(validarDestinoSeed(env({ DATABASE_URL: 'postgresql://u:p@ganadito-postgres/ganadito' })), null);
    assert.strictEqual(validarDestinoSeed(env({ DATABASE_URL: 'postgres://u:p@[::1]:5432/ganadito' })), null);
    assert.strictEqual(validarDestinoSeed(env({ DATABASE_HOST: '127.0.0.1' })), null);
    assert.strictEqual(validarDestinoSeed(env({})), null);
  });

  test('rechaza que ?host= u otros parámetros sustituyan el destino de una URL aparentemente local', () => {
    for (const url of [
      'postgres://u:p@localhost:5432/ganadito?host=prod.example.invalid',
      'postgres://u:p@localhost/ganadito?HOST=prod.example.invalid',
      'postgres://u:p@localhost/ganadito?sslmode=disable&hostaddr=203.0.113.10',
      'postgres://u:p@localhost/ganadito?port=6543',
      'postgres://u:p@localhost/ganadito?socket=/tmp'
    ]) {
      const motivo = validarDestinoSeed(env({ DATABASE_URL: url }));
      assert.ok(motivo, `Debía rechazarse: ${url}`);
      assert.match(motivo!, /sustituye el destino/);
    }
  });

  test('rechaza hosts remotos, URLs sin host, sockets y protocolos ajenos', () => {
    for (const url of [
      'postgres://u:p@prod.example.invalid/ganadito',
      'postgres://u:p@localhost.example.invalid/ganadito',
      'postgres:///ganadito',
      '/var/run/postgresql ganadito',
      'socket://u:p@/var/run/postgresql?db=ganadito',
      'mysql://u:p@localhost/ganadito',
      'no-es-una-url'
    ]) {
      assert.ok(validarDestinoSeed(env({ DATABASE_URL: url })), `Debía rechazarse: ${url}`);
    }
    assert.ok(validarDestinoSeed(env({ DATABASE_HOST: 'prod.example.invalid' })));
    assert.ok(validarDestinoSeed({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@localhost/ganadito' }));
  });

  test('el script de seed aborta con código 1 antes de conectar si la URL lleva ?host=', () => {
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/seed/seed.ts'], {
      cwd: raiz,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // Puerto 1 en un host reservado: si llegara a conectar, fallaría por otro motivo.
        DATABASE_URL: 'postgres://u:p@localhost:5432/ganadito?host=prod.example.invalid&port=1'
      }
    });
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, /sustituye el destino/);
    assert.doesNotMatch(r.stdout, /Verificando y aplicando migraciones/);
  });
});
