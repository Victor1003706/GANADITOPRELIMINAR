/**
 * Contratos y máquina de estados del ciclo comercial de Órdenes de Compra.
 *
 * Módulo de Adjudicación, Despacho, Custodia y Liquidación Comercial en Ganadito.
 */

export const ESTADOS_ORDEN_COMPRA = [
  'PENDIENTE_PAGO',
  'PAGADO',
  'EN_CUSTODIA',
  'ENTREGADO',
  'LIQUIDADO',
  'CANCELADO'
] as const;

export type EstadoOrdenCompra = (typeof ESTADOS_ORDEN_COMPRA)[number];

export const ESTADOS_LIQUIDACION_VENDEDOR = [
  'PENDIENTE_DISPERSION',
  'DISPERSADO',
  'FALLIDO'
] as const;

export type EstadoLiquidacionVendedor = (typeof ESTADOS_LIQUIDACION_VENDEDOR)[number];

/**
 * Tasa fija oficial de comisión de la plataforma Ganadito (1.00%).
 */
export const COMISION_PLATAFORMA_PORCENTAJE = 0.01;

/**
 * Entidad Orden de Compra Comercial generada tras la adjudicación de un lote en subasta.
 */
export interface OrdenCompra {
  id: string;
  lote_id: string;
  comprador_id: string;
  organizacion_compradora_id?: string | null;
  vendedor_id?: string | null;
  organizacion_vendedora_id: string;
  monto_adjudicado: number;
  comision_plataforma: number;
  total_a_pagar: number;
  estado: EstadoOrdenCompra;
  created_at: string;
  updated_at: string;
}

/**
 * Entidad Liquidación Neta al Vendedor tras la confirmación de entrega y liberación de fondos.
 */
export interface LiquidacionVendedor {
  id: string;
  orden_id: string;
  vendedor_id: string;
  organizacion_vendedora_id: string;
  monto_bruto: number;
  comision_retenida: number;
  monto_neto_pagar: number;
  cuenta_bancaria_cci?: string | null;
  estado: EstadoLiquidacionVendedor;
  created_at: string;
  updated_at: string;
}

export interface DespacharOrdenInput {
  guia_remision?: string;
  transportista_nombre?: string;
  transportista_placa?: string;
  notas?: string;
}

export interface ConfirmarRecepcionInput {
  calidad_conforme?: boolean;
  observaciones?: string;
}

export interface DespacharOrdenResponse {
  orden_id: string;
  estado: EstadoOrdenCompra;
  mensaje: string;
  despachado_at: string;
}

export interface ConfirmarRecepcionResponse {
  orden_id: string;
  estado: EstadoOrdenCompra;
  liquidacion: {
    id: string;
    monto_bruto: number;
    comision_retenida: number;
    monto_neto_pagar: number;
    cuenta_bancaria_cci?: string | null;
    estado: EstadoLiquidacionVendedor;
  };
  mensaje: string;
  liquidado_at: string;
}

/**
 * Resultado financiero del cálculo de liquidación comercial de una subasta.
 */
export interface LiquidacionSubastaCalculo {
  montoAdjudicado: number;
  comisionPlataforma: number;
  totalAPagar: number;
}

/**
 * Calcula con precisión decimal la comisión de la plataforma (1%) y el total a pagar por el comprador.
 * Redondea estrictamente a 2 decimales para integridad financiera en Soles (PEN).
 */
/** Soles -> céntimos enteros. NUMERIC(…,2) llega como float con a lo sumo 2 decimales. */
export function aCentimosPen(monto: number): number {
  return Math.round(monto * 100);
}

/**
 * Comisión en céntimos con aritmética ENTERA y redondeo half-up. Antes se calculaba
 * Math.round(monto * tasa * 100), y 14.5 * 0.01 * 100 = 14.499999… daba 0.14 en vez de 0.15.
 */
export function comisionCentimos(montoCentimos: number, tasaComision: number): number {
  const puntosBasicos = Math.round(tasaComision * 10_000);
  return Math.floor((montoCentimos * puntosBasicos + 5_000) / 10_000);
}

export function calcularLiquidacionSubasta(
  montoAdjudicado: number,
  tasaComision: number = COMISION_PLATAFORMA_PORCENTAJE
): LiquidacionSubastaCalculo {
  if (typeof montoAdjudicado !== 'number' || isNaN(montoAdjudicado) || montoAdjudicado <= 0) {
    throw new Error('El monto adjudicado debe ser un número positivo.');
  }

  const montoC = aCentimosPen(montoAdjudicado);
  const comisionC = comisionCentimos(montoC, tasaComision);
  const comisionPlataforma = comisionC / 100;
  const totalAPagar = (montoC + comisionC) / 100;

  return {
    montoAdjudicado,
    comisionPlataforma,
    totalAPagar
  };
}

/**
 * Calcula la liquidación neta a pagar al vendedor (monto adjudicado menos la comisión de plataforma del 1%).
 * Retorno en Soles (PEN) con redondeo bancario estricto a 2 decimales (exacto 99%).
 */
export function calcularLiquidacionVendedor(
  montoAdjudicado: number,
  tasaComision: number = COMISION_PLATAFORMA_PORCENTAJE
): {
  montoBruto: number;
  comisionRetenida: number;
  montoNetoPagar: number;
} {
  if (typeof montoAdjudicado !== 'number' || isNaN(montoAdjudicado) || montoAdjudicado <= 0) {
    throw new Error('El monto adjudicado debe ser un número positivo.');
  }

  const montoC = aCentimosPen(montoAdjudicado);
  const comisionC = comisionCentimos(montoC, tasaComision);
  const comisionRetenida = comisionC / 100;
  const montoNetoPagar = (montoC - comisionC) / 100;

  return {
    montoBruto: montoAdjudicado,
    comisionRetenida,
    montoNetoPagar
  };
}
