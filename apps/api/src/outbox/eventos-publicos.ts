/**
 * Proyección de eventos outbox hacia el canal público de la sala de subasta.
 *
 * `outbox_events.payload` puede contener datos internos (comprador, organización, totales).
 * Solo lo que devuelve esta función sale por Redis/WebSocket, con el formato único del
 * contrato v1: { event_type, lote_id, data }.
 * Un evento que no es público (p. ej. ORDEN_PAGADA) devuelve null y no se publica.
 */
export interface MensajeSalaSubasta {
  event_type: 'PUJA_ACEPTADA' | 'SUBASTA_ADJUDICADA' | 'SUBASTA_DESIERTA';
  lote_id: string;
  data: Record<string, unknown>;
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (source[k] !== undefined) out[k] = source[k];
  }
  return out;
}

export function proyectarEventoPublico(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  rawPayload: unknown
): { canal: string; mensaje: MensajeSalaSubasta } | null {
  if (aggregateType !== 'LOTE_SUBASTA') return null;

  const payload: Record<string, unknown> =
    typeof rawPayload === 'string' ? JSON.parse(rawPayload) : ((rawPayload ?? {}) as Record<string, unknown>);

  let data: Record<string, unknown>;
  switch (eventType) {
    case 'PUJA_ACEPTADA':
      data = pick(payload, [
        'puja_id',
        'monto',
        'secuencia',
        'nueva_version',
        'nuevo_precio_actual',
        'extension_aplicada',
        'nueva_fecha_cierre',
        'created_at'
      ]);
      break;
    case 'SUBASTA_ADJUDICADA':
      data = { ...pick(payload, ['codigo_lote', 'monto_adjudicado']), estado: 'ADJUDICADO' };
      break;
    case 'SUBASTA_DESIERTA':
      data = { ...pick(payload, ['codigo_lote']), estado: 'DESIERTO' };
      break;
    default:
      return null;
  }

  return {
    canal: `subasta:events:${aggregateId}`,
    mensaje: { event_type: eventType as MensajeSalaSubasta['event_type'], lote_id: aggregateId, data }
  };
}
