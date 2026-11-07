import type pg from 'pg';
import { sqlPosicionPublica } from '../mapa/ubicacion-publica.js';
import {
  calcularCotizacionFlete,
  type TipoUnidadTransporte,
  type TipoCargaLogistica,
  type EstadoSolicitudFlete,
  type UnidadTransporte,
  type SolicitudFlete,
  type CotizacionFleteResult,
  type CotizarFleteInput,
  type CrearSolicitudFleteInput,
  type TomarFleteInput
} from '@ganadito/contracts';

export class LogisticaError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'LogisticaError';
  }
}

const TIPOS_UNIDAD_VALIDOS: readonly TipoUnidadTransporte[] = [
  'CAMION_JAULA_SIMPLE',
  'CAMION_JAULA_DOBLE_PISO',
  'FURGON_ISOTERMICO_REFRIGERADO',
  'FURGON_SECO'
];

const TIPOS_CARGA_VALIDOS: readonly TipoCargaLogistica[] = [
  'GANADO_EN_PIE',
  'CARNE_CANAL',
  'INSUMOS_GRANOS'
];

export interface RegistrarUnidadInput {
  placa: string;
  tipo_unidad: TipoUnidadTransporte;
  capacidad_toneladas: number;
  capacidad_cabezas?: number | null;
  tiene_termoregistrador?: boolean;
}

function mapUnidadRow(row: any): UnidadTransporte {
  return {
    id: row.id,
    transportista_id: row.transportista_id,
    organizacion_id: row.organizacion_id,
    placa: row.placa,
    tipo_unidad: row.tipo_unidad,
    capacidad_toneladas: Number(row.capacidad_toneladas),
    capacidad_cabezas: row.capacidad_cabezas !== null ? Number(row.capacidad_cabezas) : null,
    tiene_termoregistrador: Boolean(row.tiene_termoregistrador),
    activa: Boolean(row.activa),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined
  };
}

function mapSolicitudRow(row: any): SolicitudFlete {
  const bruto = Number(row.costo_flete_bruto);
  const fee = Number(row.comision_referral_fee);
  const total = Number(row.total_flete);

  return {
    id: row.id,
    orden_compra_id: row.orden_compra_id ?? null,
    solicitante_id: row.solicitante_id,
    origen_establecimiento_id: row.origen_establecimiento_id,
    destino_establecimiento_id: row.destino_establecimiento_id,
    tipo_carga: row.tipo_carga,
    peso_toneladas: Number(row.peso_toneladas),
    distancia_km: Number(row.distancia_km),
    costo_flete_bruto: bruto,
    comision_referral_fee: fee,
    comision_plataforma_fee: fee,
    total_flete: total,
    costo_total_pagar: total,
    unidad_id: row.unidad_id ?? null,
    transportista_id: row.transportista_id ?? null,
    transportista_asignado_id: row.transportista_id ?? null,
    estado: row.estado,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString()
  };
}

export interface VisorFlete {
  userId: string;
  organizacionId?: string;
  /** Rol TRANSPORTISTA en el CONTEXTO ACTIVO (no en cualquier organización). */
  esTransportista: boolean;
}

/**
 * La distancia guardada se calculó con la vista del solicitante: si es dueño de ambos
 * extremos es exacta. Para cualquier otro visor se entrega redondeada a km enteros, para
 * que varios fletes desde el mismo establo no permitan triangular su ubicación.
 */
function proyectarParaVisor(flete: SolicitudFlete, visor: VisorFlete): SolicitudFlete {
  if (flete.solicitante_id === visor.userId) return flete;
  return { ...flete, distancia_km: Math.round(Number(flete.distancia_km)) };
}

/** Parámetros: $1 usuario, $2 organización activa, $3 es transportista (boolean). */
const SQL_FLETE_VISIBLE = `(
  f.solicitante_id::text = $1
  OR f.transportista_id::text = $1
  OR ($3::boolean AND f.estado = 'PENDIENTE_ASIGNACION')
  OR EXISTS (SELECT 1 FROM ordenes_compra oc
             WHERE oc.id = f.orden_compra_id
               AND (oc.organizacion_compradora_id = $2::uuid OR oc.organizacion_vendedora_id = $2::uuid))
)`;

export class LogisticaService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Obtiene la distancia geodésica esferoidal (km) entre dos establecimientos en PostGIS.
   */
  /**
   * Distancia entre dos establecimie