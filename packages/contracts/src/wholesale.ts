export type TipoProductoMayorista =
  | 'INSUMO_AGRICOLA'
  | 'GRANO_FORRAJE'
  | 'MEDIAS_CANALES'
  | 'CUARTOS_COMPENSADOS'
  | 'CORTES_CALIBRADOS'
  | 'EQUIPAMIENTO_SANITARIO';

export type UnidadMedidaMayorista = 'KG' | 'TONELADA' | 'UNIDAD' | 'SACO_50KG';

export type EstadoPoolMayorista =
  | 'ABIERTO'
  | 'ALCANZADO'
  | 'EXPIRADO_FALLIDO'
  | 'CERRADO_ORDENADO'
  | 'CANCELADO';

export type EstadoParticipacionPool = 'RESERVADO' | 'CONFIRMADO' | 'REEMBOLSADO';

export interface PoolCompraMayorista {
  id: string;
  creador_id: string;
  organizacion_id: string;
  tipo_producto: TipoProductoMayorista;
  titulo: string;
  descripcion: string;
  precio_unitario_mayorista: number;
  meta_volumen: number;
  volumen_acumulado: number;
  unidad_medida: UnidadMedidaMayorista;
  fecha_limite: string | Date;
  estado: EstadoPoolMayorista;
  es_oferta_flash: boolean;
  progreso_porcentaje?: number;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface ParticipacionPool {
  id: string;
  pool_id: string;
  comprador_id: string;
  organizacion_compradora_id: string;
  cantidad: number;
  monto_total: number;
  estado: EstadoParticipacionPool;
  created_at?: string | Date;
}

export interface CrearPoolMayoristaInput {
  tipo_producto: TipoProductoMayorista;
  titulo: string;
  descripcion: string;
  precio_unitario_mayorista: number;
  meta_volumen: number;
  unidad_medida: UnidadMedidaMayorista;
  fecha_limite: string;
  es_oferta_flash?: boolean;
}

export interface UnirsePoolInput {
  cantidad: number;
}

export interface ListarPoolsQuery {
  tipo_producto?: TipoProductoMayorista;
  flash?: boolean | string;
}

export interface PoolConProgreso extends PoolCompraMayorista {
  progreso_porcentaje: number;
}

export interface UnirsePoolResponse {
  participacion: ParticipacionPool;
  pool: PoolCompraMayorista;
  meta_alcanzada: boolean;
}

export interface CerrarPoolsExpiradosResponse {
  cerrados_count: number;
  pools_afectados: string[];
}
