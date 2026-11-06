import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';

// A test-only HTTP upstream verifies the built web proxy; no business API is simulated in the app.
let upstream;
let web;
let origin;
before(async () => {
  upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ url: request.url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString() }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  web = spawn(process.execPath, [resolve('apps/web/build/index.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin,
      API_INTERNAL_URL: `http://127.0.0.1:${upstream.address().port}`, PUBLIC_API_URL: '', PUBLIC_WS_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('La web compilada no arrancó en 10 segundos.')), 10_000);
    web.stdout.on('data', chunk => { if (String(chunk).includes('Listening on')) { clearTimeout(timer); resolve(); } });
    web.once('error', error => { clearTimeout(timer); reject(error); });
    web.once('exit', code => { clearTimeout(timer); reject(new Error(`La web terminó al arrancar (${code}).`)); });
  });
});
after(async () => {
  if (web && web.exitCode === null) { web.kill(); await once(web, 'exit'); }
  if (upstream) await new Promise(resolve => upstream.close(resolve));
});

test('proxy compilado utiliza el destino privado del entorno y transmite consulta/Bearer sin cookies', async () => {
  const response = await fetch(`${origin}/api/v1/auth/me?consulta=prueba`, {
    headers: { Authorization: 'Bearer fixture-only', Cookie: 'private_cookie=must-not-forward', 'X-Untrusted': 'must-not-forward' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.url, '/api/v1/auth/me?consulta=prueba');
  assert.equal(body.headers.authorization, 'Bearer fixture-only');
  assert.equal(body.headers.cookie, undefined);
  assert.equal(body.headers['x-untrusted'], undefined);
});

test('proxy compilado conserva cuerpo y clave de idempotencia de una solicitud POST', async () => {
  const payload = JSON.stringify({ monto: 120, idempotency_key: 'fixture-key' });
  const response = await fetch(`${origin}/api/v1/subastas/lot-test/pujas`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture-key' }, body: payload
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.method, 'POST');
  assert.equal(body.headers['idempotency-key'], 'fixture-key');
  assert.equal(body.body, payload);
});
