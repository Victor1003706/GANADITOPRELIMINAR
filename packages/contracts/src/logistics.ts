/**
 * Ganadito Cargo & Express API - Tipos y Contratos Logísticos
 */

export type TipoUnidadTransporte =
  | 'CAMION_JAULA_SIMPLE'
  | 'CAMION_JAULA_DOBLE_PISO'
  | 'FURGON_ISOTERMICO_REFRIGERADO'
  | 'FURGON_SECO';

export type TipoCargaLogistica =
  | 'GANADO_EN_PIE'
  | 'CARNE_CANAL'
  | 'INSUMOS_GRANOS';

export type EstadoSolicitudFlete =
  | 'PENDIENTE_ASIGNACION'
  | 'ASIGNADO'
  | 'EN_TRANSITO'
  | 'ENTREGADO'
  | 'CANCELADO';

export interface UnidadTransporte {
  id: string;
  transportista_id: string;
  organizacion_id: string;
  placa: string;
  tipo_unidad: TipoUnidadTransporte;
  capacidad_toneladas: number;
  capacidad_cabezas?: number | null;
  tiene_termoregistrador: boolean;
  activa: boolean;
  created_at?: string;
}

export interface SolicitudFlete {
  id: string;
  orden_compra_id?: string | null;
  solicitante_id: string;
  origen_establecimiento_id: string;
  destino_establecimiento_id: string;
  tipo_carga: TipoCargaLogistica;
  peso_toneladas: number;
  distancia_km: number;
  costo_flete_bruto: number;
  comision_referral_fee: number;
  comision_plataforma_fee?: number;
  total_flete: number;
  costo_total_pagar?: number;
  unidad_id?: string | null;
  transportista_id?: string | null;
  transportista_asignado_id?: string | null;
  estado: EstadoSolicitudFlete;
  created_at: string;
  updated_at: string;
}

export interface CotizacionFleteResult {
  distancia_km: number;
  peso_toneladas: number;
  tipo_unidad: TipoUnidadTransporte;
  tarifa_base: number;
  factor_km_tm: number;
  costo_flete_bruto: number;
  comision_referral_fee: number;
  comision_plataforma_fee: number;
  total_flete: number;
  costo_total_pagar: number;
  costo_neto_transportista: number;
}

export interface CotizarFleteInput {
  origen_establecimiento_id: string;
  destino_establecimiento_id: string;
  peso_toneladas: number;
  tipo_unidad: TipoUnidadTransporte;
  tarifa_base?: number;
  factor_km_tm?: number;
}

export interface CrearSolicitudFleteInput {
  orden_compra_id?: string | null;
  origen_establecimiento_id: string;
  destino_establecimiento_id: string;
  tipo_carga: TipoCargaLogistica;
  tipo_unidad: TipoUnidadTransporte;
  peso_toneladas: number;
}

export interface TomarFleteInput {
  unidad_id: string;
}

export interface ActualizarEstadoFleteInput {
  estado: 'EN_TRANSITO' | 'ENTREGADO';
}

const FACTORES_KM_TM_POR_DEFECTO: Record<TipoUnidadTransporte, number> = {
  CAMION_JAULA_SIMPLE: 0.35,
  CAMION_JAULA_DOBLE_PISO: 0.45,
  FURGON_ISOTERMICO_REFRIGERADO: 0.5,
  FURGON_SECO: 0.3,
};

/**
 * Calcula la cotización de flete geodésico y financiero.
 *
 * Fórmula:
 * costo_flete_bruto = tarifaBase + (distanciaKm * pesoToneladas * factorKmTM)
 * comision_referral_fee = 5% del flete bruto
 * total_flete = flete bruto + comisión referral
 */
export function calcularCotizacionFlete(
  distanciaKm: number,
  pesoToneladas: number,
  tipoUnidad: TipoUnidadTransporte = 'CAMION_JAULA_SIMPLE',
  tarifaBase: number = 150,
  factorKmTM?: number,
): CotizacionFleteResult {
  const factor = factorKmTM ?? FACTORES_KM_TM_POR_DEFECTO[tipoUnidad] ?? 0.35;
  const distancia = Math.max(0, Number(distanciaKm.toFixed(2)));
  const peso = Math.max(0, Number(pesoToneladas.toFixed(2)));

  const costoBruto = Number((tarifaBase + distancia * peso * factor).toFixed(2));
  const comisionFee = Number((costoBruto * 0.05).toFixed(2));
  const total = Number((costoBruto + comisionFee).toFixed(2));

  return {
    distancia_km: distancia,
    peso_toneladas: peso,
    tipo_unidad: tipoUnidad,
    tarifa_base: Number(tarifaBase.toFixed(2)),
    factor_km_tm: Number(factor.toFixed(4)),
    costo_flete_bruto: costoBruto,
    comision_referral_fee: comisionFee,
    comision_plataforma_fee: comisionFee,
    total_flete: total,
    costo_total_pagar: total,
    costo_neto_transportista: costoBruto,
  };
}
