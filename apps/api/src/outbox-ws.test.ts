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

    // 