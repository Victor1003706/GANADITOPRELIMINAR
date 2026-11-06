import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from './app.js';
import { redactarUrl, VALOR_REDACTADO } from './log-redaction.js';

// Marcador ficticio: no es un JWT real.
const MARCADOR = 'MARCADOR_FICTICIO_NO_ES_UN_JWT_123';

describe('Redacción de credenciales en logs (P1 #33)', () => {
  test('redactarUrl reemplaza access_token y otros parámetros sensibles y conserva el resto', () => {
    assert.strictEqual(
      redactarUrl(`/api/v1/subastas/abc/live?access_token=${MARCADOR}&x=1`),
      `/api/v1/subastas/abc/live?access_token=${VALOR_REDACTADO}&x=1`
    );
    assert.strictEqual(redactarUrl(`/a?Access_Token=${MARCADOR}`), `/a?Access_Token=${VALOR_REDACTADO}`);
    assert.strictEqual(redactarUrl(`/a?access%5Ftoken=${MARCADOR}`), `/a?access%5Ftoken=${VALOR_REDACTADO}`);
    assert.strictEqual(redactarUrl(`/a?token=${MARCADOR}`), `/a?token=${VALOR_REDACTADO}`);
    assert.strictEqual(redactarUrl('/a?pagina=2'), '/a?pagina=2');
    assert.strictEqual(redactarUrl('/sin-consulta'), '/sin-consulta');
  });

  test('con logger activo, ninguna línea de log contiene el token enviado por URL', async () => {
    const lineas: string[] = [];
    const captura = new Writable({
      write(chunk, _enc, done) {
        lineas.push(chunk.toString());
        done();
      }
    });

    const app = buildApp({ logger: true, logStream: captura });
    try {
      await app.ready();
      // Ruta del WS (sin upgrade), ruta inexistente y lote inexistente: todos registran la petición.
      await app.inject({
        method: 'GET',
        url: `/api/v1/subastas/00000000-0000-0000-0000-000000000000/live?access_token=${MARCADOR}`
      });
      await app.inject({ method: 'GET', url: `/api/v1/no-existe?access_token=${MARCADOR}` });
      await app.inject({ method: 'GET', url: `/api/v1/subastas/no-es-uuid/snapshot?token=${MARCADOR}` });
    } finally {
      await app.close();
    }

    const log = lineas.join('');
    assert.ok(log.length > 0, 'Se esperaba que el logger escribiera líneas');
    assert.ok(!log.includes(MARCADOR), 'El token apareció en los logs');
    assert.ok(log.includes(VALOR_REDACTADO), 'Se esperaba la URL redactada en los logs');
  });
});
