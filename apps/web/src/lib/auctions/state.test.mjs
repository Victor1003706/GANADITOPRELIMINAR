import test from 'node:test';
import assert from 'node:assert/strict';
const { bidAttempt, parseSnapshot, parseBidReceipt, parseLiveEvent } = await import(new URL('./state.ts', import.meta.url).href);

test('an uncertain bid reuses its key only for the same lot, amount and session', () => {
  const first = bidAttempt(null, 'lot-a', 150, 'session-a', () => 'key-a');
  assert.equal(bidAttempt(first, 'lot-a', 150, 'session-a', () => 'unexpected'), first);
  assert.equal(bidAttempt(first, 'lot-a', 160, 'session-a', () => 'key-b').key, 'key-b');
  assert.equal(bidAttempt(first, 'lot-b', 150, 'session-a', () => 'key-c').key, 'key-c');
  assert.equal(bidAttempt(first, 'lot-a', 150, 'session-b', () => 'key-d').key, 'key-d');
});

test('an unrelated or malformed snapshot never becomes the requested lot', () => {
  const snapshot = { id: 'lot-a', codigo_lote: 'A', estado: 'ACTIVO', precio_base: 100,
    precio_actual: 110, incremento_minimo: 10, proxima_puja_minima: 120,
    postor_ganador_id: null, postor_ganador_nombre: null, tiempo_restante_segundos: 40,
    fecha_cierre: '2026-11-05T12:00:00Z', secuencia_maxima: 1, version: 2, es_abierta: true };
  assert.equal(parseSnapshot(snapshot, 'lot-a').id, 'lot-a');
  assert.throws(() => parseSnapshot(snapshot, 'lot-b'), /respuesta/i);
  assert.throws(() => parseSnapshot({ ...snapshot, precio_actual: Infinity }, 'lot-a'), /respuesta/i);
  assert.throws(() => parseSnapshot({ ...snapshot, estado: 'INVENTADO' }, 'lot-a'), /respuesta/i);
});

const publicBid = { puja_id: 'bid-a', monto: 110, secuencia: 1, nueva_version: 2,
  nuevo_precio_actual: 110, extension_aplicada: false,
  nueva_fecha_cierre: '2026-11-05T12:00:00Z', created_at: '2026-11-05T11:00:00Z' };

test('public bid envelopes do not require private receipt fields', () => {
  assert.deepEqual(parseLiveEvent({ event_type: 'PUJA_ACEPTADA', lote_id: 'lot-a', data: publicBid }, 'lot-a'),
    { kind: 'bid', data: publicBid });
  assert.equal(parseLiveEvent({ event_type: 'PUJA_ACEPTADA', lote_id: 'lot-b', data: publicBid }, 'lot-a'), null);
  for (const malformed of [{ ...publicBid, secuencia: 1.5 }, { ...publicBid, extension_aplicada: 'false' },
    { ...publicBid, created_at: 'invalid' }, { ...publicBid, monto: Infinity }]) {
    assert.equal(parseLiveEvent({ event_type: 'PUJA_ACEPTADA', lote_id: 'lot-a', data: malformed }, 'lot-a'), null);
  }
});

test('only a complete REST receipt with its key can confirm a private bid attempt', () => {
  const receipt = { ...publicBid, lote_id: 'lot-a', idempotency_key: 'key-a' };
  assert.equal(parseBidReceipt(receipt, 'lot-a').idempotency_key, 'key-a');
  assert.throws(() => parseBidReceipt(publicBid, 'lot-a'), /confirmación/i);
  assert.throws(() => parseBidReceipt({ ...receipt, idempotency_key: '' }, 'lot-a'), /confirmación/i);
  assert.throws(() => parseBidReceipt(receipt, 'lot-b'), /confirmación/i);
});

test('public closures only request refresh; legacy private order messages are rejected', () => {
  const adjudicated = { event_type: 'SUBASTA_ADJUDICADA', lote_id: 'lot-a',
    data: { codigo_lote: 'A', estado: 'ADJUDICADO', monto_adjudicado: 110 } };
  assert.deepEqual(parseLiveEvent(adjudicated, 'lot-a'), { kind: 'refresh' });
  assert.deepEqual(parseLiveEvent({ event_type: 'SUBASTA_DESIERTA', lote_id: 'lot-a',
    data: { codigo_lote: 'A', estado: 'DESIERTO' } }, 'lot-a'), { kind: 'refresh' });
  assert.equal(parseLiveEvent({ ...adjudicated, lote_id: 'lot-b' }, 'lot-a'), null);
  assert.equal(parseLiveEvent({ lote_id: 'lot-a', orden_id: 'order-a', comprador_id: 'buyer',
    organizacion_compradora_id: 'org-a', organizacion_vendedora_id: 'org-b',
    monto_adjudicado: 100, comision_plataforma: 1, total_a_pagar: 101, estado: 'PENDIENTE_PAGO' }, 'lot-a'), null);
  assert.equal(parseLiveEvent({ event_type: 'SUBASTA_ADJUDICADA', lote_id: 'lot-a', data: { estado: 'PAGADO' } }, 'lot-a'), null);
});
