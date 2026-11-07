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

    const res = await this.pool.query(
      `INSERT INTO pools_compra_mayorista (
        creador_id, organizacion_id, tipo_producto, titulo, descripcion,
        precio_unitario_mayorista, meta_volumen, volumen_acumulado, unidad_medida,
        fecha_limite, estado, es_oferta_flash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, 'ABIERTO', $10)
      RETURNING *`,
      [
        userId,
        activeOrgId,
        input.tipo_producto,
        input.titulo.trim(),
        input.descripcion.trim(),
        input.precio_unitario_mayorista,
        input.meta_volumen,
        input.unidad_medida,
        fechaLimite.toISOString(),
        Boolean(input.es_oferta_flash)
      ]
    );

    return mapPoolRow(res.rows[0]);
  }

  /**
   * Consulta pública de campañas vigentes en estado ABIERTO con progreso porcentual.
   */
  async listarPoolsActivos(query: ListarPoolsQuery = {}): Promise<PoolConProgreso[]> {
    const conditions: string[] = ["estado = 'ABIERTO'", 'fecha_limite > NOW()'];
    const params: any[] = [];

    if (query.tipo_producto && TIPOS_PRODUCTO_VALIDOS.includes(query.tipo_producto)) {
      params.push(query.tipo_producto);
      conditions.push(`tipo_producto = $${params.length}`);
    }

    if (query.flash !== undefined) {
      const isFlash = query.flash === true || query.flash === 'true';
      params.push(isFlash);
      conditions.push(`es_oferta_flash = $${params.length}`);
    }

    const sql = `
      SELECT * FROM pools_compra_mayorista
      WHERE ${conditions.join(' AND ')}
      ORDER BY fecha_limite ASC
    `;

    const res = await this.pool.query(sql, params);
    return res.rows.map(row => {
      const pool = mapPoolRow(row);
      return {
        ...pool,
        progreso_porcentaje: calcularProgresoPorcentaje(pool.volumen_acumulado, pool.meta_volumen)
      };
    });
  }

  /**
   * Consulta de un pool individual por su ID.
   */
  async obtenerPoolPorId(poolId: string): Promise<PoolConProgreso> {
    const res = await this.pool.query(
      `SELECT * FROM pools_compra_mayorista WHERE id = $1`,
      [poolId]
    );
    if (res.rows.length === 0) {
      throw new MayoristaError('Pool mayorista no encontrado.', 404);
    }
    const pool = mapPoolRow(res.rows[0]);
    return {
      ...pool,
      progreso_porcentaje: calcularProgresoPorcentaje(pool.volumen_acumulado, pool.meta_volumen)
    };
  }

  /**
   * Permite a una organización compradora unirse a un pool reservando su cuota de volumen.
   * Ejecuta bloqueo pesimista FOR UPDATE y conmuta a ALCANZADO emitiendo Outbox si se completa la meta.
   */
  async unirsePool(
    userId: string,
    activeOrgId: string,
    poolId: string,
    input: UnirsePoolInput
  ): Promise<UnirsePoolResponse> {
    if (typeof input.cantidad !== 'number' || input.cantidad <= 0) {
      throw new MayoristaError('La cantidad a reservar debe ser un número positivo mayor a 0.', 400);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Bloqueo pesimista del pool
      const poolRes = await client.query(
        `SELECT * FROM pools_compra_mayorista WHERE id = $1 FOR UPDATE`,
        [poolId]
      );

      if (poolRes.rows.length === 0) {
        throw new MayoristaError('Pool mayorista no encontrado.', 404);
      }

      const poolData = mapPoolRow(poolRes.rows[0]);

      // 2. Validar estado y fecha límite
      if (poolData.estado !== 'ABIERTO') {
        throw new MayoristaError(
          `El pool se encuentra en estado '${poolData.estado}' y no admite nuevas participaciones.`,
          409
        );
      }

      const fechaLimiteTime = new Date(poolData.fecha_limite).getTime();
      if (fechaLimiteTime <= Date.now()) {
        throw new MayoristaError('El pool mayorista ha expirado.', 409);
      }

      // 3. Validar si la organización ya se unió a este pool
      const participacionPrevia = await client.query(
        `SELECT id FROM pool_participaciones WHERE pool_id = $1 AND organizacion_compradora_id = $2`,
        [poolId, activeOrgId]
      );
      if (participacionPrevia.rows.length > 0) {
        throw new MayoristaError(
          'La organización compradora ya cuenta con una participación registrada en este pool.',
          409
        );
      }

      // 4. Calcular montos e insertar participación
      const montoTotal = Number((input.cantidad * poolData.precio_unitario_mayorista).toFixed(2));
      const partRes = await client.query(
        `INSERT INTO pool_participaciones (
          pool_id, comprador_id, organizacion_compradora_id, cantidad, monto_total, estado
        ) VALUES ($1, $2, $3, $4, $5, 'RESERVADO')
        RETURNING *`,
        [poolId, userId, activeOrgId, input.cantidad, montoTotal]
      );
      const participacion = mapParticipacionRow(partRes.rows[0]);

      // 5. Actualizar volumen acumulado y comprobar si alcanza la meta
      const nuevoVolumen = poolData.volumen_acumulado + input.cantidad;
      const metaAlcanzada = nuevoVolumen >= poolData.meta_volumen;
      const nuevoEstado = metaAlcanzada ? 'ALCANZADO' : 'ABIERTO';

      const updatePoolRes = await client.query(
        `UPDATE pools_compra_mayorista
         SET volumen_acumulado = $1,
             estado = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [nuevoVolumen, nuevoEstado, poolId]
      );
      const poolActualizado = mapPoolRow(updatePoolRes.rows[0]);

      // 6. Si alcanzó la meta, emitir evento en outbox_events
      if (metaAlcanzada) {
        await client.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, $3, $4)`,
          [
            'POOL_MAYORISTA',
            poolId,
            'POOL_META_ALCANZADA',
            JSON.stringify({
              pool_id: poolId,
              meta_volumen: poolData.meta_volumen,
              volumen_acumulado: nuevoVolumen,
              unidad_medida: poolData.unidad_medida,
              tipo_producto: poolData.tipo_producto,
              fecha_alcanzada: new Date().toISOString()
            })
          ]
        );
      }

      await client.query('COMMIT');
      return {
        participacion,
        pool: poolActualizado,
        meta_alcanzada: metaAlcanzada
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cierre desasistido de pools que llegaron a su fecha_limite sin alcanzar la meta de volumen.
   */
  async cerrarPoolsExpirados(): Promise<CerrarPoolsExpiradosResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const poolsExpirados = await client.query(
        `SELECT id, volumen_acumulado, meta_volumen, unidad_medida, tipo_producto
         FROM pools_compra_mayorista
         WHERE estado = 'ABIERTO' AND fecha_limite <= NOW()
         FOR UPDATE SKIP LOCKED`
      );

      const affectedIds: string[] = [];

      for (const row of poolsExpirados.rows) {
        await client.query(
          `UPDATE pools_compra_mayorista
           SET estado = 'EXPIRADO_FALLIDO',
               updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );

        await client.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, $3, $4)`,
          [
            'POOL_MAYORISTA',
            row.id,
            'POOL_EXPIRADO_FALLIDO',
            JSON.stringify({
              pool_id: row.id,
              volumen_final: Number(row.volumen_acumulado),
              meta_volumen: Number(row.meta_volumen),
              unidad_medida: row.unidad_medida,
              tipo_producto: row.tipo_producto,
              fecha_cierre: new Date().toISOString()
            })
          ]
        );

        affectedIds.push(row.id);
      }

      await client.query('COMMIT');
      return {
        cerrados_count: affectedIds.length,
        pools_afectados: affectedIds
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Consulta las participaciones de un pool.
   */
  async listarParticipaciones(poolId: string): Promise<ParticipacionPool[]> {
    const res = await this.pool.query(
      `SELECT * FROM pool_participaciones WHERE pool_id = $1 ORDER BY created_at ASC`,
      [poolId]
    );
    return res.rows.map(mapParticipacionRow);
  }
}
