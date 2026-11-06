import { ApiError, apiRequest } from '#lib/api.ts';

export type OrderRole = 'comprador' | 'vendedor';
export interface Order {
  id: string;
  lote_id: string;
  codigo_lote: string;
  estado: string;
  monto_adjudicado: number;
  comision_plataforma: number;
  total_a_pagar: number;
  organizacion_compradora_id: string | null;
  organizacion_vendedora_id: string;
  created_at: string;
}
export interface OrderPage { data: Order[]; next_cursor: string | null }

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isOrder(value: unknown): value is Order {
  return isObject(value)
    && ['id', 'lote_id', 'codigo_lote', 'estado', 'organizacion_vendedora_id'].every(key => isText(value[key]))
    && (value.organizacion_compradora_id === null || isText(value.organizacion_compradora_id))
    && ['monto_adjudicado', 'comision_plataforma', 'total_a_pagar'].every(key =>
      typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0)
    && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at));
}

export async function listOrders(role: OrderRole, cursor: string | null, signal: AbortSignal): Promise<OrderPage> {
  const query = new URLSearchParams({ rol: role, limit: '20' });
  if (cursor !== null) query.set('cursor', cursor);
  const result = await apiRequest<unknown>(`/api/v1/ordenes?${query}`, { signal });
  if (!isObject(result) || !Array.isArray(result.data) || !result.data.every(isOrder)
    || !(result.next_cursor === null || isText(result.next_cursor))) {
    throw new Error('La API no devolvió una respuesta válida de órdenes.');
  }
  return { data: result.data, next_cursor: result.next_cursor };
}

export async function getOrder(id: string, signal: AbortSignal): Promise<Order> {
  const result = await apiRequest<unknown>(`/api/v1/ordenes/${encodeURIComponent(id)}`, { signal });
  if (!isOrder(result) || result.id !== id) throw new Error('La API no devolvió una respuesta válida para esta orden.');
  return result;
}

export function orderError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'Orden no disponible para esta consulta.';
    if (error.status === 403) return 'Sin acceso a esta consulta. Revisa tu organización y rol activos.';
    if (error.status === 401) return 'Inicia sesión de nuevo para consultar las órdenes.';
  }
  return error instanceof Error ? error.message : 'No se pudieron consultar las órdenes.';
}

const amountFormatter = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function orderAmount(amount: number): string { return amountFormatter.format(amount); }
