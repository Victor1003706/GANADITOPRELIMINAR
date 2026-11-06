import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { getPool, closePool, runInitialMigration } from './db.js';
import { getRedisPublisher, getRedisSubscriber, closeRedis } from './redis.js';
import { procesarLoteOutbox, OutboxWorker } from './outbox/outbox.worker.js';
import { SubastaWsHub } from './subastas/subastas.ws.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';

describe('Procesador Transactional Outbox y Difusión WebSocket en Tiempo Real', () => {
  const pool = getPool();
  const redisPublisher = getRedisPublisher();
  const redisSubscriber = getRedisSubscriber();
  const wsHub = new SubastaWsHub(redisSubscriber);
  const app = buildApp({ pool, redisSubscriber, wsHub });
  const authService = new AuthService(pool);

  let serverPort: number;
  let serverHost: string;

  before(async () => {
    await runInitialMigration();
    // Limpiar eventos remanentes de ejecuciones previas para aislamiento determinista
    await pool.query("UPDATE outbox_events SET status = 'PROCESADO' WHERE status IN ('PENDIENTE', 'PROCESANDO')");

    // Iniciar servidor en puerto libre para pruebas reales de WebSocket
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as any;
    serverPort = address.port;
    serverHost = '127.0.0.1';
  });

  after(async () => {
    await app.close();
    await wsHub.close();
    await closeRedis();
    await closePool();
  });

  test('1. Polling de outbox_events y transición a PROCESADO con incremento de fencing_token', async () => {
    const aggregateId = `subasta-test-outbox-${Date.now()}`;
    const testPayload = { loteId: aggregateId, monto: 1200, mensaje: 'Puja de prueba' };

    // Insertar evento en estado PENDIENTE con fencing_token inicial = 0
    const insertRes = await pool.query<{ id: string; fencing_token: number }>(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status, fencing_token)
       VALUES ('LOTE_SUBASTA', $1, 'PUJA_ACEPTADA', $2, 'PENDIENTE', 0)
       RETURNING id, fencing_token`,
      [aggregateId, JSON.stringify(testPayload)]
    );
    const eventId = insertRes.rows[0]!.id;
    assert.strictEqual(insertRes.rows[0]!.fencing_token, 0);

    // Procesar lote con el worker hasta alcanzar el evento
    let processed = false;
    for (let i = 0; i < 5; i++) {
      const batchResult = await procesarLoteOutbox(pool, redisPublisher, 'worker-test-1', 50);
      assert.ok(batchResult.totalLeidos >= 1, 'Debe haber leído al menos 1 evento');

      const check = await pool.query<{ status: string }>('SELECT status FROM outbox_events WHERE id = $1', [eventId]);
      if (check.rows[0]?.status === 'PROCESADO') {
        processed = true;
        break;
      }
    }
    assert.ok(processed, 'El evento debe estar PROCESADO');

    // Verificar en PostgreSQL la transición de estado y el fencing_token incrementado
    const checkRes = await pool.query<{
      status: string;
      fencing_token: number;
      lease_worker_id: string | null;
      lease_expires_at: string | null;
    }>(
      `SELECT status, fencing_token, lease_worker_id, lease_expires_at
       FROM outbox_events
       WHERE id = $1`,
      [eventId]
    );

    const record = checkRes.rows[0]!;
    assert.strictEqual(record.status, 'PROCESADO', 'El estado final debe ser PROCESADO');
    assert.strictEqual(record.fencing_token, 1, 'El fencing_token debió incrementarse a 1');
    assert.strictEqual(record.lease_worker_id, null, 'El lease_worker_id debe quedar liberado (NULL)');
    assert.strictEqual(record.lease_expires_at, null, 'El lease_expires_at debe quedar liberado (NULL)');
  });

  test('2. Recuperación de lease vencido tras caída (Worker Zombie Crash Recovery)', async () => {
    const aggregateId = `subasta-crash-${Date.now()}`;
    const testPayload = { loteId: aggregateId, monto: 2500 };

    // Simular un evento retenido por un worker que se cayó ("zombie-worker-99")
    // con lease_expires_at en el pasado (hace 10 segundos) y fencing_token = 2
    const insertRes = await pool.query<{ id: string }>(
      `INSERT INTO outbox_events (
         aggregate_type, aggregate_id, event_type, payload, status,
         lease_worker_id, lease_expires_at, fencing_token
       ) VALUES (
         'LOTE_SUBASTA', $1, 'PUJA_ACEPTADA', $2, 'PROCESANDO',
         'zombie-worker-99', NOW() - INTERVAL '10 seconds', 2
       ) RETURNING id`,
      [aggregateId, JSON.stringify(testPayload)]
    );
    const eventId = insertRes.rows[0]!.id;

    // Un nuevo worker activo ejecuta el lote
    let recovered = false;
    for (let i = 0; i < 5; i++) {
      const batchResult = await procesarLoteOutbox(pool, redisPublisher, 'recovery-worker-1', 50);
      const check = await pool.query<{ status: string }>('SELECT status FROM outbox_events WHERE id = $1', [eventId]);
      if (check.rows[0]?.status === 'PROCESADO') {
        recovered = true;
        break;
      }
    }
    assert.ok(recovered, 'El recovery worker debe procesar el evento huérfano');

    // Verificar que el evento fue reclamado con fencing_token incrementado a 3 y finalizado en PROCESADO
    const checkRes = await pool.query<{
      status: string;
      fencing_token: number;
      lease_worker_id: string | null;
    }>(
      `SELECT status, fencing_token, lease_worker_id
       FROM outbox_events
       WHERE id = $1`,
      [eventId]
    );

    const record = checkRes.rows[0]!;
    assert.strictEqual(record.status, 'PROCESADO', 'El evento huérfano debió ser recuperado y PROCESADO');
    assert.strictEqual(record.fencing_token, 3, 'El fencing_token debió subir de 2 a 3 protegiendo contra el zombie');
    assert.strictEqual(record.lease_worker_id, null, 'El lease debió ser liberado');
  });

  test('3. Manejo de fallos hacia destino: retroceso exponencial y transición a DLQ', async () => {
    const aggregateId = `subasta-fail-${Date.now()}`;
    const testPayload = { loteId: aggregateId, monto: 999 };

    // Mock de RedisPublisher que falla
    const failingPublisher = {
      publish: async () => {
        throw new Error('Conexión con broker rechazada (Fallo simulado)');
      }
    };

    // Caso A: Primer fallo -> PENDIENTE con backoff exponencial e incremento de retry_count
    const insertResA = await pool.query<{ id: string }>(
      `INSERT INTO outbox_events (
         aggregate_type, aggregate_id, event_type, payload, status,
         retry_count, max_retries, fencing_token
       ) VALUES (
         'LOTE_SUBASTA', $1, 'PUJA_ACEPTADA', $2, 'PENDIENTE',
         0, 3, 0
       ) RETURNING id`,
      [aggregateId, JSON.stringify(testPayload)]
    );
    const eventIdA = insertResA.rows[0]!.id;

    const resA = await procesarLoteOutbox(pool, failingPublisher, 'worker-fail-test', 50);
    assert.ok(resA.fallidos >= 1, 'Debe registrarse como fallo');

    const checkA = await pool.query<{
      status: string;
      retry_count: number;
      next_retry_at: Date;
      last_error: string;
    }>(
      `SELECT status, retry_count, next_retry_at, last_error
       FROM outbox_events WHERE id = $1`,
      [eventIdA]
    );
    const recA = checkA.rows[0]!;
    assert.strictEqual(recA.status, 'PENDIENTE', 'Debe regresar a PENDIENTE para reintento');
    assert.strictEqual(recA.retry_count, 1, 'retry_count debe ser 1');
    assert.ok(new Date(recA.next_retry_at).getTime() > Date.now(), 'next_retry_at debe programarse en el futuro');
    assert.match(recA.last_error, /Conexión con broker rechazada/);

    // Caso B: Último reintento superado (retry_count = 2, max_retries = 3) -> Transición a DLQ
    const insertResB = await pool.query<{ id: string }>(
      `INSERT INTO outbox_events (
         aggregate_type, aggregate_id, event_type, payload, status,
         retry_count, max_retries, fencing_token
       ) VALUES (
         'LOTE_SUBASTA', $1, 'PUJA_ACEPTADA', $2, 'PENDIENTE',
         2, 3, 0
       ) RETURNING id`,
      [`${aggregateId}-dlq`, JSON.stringify(testPayload)]
    );
    const eventIdB = insertResB.rows[0]!.id;

    const resB = await procesarLoteOutbox(pool, failingPublisher, 'worker-fail-test', 50);
    assert.ok(resB.dlq >= 1, 'Debe registrarse transición a DLQ');

    const checkB = await pool.query<{
      status: string;
      retry_count: number;
      last_error: string;
      lease_worker_id: string | null;
    }>(
      `SELECT status, retry_count, last_error, lease_worker_id
       FROM outbox_events WHERE id = $1`,
      [eventIdB]
    );
    const recB = checkB.rows[0]!;
    assert.strictEqual(recB.status, 'DLQ', 'El estado debe haber pasado a DLQ (Dead Letter Queue)');
    assert.strictEqual(recB.retry_count, 3, 'retry_count debe alcanzar max_retries (3)');
    assert.match(recB.last_error, /Conexión con broker rechazada/);
    assert.strictEqual(recB.lease_worker_id, null, 'El lease de DLQ debe quedar liberado');
  });

  test('4. Flujo End-to-End: Puja POST -> Outbox -> Redis Pub/Sub -> Difusión WebSocket en vivo', async () => {
    // 1. Crear vendedor y lote de subasta
    const vendedorRes = await authService.register({
      email: `vendedor_ws_${Date.now()}@test.com`,
      password: 'PasswordSubasta2026!',
      nombre: 'Ganadero Vendedor WS',
      organizacion_nombre: 'Hacienda El Rocío SAC',
      rol_inicial: 'VENDEDOR'
    });
    const vLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: vendedorRes.user.email, password: 'PasswordSubasta2026!' }
    });
    const vendedorToken = vLogin.json().access_token;

    const fechaCierre = new Date(Date.now() + 600000).toISOString();
    const loteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subastas',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        titulo: 'Toretes Brahman WS Live Test',
        precio_base: 2000,
        incremento_minimo: 100,
        fecha_cierre: fechaCierre,
        anti_sniping_seconds: 60,
        anti_sniping_extension: 120
      }
    });
    assert.strictEqual(loteRes.statusCode, 201);
    const loteId = loteRes.json().id;

    // 2. Crear comprador
    const compradorRes = await authService.register({
      email: `comprador_ws_${Date.now()}@test.com`,
      password: 'PasswordSubasta2026!',
      nombre: 'Comprador Mayorista WS',
      organizacion_nombre: 'Agroganadera Mayorista SAC',
      rol_inicial: 'COMPRADOR'
    });
    const cLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: compradorRes.user.email, password: 'PasswordSubasta2026!' }
    });
    const compradorToken = cLogin.json().access_token;

    // 3. Conectar cliente WebSocket al canal de la subasta (/api/v1/subastas/:id/live)
    const wsUrl = `ws://${serverHost}:${serverPort}/api/v1/subastas/${loteId}/live?access_token=${encodeURIComponent(compradorToken)}`;
    const clientWs = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      clientWs.once('open', () => resolve());
      clientWs.once('error', reject);
    });

    // El servidor valida token y lote antes de suscribir: esperar el registro en el hub.
    for (let i = 0; i < 100 && wsHub.getActiveSubscribersCount(loteId) === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.strictEqual(wsHub.getActiveSubscribersCount(loteId), 1, 'Debe haber 1 suscriptor activo en el canal');

    // Preparar promesa para recibir el mensaje en tiempo real por el WebSocket
    const mensajeWsPromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout esperando mensaje por WebSocket (10s)'));
      }, 10000);

      clientWs.on('message', (data: WebSocket.RawData) => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data.toString());
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    // 4. Emitir puja transaccional vía HTTP POST
    const pujaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/subastas/${loteId}/pujas`,
      headers: {
        authorization: `Bearer ${compradorToken}`,
        'idempotency-key': `ws-bid-${Date.now()}`
      },
      payload: {
        monto: 2150
      }
    });
    assert.strictEqual(pujaRes.statusCode, 201);
    const pujaBody = pujaRes.json();
    assert.strictEqual(pujaBody.monto, 2150);

    // 5. El procesador Outbox procesa el lote pendiente y publica a Redis Pub/Sub
    const outboxBatch = await procesarLoteOutbox(pool, redisPublisher, 'ws-test-worker', 50);
    assert.ok(outboxBatch.procesados >= 1, 'El outbox worker debió procesar la puja');

    // 6. El cliente WebSocket debe recibir la notificación reenviada desde Redis Pub/Sub
    const mensajeRecibido = await mensajeWsPromise;
    // Formato único del contrato v1: { event_type, lote_id, data }
    assert.strictEqual(mensajeRecibido.event_type, 'PUJA_ACEPTADA');
    assert.strictEqual(mensajeRecibido.lote_id, loteId);
    assert.strictEqual(mensajeRecibido.data.monto, 2150);
    assert.strictEqual(mensajeRecibido.data.secuencia, 1);
    assert.strictEqual(mensajeRecibido.data.nuevo_precio_actual, 2150);
    assert.ok(!('idempotency_key' in mensajeRecibido.data));

    // 7. Desconectar cliente y comprobar la limpieza ordenada de recursos
    clientWs.close();
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.strictEqual(
      wsHub.getActiveSubscribersCount(loteId),
      0,
      'Tras desconexión, el conteo de suscriptores para el lote debe volver a 0'
    );
  });

  test('5. Bucle continuo de OutboxWorker con scheduleNext y detención limpia con stop()', async () => {
    let tickCount = 0;
    const worker = new OutboxWorker({
      pool,
      publisher: redisPublisher,
      pollIntervalMs: 80,
      workerId: 'loop-test-worker'
    });

    const originalTick = worker.tick.bind(worker);
    worker.tick = async () => {
      tickCount++;
      return originalTick();
    };

    worker.start();
    assert.strictEqual(worker.isRunning, true, 'El worker debe reportar isRunning = true tras start()');

    // Esperar 300 ms para verificar que ejecute al menos 2 ticks
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(tickCount >= 2, `Debe haber ejecutado al menos 2 ticks en 300 ms (ejecutados: ${tickCount})`);

    // Detener el worker ordenadamente
    await worker.stop();
    assert.strictEqual(worker.isRunning, false, 'El worker debe reportar isRunning = false tras stop()');

    const ticksAtStop = tickCount;
    // Esperar 200 ms adicionales para comprobar que el worker no vuelve a ejecutar ningún tick
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.strictEqual(
      tickCount,
      ticksAtStop,
      `No deben ejecutarse más ticks tras stop() (inicial: ${ticksAtStop}, posterior: ${tickCount})`
    );
  });

  test('6. stop() tiene un límite: un ciclo colgado no bloquea el apagado', async () => {
    let liberar!: () => void;
    const colgado = new Promise<void>((resolve) => (liberar = resolve));
    const worker = new OutboxWorker({ pool, publisher: redisPublisher, pollIntervalMs: 10_000, workerId: 'hang-test-worker' });
    worker.tick = async () => {
      await colgado;
      return { totalLeidos: 0 } as Awaited<ReturnType<OutboxWorker['tick']>>;
    };

    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const inicio = Date.now();
    const drenado = await worker.stop(100);
    const duracion = Date.now() - inicio;

    assert.strictEqual(drenado, false, 'stop() debe informar que abandonó el ciclo en curso');
    assert.ok(duracion < 1000, `stop() debe respetar el límite (tardó ${duracion} ms)`);
    assert.strictEqual(worker.isRunning, false);
    liberar();
  });
});
