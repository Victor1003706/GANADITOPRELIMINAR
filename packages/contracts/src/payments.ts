/**
 * Contratos y máquina de estados del módulo financiero de Pagos y Webhooks de Pasarelas.
 */

export const ESTADOS_PAGO = [
  'INICIADO',
  'CONFIRMADO',
  'FALLIDO',
  'EN_CONCILIACION'
] as const;

export type EstadoPago = (typeof ESTADOS_PAGO)[number];

export interface PagoTransaccion {
  id: string;
  orden_id: string;
  monto: number;
  moneda: string;
  proveedor: string;
  referencia_externa?: string | null;
  estado: EstadoPago;
  raw_webhook?: any;
  created_at: string;
  updated_at: string;
}

export interface CheckoutInput {
  orden_id: string;
  proveedor?: string;
}

export interface CheckoutResult {
  transaccion_id: string;
  orden_id: string;
  monto: number;
  moneda: string;
  proveedor: string;
  referencia_externa: string;
  checkout_url: string;
  estado: EstadoPago;
}

export interface WebhookPagoPayload {
  evento: string;
  transaccion_id?: string;
  referencia_externa: string;
  orden_id?: string;
  monto: number;
  moneda?: string;
  estado: 'CONFIRMADO' | 'FALLIDO' | 'PAID' | 'FAILED' | 'SUCCEEDED';
  timestamp: number | string;
  metadata?: Record<string, any>;
}
