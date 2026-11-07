import type pg from 'pg';
import {
  type PoolCompraMayorista,
  type ParticipacionPool,
  type CrearPoolMayoristaInput,
  type UnirsePoolInput,
  type ListarPoolsQuery,
  type PoolConProgreso,
  type UnirsePoolResponse,
  type CerrarPoolsExpiradosResponse,
  type TipoProductoMayorista,
  type UnidadMedidaMayorista
} from '@ganadito/contracts';

export class MayoristaError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'MayoristaError';
  }
}

const TIPOS_PRODUCTO_VALIDOS: readonly TipoProductoMayorista[] = [
  'INSUMO_AGRICOLA',
  'GRANO_FORRAJE',
  'MEDIAS_CANALES',
  'CUARTOS_COMPENSADOS',
  'CORTES_CALIBRADOS',
  'EQUIPAMIENTO_SANITARIO'
];

const UNIDADES_MEDIDA_VALIDAS: readonly UnidadMedidaMayorista[] = [
  'KG',
  'TONELADA',
  'UNIDAD',
  'SACO_50KG'
];

function mapPoolRow(row: any): PoolCompraMayorista {
  return {
    id: row.id,
    creador_id: row.creador_id,
    organizacion_id: row.organizacion_id,
    tipo_producto: row.tipo_producto,
    titulo: row.titulo,
    descripcion: row.descripcion,
    precio_unitario_mayorista: Number(row.precio_unitario_mayorista),
    meta_volumen: Number(row.meta_volumen),
    volumen_acumulado: Number(row.volumen_acumulado),
    unidad_medida: row.unidad_medida,
    fecha_limite: row.fecha_limite instanceof Date ? row.fecha_limite.toISOString() : row.fecha_limite,
    estado: row.estado,
    es_oferta_flash: Boolean(row.es_oferta_flash),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapParticipacionRow(row: any): ParticipacionPool {
  return {
    id: row.id,
    pool_id: row.pool_id,
    comprador_id: row.comprador_id,
    organizacion_compradora_id: row.organizacion_compradora_id,
    cantidad: Number(row.cantidad),
    monto_total: Number(row.monto_total),
    estado: row.estado,
    created_at: row.created_at
  };
}

function calcularProgresoPorcentaje(volumenAcumulado: number, metaVolumen: number): number {
  if (metaVolumen <= 0) return 0;
  const porcentaje = (volumenAcumulado / metaVolumen) * 100;
  return Math.min(100, Math.round(porcentaje * 100) / 100);
}

export class MayoristaService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Crea una nueva campaña de compra mayorista (pool de demanda) u oferta flash.
   */
  async crearPool(
    userId: string,
    activeOrgId: string,
    input: CrearPoolMayoristaInput
  ): Promise<PoolCompraMayorista> {
    if (!input.titulo || typeof input.titulo !== 'string' || input.titulo.trim().length === 0) {
      throw new MayoristaError('El título de la campaña es obligatorio.', 400);
    }
    if (!input.descripcion || typeof input.descripcion !== 'string' || input.descripcion.trim().length === 0) {
      throw new MayoristaError('La descripción de la campaña es obligatoria.', 400);
    }
    if (!input.tipo_producto || !TIPOS_PRODUCTO_VALIDOS.includes(input.tipo_producto)) {
      throw new MayoristaError(
        `Tipo de producto inválido. Debe ser uno de: ${TIPOS_PRODUCTO_VALIDOS.join(', ')}.`,
        400
      );
    }
    if (!input.unidad_medida || !UNIDADES_MEDIDA_VALIDAS.includes(input.unidad_medida)) {
      throw new MayoristaError(
        `Unidad de medida inválida. Debe ser una de: ${UNIDADES_MEDIDA_VALIDAS.join(', ')}.`,
        400
      );
    }
    if (typeof input.precio_unitario_mayorista !== 'number' || input.precio_unitario_mayorista <= 0) {
      throw new MayoristaError('El precio unitario mayorista debe ser un número positivo.', 400);
    }
    if (typeof input.meta_volumen !== 'number' || input.meta_volumen <= 0) {
      throw new MayoristaError('La meta de volumen debe ser un número positivo mayor a 0.', 400);
    }

    const fechaLimite = new Date(input.fecha_limite);
    if (isNaN(fechaLimite.getTime()) || fechaLimite.getTime() <= Date.now()) {
      throw new MayoristaError('La fecha límite debe ser una fecha futura válida.', 400);
    }

    const res = await