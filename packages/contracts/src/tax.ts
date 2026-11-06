/**
 * Contratos de Integración Tributaria y Financiera (Ganadito Tax & Fintech Engine):
 * - SEE-SUNAT Sandbox (Liquidaciones de Compra Electrónicas, Facturas, Boletas)
 * - CAVALI Factoring Stub (Anotación en cuenta de facturas negociables y adelanto)
 */

export type TipoComprobanteTributario =
  | 'LIQUIDACION_COMPRA_ELECTRONICA'
  | 'FACTURA_ELECTRONICA'
  | 'BOLETA_ELECTRONICA';

export type EstadoIntegracionTributaria =
  | 'CREADO'
  | 'ENVIADO_PENDIENTE'
  | 'CONFIRMADO'
  | 'RECHAZADO'
  | 'EN_DISPUTA'
  | 'REQUIERE_CONCILIACION';

export type TipoDocumentoReceptor = 'DNI' | 'RUC';

export interface ItemComprobanteFiscal {
  descripcion: string;
  cantidad: number;
  unidad_medida: string;
  precio_unitario_pen: number;
  monto_total_pen: number;
}

export interface LiquidacionCompraInput {
  orden_compra_id: string;
  emisor_ruc: string;
  emisor_razon_social: string;
  productor_dni: string;
  productor_nombre: string;
  productor_ppa_codigo?: string | null;
  monto_total_pen: number;
  items?: ItemComprobanteFiscal[];
}

export interface ComprobanteFiscalRecord {
  id: string;
  orden_id: string;
  tipo_comprobante: TipoComprobanteTributario;
  serie: string;
  correlativo: number;
  emisor_ruc: string;
  receptor_num_doc: string;
  receptor_tipo_doc: TipoDocumentoReceptor;
  monto_subtotal: number;
  monto_igv: number;
  monto_total: number;
  estado_sunat: EstadoIntegracionTributaria;
  external_correlation_id: string;
  xml_payload_resumen: Record<string, any>;
  cdr_sunat_codigo?: string | null;
  cdr_sunat_mensaje?: string | null;
  retry_count: number;
  next_retry_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type EstadoFactoringCavali =
  | 'CREADO'
  | 'ENVIADO_PENDIENTE'
  | 'CONFIRMADO'
  | 'RECHAZADO'
  | 'REQUIERE_CONCILIACION';

export interface SolicitudFactoringInput {
  orden_id: string;
  comprobante_id: string;
  organizacion_id?: string;
  porcentaje_adelanto?: number;
  tasa_descuento_mensual?: number;
}

export interface FactoringCavaliRecord {
  id: string;
  orden_id: string;
  comprobante_id: string;
  organizacion_id: string;
  monto_factura: number;
  porcentaje_adelanto: number;
  tasa_descuento_mensual: number;
  monto_adelanto_neto?: number;
  estado: EstadoFactoringCavali;
  cavali_tracking_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmisionComprobanteResponse {
  comprobante: ComprobanteFiscalRecord;
  sunat_status: EstadoIntegracionTributaria;
  mensaje: string;
}

export interface FactoringCavaliResponse {
  solicitud: FactoringCavaliRecord;
  monto_adelanto_calculado: number;
  mensaje: string;
}

export interface ConciliacionPendientesResponse {
  procesados: number;
  confirmados: number;
  pendientes: number;
  fallidos: number;
  detalles: Array<{
    comprobante_id: string;
    serie: string;
    correlativo: number;
    nuevo_estado: EstadoIntegracionTributaria;
    mensaje: string;
  }>;
}
