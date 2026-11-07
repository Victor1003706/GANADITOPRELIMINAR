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
   * Distancia entre dos establecimientos usando la posición que el VISITANTE puede ver
   * (Ley 29733): un ESTABLO de otra organización se mide desde su punto en la rejilla de
   * 0.01°. Con la distancia exacta, tres consultas desde anclas conocidas triangulaban
   * la ubicación del establo y anulaban la privacidad del mapa.
   */
  async obtenerDistanciaEstablecimientos(
    origenEstablecimientoId: string,
    destinoEstablecimientoId: string,
    visitanteOrgId: string | null,
    client?: pg.PoolClient
  ): Promise<number> {
    const executor = client ?? this.pool;

    const res = await executor.query<{
      origen_existe: boolean;
      destino_existe: boolean;
      distancia_km: string | null;
    }>(
      `SELECT 
         (SELECT EXISTS(SELECT 1 FROM establecimientos WHERE id = $1)) AS origen_existe,
         (SELECT EXISTS(SELECT 1 FROM establecimientos WHERE id = $2)) AS destino_existe,
         (
           SELECT ST_Distance(${sqlPosicionPublica('o', '$3')}, ${sqlPosicionPublica('d', '$3')}) / 1000.0
           FROM establecimientos o, establecimientos d
           WHERE o.id = $1 AND d.id = $2
         ) AS distancia_km;`,
      [origenEstablecimientoId, destinoEstablecimientoId, visitanteOrgId]
    );

    const row = res.rows[0];
    if (!row?.origen_existe) {
      throw new LogisticaError('Establecimiento de origen no encontrado.', 404);
    }
    if (!row?.destino_existe) {
      throw new LogisticaError('Establecimiento de destino no encontrado.', 404);
    }

    const distancia = row.distancia_km !== null ? Number(row.distancia_km) : 0;
    return Number(distancia.toFixed(2));
  }

  /**
   * POST /api/v1/logistica/cotizar
   * Calcula la distancia PostGIS y cotiza el flete sin persistir.
   */
  async cotizarFlete(input: CotizarFleteInput, visitanteOrgId: string | null): Promise<CotizacionFleteResult> {
    if (!input.origen_establecimiento_id || !input.destino_establecimiento_id) {
      throw new LogisticaError('Debe especificar origen_establecimiento_id y destino_establecimiento_id.', 400);
    }

    if (!input.tipo_unidad || !TIPOS_UNIDAD_VALIDOS.includes(input.tipo_unidad)) {
      throw new LogisticaError(
        `tipo_unidad no válido. Valores permitidos: ${TIPOS_UNIDAD_VALIDOS.join(', ')}`,
        400
      );
    }

    if (typeof input.peso_toneladas !== 'number' || input.peso_toneladas <= 0) {
      throw new LogisticaError('peso_toneladas debe ser un número mayor a 0.', 400);
    }

    const distanciaKm = await this.obtenerDistanciaEstablecimientos(
      input.origen_establecimiento_id,
      input.destino_establecimiento_id,
      visitanteOrgId
    );

    // Mismas tarifas que crearSolicitud: la cotización no puede diferir del precio guardado.
    return calcularCotizacionFlete(distanciaKm, input.peso_toneladas, input.tipo_unidad);
  }

  /**
   * Registra una unidad de transporte homologada para un transportista.
   */
  async registrarUnidad(
    transportistaId: string,
    organizacionId: string,
    input: RegistrarUnidadInput
  ): Promise<UnidadTransporte> {
    if (!input.placa || typeof input.placa !== 'string' || input.placa.trim().length === 0) {
      throw new LogisticaError('La placa del vehículo es obligatoria.', 400);
    }

    if (!input.tipo_unidad || !TIPOS_UNIDAD_VALIDOS.includes(input.tipo_unidad)) {
      throw new LogisticaError(
        `tipo_unidad no válido. Valores permitidos: ${TIPOS_UNIDAD_VALIDOS.join(', ')}`,
        400
      );
    }

    if (typeof input.capacidad_toneladas !== 'number' || input.capacidad_toneladas <= 0) {
      throw new LogisticaError('capacidad_toneladas debe ser mayor a 0.', 400);
    }

    const placaLimpia = input.placa.trim().toUpperCase();

    try {
      const res = await this.pool.query(
        `INSERT INTO transportistas_unidades (
           organizacion_id,
           transportista_id,
           placa,
           tipo_unidad,
           capacidad_toneladas,
           capacidad_cabezas,
           tiene_termoregistrador,
           activa
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         RETURNING *;`,
        [
          organizacionId,
          transportistaId,
          placaLimpia,
          input.tipo_unidad,
          input.capacidad_toneladas,
          input.capacidad_cabezas ?? null,
          Boolean(input.tiene_termoregistrador)
        ]
      );

      return mapUnidadRow(res.rows[0]);
    } catch (err: any) {
      if (err.code === '23505') {
        throw new LogisticaError(`Ya existe una unidad de transporte registrada con la placa ${placaLimpia}.`, 409);
      }
      throw err;
    }
  }

  /**
   * Lista unidades asociadas a un transportista.
   */
  async listarUnidadesTransportista(transportistaId: string): Promise<UnidadTransporte[]> {
    const res = await this.pool.query(
      `SELECT * FROM transportistas_unidades WHERE transportista_id = $1 ORDER BY created_at DESC;`,
      [transportistaId]
    );
    return res.rows.map(mapUnidadRow);
  }

  /**
   * POST /api/v1/logistica/solicitudes
   * Crea una solicitud de flete en estado 'PENDIENTE_ASIGNACION'.
   */
  async crearSolicitud(
    solicitanteId: string,
    organizacionId: string,
    input: CrearSolicitudFleteInput
  ): Promise<SolicitudFlete> {
    if (!input.origen_establecimiento_id || !input.destino_establecimiento_id) {
      throw new LogisticaError('Debe indicar los establecimientos de origen y destino.', 400);
    }

    if (!input.tipo_carga || !TIPOS_CARGA_VALIDOS.includes(input.tipo_carga)) {
      throw new LogisticaError(
        `tipo_carga no válido. Valores permitidos: ${TIPOS_CARGA_VALIDOS.join(', ')}`,
        400
      );
    }

    if (!input.tipo_unidad || !TIPOS_UNIDAD_VALIDOS.includes(input.tipo_unidad)) {
      throw new LogisticaError(
        `tipo_unidad no válido. Valores permitidos: ${TIPOS_UNIDAD_VALIDOS.join(', ')}`,
        400
      );
    }

    if (typeof input.peso_toneladas !== 'number' || input.peso_toneladas <= 0) {
      throw new LogisticaError('peso_toneladas debe ser un valor numérico positivo.', 400);
    }

    // La orden debe ser de la organización activa (compradora o vendedora). Si no, 404
    // opaco: no se revela si existe una orden ajena.
    if (input.orden_compra_id) {
      const ocRes = await this.pool.query(
        `SELECT id FROM ordenes_compra
         WHERE id::text = $1 AND (organizacion_compradora_id = $2 OR organizacion_vendedora_id = $2)`,
        [input.orden_compra_id, organizacionId]
      );
      if (ocRes.rows.length === 0) {
        throw new LogisticaError('Orden de compra no encontrada.', 404);
      }
    }

    // Calcular distancia geográfica y cotización
    // Al menos un extremo debe ser de la organización solicitante: no se crean fletes
    // entre establecimientos ajenos (sería otra vía de consulta de distancias).
    const propios = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM establecimientos WHERE id = ANY($1::uuid[]) AND organizacion_id = $2`,
      [[input.origen_establecimiento_id, input.destino_establecimiento_id], organizacionId]
    );
    if ((propios.rows[0]?.n ?? 0) === 0) {
      throw new LogisticaError('El origen o el destino debe ser un establecimiento de su organización.', 403);
    }

    const distanciaKm = await this.obtenerDistanciaEstablecimientos(
      input.origen_establecimiento_id,
      input.destino_establecimiento_id,
      organizacionId
    );

    const cotizacion = calcularCotizacionFlete(
      distanciaKm,
      input.peso_toneladas,
      input.tipo_unidad
    );

    const insertRes = await this.pool.query(
      `INSERT INTO fletes_solicitudes (
         orden_compra_id,
         solicitante_id,
         origen_establecimiento_id,
         destino_establecimiento_id,
         tipo_carga,
         peso_toneladas,
         distancia_km,
         costo_flete_bruto,
         comision_referral_fee,
         total_flete,
         estado
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDIENTE_ASIGNACION')
       RETURNING *;`,
      [
        input.orden_compra_id ?? null,
        solicitanteId,
        input.origen_establecimiento_id,
        input.destino_establecimiento_id,
        input.tipo_carga,
        cotizacion.peso_toneladas,
        cotizacion.distancia_km,
        cotizacion.costo_flete_bruto,
        cotizacion.comision_referral_fee,
        cotizacion.total_flete
      ]
    );

    return mapSolicitudRow(insertRes.rows[0]);
  }

  /**
   * POST /api/v1/logistica/solicitudes/:id/tomar-flete
   * Adquiere un flete de manera atómica con SELECT ... FOR UPDATE.
   */
  async tomarFlete(
    transportistaId: string,
    solicitudId: string,
    input: TomarFleteInput
  ): Promise<SolicitudFlete> {
    if (!input.unidad_id) {
      throw new LogisticaError('Debe especificar la unidad_id para tomar el flete.', 400);
    }

    // 1. Validar que la unidad exista, pertenezca al transportista y esté activa
    const unidadRes = await this.pool.query<{
      id: string;
      transportista_id: string;
      activa: boolean;
      tipo_unidad: string;
      capacidad_toneladas: string;
    }>(
      `SELECT id, transportista_id, activa, tipo_unidad, capacidad_toneladas
       FROM transportistas_unidades
       WHERE id = $1;`,
      [input.unidad_id]
    );

    if (unidadRes.rows.length === 0) {
      throw new LogisticaError('La unidad de transporte especificada no existe.', 404);
    }

    const unidad = unidadRes.rows[0]!;
    if (unidad.transportista_id !== transportistaId) {
      throw new LogisticaError('La unidad de transporte no pertenece al transportista autenticado.', 403);
    }
    if (!unidad.activa) {
      throw new LogisticaError('La unidad de transporte se encuentra inactiva.', 400);
    }

    // 2. Transacción atómica con SELECT ... FOR UPDATE
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const fleteRes = await client.query<{
        id: string;
        estado: EstadoSolicitudFlete;
        peso_toneladas: string;
        total_flete: string;
      }>(
        `SELECT id, estado, peso_toneladas, total_flete
         FROM fletes_solicitudes
         WHERE id = $1
         FOR UPDATE;`,
        [solicitudId]
      );

      if (fleteRes.rows.length === 0) {
        throw new LogisticaError('La solicitud de flete no existe.', 404);
      }

      const flete = fleteRes.rows[0]!;
      if (flete.estado !== 'PENDIENTE_ASIGNACION') {
        throw new LogisticaError(
          `La solicitud de flete no está disponible para asignación (estado actual: ${flete.estado}).`,
          409
        );
      }

      // 3. Asignar unidad y transportista, transicionar a ASIGNADO
      const updateRes = await client.query(
        `UPDATE fletes_solicitudes
         SET 
           unidad_id = $1,
           transportista_id = $2,
           estado = 'ASIGNADO',
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *;`,
        [input.unidad_id, transportistaId, solicitudId]
      );

      // 4. Registrar evento Outbox 'FLETE_ASIGNADO'
      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb);`,
        [
          'FLETE',
          solicitudId,
          'FLETE_ASIGNADO',
          JSON.stringify({
            solicitud_id: solicitudId,
            transportista_id: transportistaId,
            unidad_id: input.unidad_id,
            total_flete: Number(flete.total_flete),
            asignado_en: new Date().toISOString()
          })
        ]
      );

      await client.query('COMMIT');
      return mapSolicitudRow(updateRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * PATCH /api/v1/logistica/solicitudes/:id/estado
   * Transiciona estados ('EN_TRANSITO' -> 'ENTREGADO') e inserta 'FLETE_COMPLETADO'.
   */
  async actualizarEstado(
    userId: string,
    solicitudId: string,
    nuevoEstado: 'EN_TRANSITO' | 'ENTREGADO'
  ): Promise<SolicitudFlete> {
    if (!['EN_TRANSITO', 'ENTREGADO'].includes(nuevoEstado)) {
      throw new LogisticaError(
        `Transición no permitida. Solo se permite actualizar a 'EN_TRANSITO' o 'ENTREGADO'.`,
        400
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const fleteRes = await client.query<{
        id: string;
        estado: EstadoSolicitudFlete;
        transportista_id: string | null;
        total_flete: string;
      }>(
        `SELECT id, estado, transportista_id, total_flete
         FROM fletes_solicitudes
         WHERE id = $1
         FOR UPDATE;`,
        [solicitudId]
      );

      if (fleteRes.rows.length === 0) {
        throw new LogisticaError('La solicitud de flete no existe.', 404);
      }

      const flete = fleteRes.rows[0]!;

      if (flete.transportista_id !== userId) {
        throw new LogisticaError('Solo el transportista asignado puede actualizar el estado del viaje.', 403);
      }

      // Validar máquina de estados
      if (nuevoEstado === 'EN_TRANSITO' && flete.estado !== 'ASIGNADO') {
        throw new LogisticaError(
          `No se puede iniciar tránsito: la solicitud está en estado '${flete.estado}', se requiere 'ASIGNADO'.`,
          400
        );
      }

      if (nuevoEstado === 'ENTREGADO' && flete.estado !== 'EN_TRANSITO') {
        throw new LogisticaError(
          `No se puede marcar como entregado: la solicitud está en estado '${flete.estado}', se requiere 'EN_TRANSITO'.`,
          400
        );
      }

      const updateRes = await client.query(
        `UPDATE fletes_solicitudes
         SET estado = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *;`,
        [nuevoEstado, solicitudId]
      );

      // Si llegó a destino ('ENTREGADO'), emitir evento 'FLETE_COMPLETADO'
      if (nuevoEstado === 'ENTREGADO') {
        await client.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, $3, $4::jsonb);`,
          [
            'FLETE',
            solicitudId,
            'FLETE_COMPLETADO',
            JSON.stringify({
              solicitud_id: solicitudId,
              transportista_id: flete.transportista_id,
              estado: 'ENTREGADO',
              total_flete: Number(flete.total_flete),
              completado_en: new Date().toISOString()
            })
          ]
        );
      } else if (nuevoEstado === 'EN_TRANSITO') {
        await client.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, $3, $4::jsonb);`,
          [
            'FLETE',
            solicitudId,
            'FLETE_EN_TRANSITO',
            JSON.stringify({
              solicitud_id: solicitudId,
              transportista_id: flete.transportista_id,
              estado: 'EN_TRANSITO',
              iniciado_en: new Date().toISOString()
            })
          ]
        );
      }

      await client.query('COMMIT');
      return mapSolicitudRow(updateRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Obtiene una solicitud de flete por ID.
   */
  /**
   * Visible para: quien la solicitó, el transportista asignado, las organizaciones de la
   * orden vinculada y, mientras está PENDIENTE_ASIGNACION, un TRANSPORTISTA que busca carga.
   */
  async obtenerSolicitudPorId(solicitudId: string, visor: VisorFlete): Promise<SolicitudFlete> {
    const res = await this.pool.query(
      `SELECT f.* FROM fletes_solicitudes f
       WHERE f.id::text = $4 AND ${SQL_FLETE_VISIBLE}`,
      [visor.userId, visor.organizacionId ?? null, visor.esTransportista, solicitudId]
    );
    if (res.rows.length === 0) {
      throw new LogisticaError('Solicitud de flete no encontrada.', 404);
    }
    return proyectarParaVisor(mapSolicitudRow(res.rows[0]), visor);
  }

  /**
   * Lista solicitudes de flete según filtros.
   */
  async listarSolicitudes(visor: VisorFlete, filtros?: {
    estado?: EstadoSolicitudFlete;
    transportista_id?: string;
  }): Promise<SolicitudFlete[]> {
    const values: any[] = [visor.userId, visor.organizacionId ?? null, visor.esTransportista];
    const conditions: string[] = [SQL_FLETE_VISIBLE];

    if (filtros?.estado) {
      values.push(filtros.estado);
      conditions.push(`f.estado = $${values.length}`);
    }

    if (filtros?.transportista_id) {
      values.push(filtros.transportista_id);
      conditions.push(`f.transportista_id = $${values.length}`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const query = `SELECT f.* FROM fletes_solicitudes f ${whereClause} ORDER BY f.created_at DESC LIMIT 200;`;

    const res = await this.pool.query(query, values);
    return res.rows.map((row) => proyectarParaVisor(mapSolicitudRow(row), visor));
  }
}
