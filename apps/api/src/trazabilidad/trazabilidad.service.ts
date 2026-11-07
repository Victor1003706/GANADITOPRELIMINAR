import type pg from 'pg';
import {
  type Bovino,
  type EventoTrazabilidad,
  type RegistrarBovinoInput,
  type AgregarEventoInput,
  type PasaporteDigitalVista,
  type BovinoPublico,
  type EventoTrazabilidadPublico,
  type VerificacionCadenaResponse,
  esTipoEventoTrazabilidad,
  TIPOS_EVENTO_TRAZABILIDAD,
  GENESIS_PREV_HASH,
  calcularHashEvento
} from '@ganadito/contracts';

const CLAVE_SENSIBLE = /(lat|lon|lng|coord|gps|ubicacion|direccion|geo|dni|ruc|telefono|celular|email|correo|placa)/i;

/** Redacta (recursivamente) las claves de metadata que revelan ubicación o datos personales. */
export function redactarMetadata(valor: unknown): Record<string, unknown> {
  const redactar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(redactar);
    if (v && typeof v === 'object') {
      // Sin prototipo: una clave "__proto__" queda como propiedad propia, no altera el objeto.
      const out: Record<string, unknown> = Object.create(null);
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = CLAVE_SENSIBLE.test(k) ? '[REDACTADO]' : redactar(val);
      }
      return out;
    }
    return v;
  };
  return (redactar(valor ?? {}) as Record<string, unknown>) ?? {};
}

/**
 * Lista BLANCA de metadata pública por tipo de evento (vista QR). Todo lo demás sale
 * como '[REDACTADO]': un campo nuevo no se publica por accidente (antes bastaba con que
 * su nombre no coincidiera con la lista negra, p. ej. "origen" o "fundo_nacimiento").
 * Solo se publican valores primitivos; objetos y arreglos se redactan.
 */
// Map (no objeto literal): METADATA_PUBLICA.get('constructor') es undefined, mientras que
// un objeto devolvería Object.prototype.constructor y .has() lanzaría TypeError (500).
export const METADATA_PUBLICA: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  ['REGISTRO_INICIAL', new Set(['raza', 'sexo', 'fecha_nacimiento', 'peso_nacimiento_kg', 'tipo_parto'])],
  ['VACUNACION', new Set(['vacuna', 'dosis_ml', 'lote', 'campana_oficial', 'fecha'])],
  ['TRATAMIENTO', new Set(['producto', 'dosis_ml', 'dias_retiro', 'fecha_fin_retiro', 'fecha'])],
  ['PESAJE', new Set(['peso_vivo_kg', 'fecha'])],
  ['MOVILIZACION_CSTI', new Set(['csti_numero', 'guia_senasa', 'guia_transito_senasa', 'origen_distrito', 'destino_distrito', 'fecha'])],
  ['PESAJE_CAMAL', new Set(['camal_nombre', 'camal_codigo_oficial', 'peso_vivo_kg', 'peso_canal_caliente_kg', 'rendimiento_canal_pct'])],
  ['INSPECCION_POST_MORTEM', new Set(['camal_codigo_oficial', 'dictamen_post_mortem', 'resultado'])],
  ['CAMBIO_PROPIEDAD', new Set(['fecha'])]
]);

const SIN_CLAVES_PUBLICAS: ReadonlySet<string> = new Set();

export function proyectarMetadataPublica(eventType: string, metadata: unknown): Record<string, unknown> {
  const permitidas = METADATA_PUBLICA.get(eventType) ?? SIN_CLAVES_PUBLICAS;
  const out: Record<string, unknown> = Object.create(null);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return out;
  for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
    const primitivo = v === null || ['string', 'number', 'boolean'].includes(typeof v);
    out[k] = permitidas.has(k) && primitivo && !CLAVE_SENSIBLE.test(k) ? v : '[REDACTADO]';
  }
  return out;
}

const EVENTOS_CAMAL = new Set(['PESAJE_CAMAL', 'INSPECCION_POST_MORTEM']);

export class TrazabilidadError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'TrazabilidadError';
  }
}

export class TrazabilidadService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Registra un nuevo bovino y su correspondiente evento génesis (secuencia 1)
   * de forma atómica dentro de una transacción.
   */
  async registrarBovino(
    userId: string,
    activeOrgId: string,
    input: RegistrarBovinoInput
  ): Promise<{ bovino: Bovino; eventoGenesis: EventoTrazabilidad }> {
    if (!input.codigo_arete || typeof input.codigo_arete !== 'string' || input.codigo_arete.trim().length === 0) {
      throw new TrazabilidadError('El código de arete es obligatorio.', 400);
    }

    if (!input.sexo || (input.sexo !== 'MACHO' && input.sexo !== 'HEMBRA')) {
      throw new TrazabilidadError("El sexo del bovino debe ser 'MACHO' o 'HEMBRA'.", 400);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verificar unicidad del código de arete
      const checkResult = await client.query(
        `SELECT id FROM bovinos WHERE codigo_arete = $1`,
        [input.codigo_arete.trim()]
      );

      if (checkResult.rows.length > 0) {
        throw new TrazabilidadError(
          `Ya existe un bovino registrado con el código de arete '${input.codigo_arete.trim()}'.`,
          409
        );
      }

      // 1. Insertar el registro principal del bovino
      const insertBovinoRes = await client.query<Bovino>(
        `INSERT INTO bovinos (codigo_arete, organizacion_id, raza, sexo, fecha_nacimiento, estado)
         VALUES ($1, $2, $3, $4, $5, 'VIVO')
         RETURNING *`,
        [
          input.codigo_arete.trim(),
          activeOrgId,
          input.raza?.trim() ?? null,
          input.sexo,
          input.fecha_nacimiento ?? null
        ]
      );
      const bovino = insertBovinoRes.rows[0]!;

      // 2. Generar el evento génesis
      const metadata = input.metadata ?? {};
      const secuencia = 1;
      const prevHash = GENESIS_PREV_HASH;
      const eventType = 'REGISTRO_INICIAL';
      const currentHash = calcularHashEvento(prevHash, bovino.id, secuencia, eventType, metadata);

      const insertEventRes = await client.query<EventoTrazabilidad>(
        `INSERT INTO pasaporte_bovino_events (bovino_id, secuencia, event_type, metadata, prev_hash, current_hash, autor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          bovino.id,
          secuencia,
          eventType,
          JSON.stringify(metadata),
          prevHash,
          currentHash,
          userId
        ]
      );
      const eventoGenesis = insertEventRes.rows[0]!;

      // 3. Emisión de Outbox Event para sincronización y difusión
      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, $3, $4)`,
        [
          'BOVINO',
          bovino.id,
          'PASAPORTE_BOVINO_ACTUALIZADO',
          JSON.stringify({
            bovino_id: bovino.id,
            secuencia,
            event_type: eventType,
            current_hash: currentHash
          })
        ]
      );

      await client.query('COMMIT');
      return { bovino, eventoGenesis };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Añade un nuevo hito/evento a la cadena criptográfica del pasaporte bovino
   * con control de concurrencia pesimista (FOR UPDATE).
   */
  async agregarEvento(
    userId: string,
    activeOrgId: string,
    bovinoId: string,
    input: AgregarEventoInput,
    activeRole?: string
  ): Promise<EventoTrazabilidad> {
    if (!input.event_type) {
      throw new TrazabilidadError('El campo event_type es obligatorio.', 400);
    }
    if (!esTipoEventoTrazabilidad(input.event_type)) {
      throw new TrazabilidadError(
        `event_type inválido. Valores admitidos: ${TIPOS_EVENTO_TRAZABILIDAD.join(', ')}.`,
        400
      );
    }
    const metadata = input.metadata ?? {};

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Bloqueo pesimista del bovino
      const bovinoRes = await client.query<Bovino>(
        `SELECT * FROM bovinos WHERE id = $1 FOR UPDATE`,
        [bovinoId]
      );
      if (bovinoRes.rows.length === 0) {
        throw new TrazabilidadError('Bovino no encontrado.', 404);
      }
      const bovino = bovinoRes.rows[0]!;

      // Autorización: la organización propietaria registra cualquier evento; un operador de
      // camal de otra organización solo puede registrar eventos de faena. Nadie más escribe
      // en un pasaporte ajeno, y solo el propietario transfiere la propiedad.
      const esPropietario = bovino.organizacion_id === activeOrgId;
      const esEventoCamal = EVENTOS_CAMAL.has(input.event_type);
      if (!esPropietario && !(esEventoCamal && activeRole === 'OPERADOR_CAMAL')) {
        throw new TrazabilidadError('No tiene permiso para registrar eventos en este bovino.', 403);
      }

      // 2. Obtener el último evento para calcular secuencia y prev_hash encadenado
      const lastEventRes = await client.query<EventoTrazabilidad>(
        `SELECT * FROM pasaporte_bovino_events
         WHERE bovino_id = $1
         ORDER BY secuencia DESC
         LIMIT 1
         FOR UPDATE`,
        [bovinoId]
      );
      if (lastEventRes.rows.length === 0) {
        throw new TrazabilidadError('Cadena de pasaporte corrupta: no se halló evento génesis.', 500);
      }
      const lastEvent = lastEventRes.rows[0]!;

      const nextSecuencia = Number(lastEvent.secuencia) + 1;
      const prevHash = lastEvent.current_hash;
      const currentHash = calcularHashEvento(
        prevHash,
        bovinoId,
        nextSecuencia,
        input.event_type,
        metadata
      );

      // Si el evento es PESAJE_CAMAL o INSPECCION_POST_MORTEM, transicionar a FAENADO
      if (input.event_type === 'PESAJE_CAMAL' || input.event_type === 'INSPECCION_POST_MORTEM') {
        await client.query(
          `UPDATE bovinos SET estado = 'FAENADO', updated_at = NOW() WHERE id = $1`,
          [bovinoId]
        );
      }

      // Si es CAMBIO_PROPIEDAD con nueva organización receptora
      if (input.event_type === 'CAMBIO_PROPIEDAD') {
        const nuevaOrgId = (metadata as any)?.nueva_organizacion_id;
        if (typeof nuevaOrgId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nuevaOrgId)) {
          throw new TrazabilidadError('CAMBIO_PROPIEDAD requiere metadata.nueva_organizacion_id.', 400);
        }
        const destino = await client.query('SELECT 1 FROM organizaciones WHERE id = $1', [nuevaOrgId]);
        if (destino.rowCount === 0) {
          throw new TrazabilidadError('La organización de destino no existe.', 400);
        }
        await client.query(
          `UPDATE bovinos SET organizacion_id = $1, estado = 'TRANSFERIDO', updated_at = NOW() WHERE id = $2`,
          [nuevaOrgId, bovinoId]
        );
      }

      // 3. Insertar el evento encadenado inmutable
      const insertEventRes = await client.query<EventoTrazabilidad>(
        `INSERT INTO pasaporte_bovino_events (bovino_id, secuencia, event_type, metadata, prev_hash, current_hash, autor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          bovinoId,
          nextSecuencia,
          input.event_type,
          JSON.stringify(metadata),
          prevHash,
          currentHash,
          userId
        ]
      );
      const nuevoEvento = insertEventRes.rows[0]!;

      // 4. Emisión de Outbox Event
      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, $3, $4)`,
        [
          'BOVINO',
          bovinoId,
          'PASAPORTE_BOVINO_ACTUALIZADO',
          JSON.stringify({
            bovino_id: bovinoId,
            secuencia: nextSecuencia,
            event_type: input.event_type,
            current_hash: currentHash
          })
        ]
      );

      await client.query('COMMIT');
      return nuevoEvento;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Consulta el pasaporte digital completo: datos del bovino y eventos ordenados por secuencia.
   */
  async obtenerPasaporte(bovinoId: string, viewerOrgId?: string): Promise<PasaporteDigitalVista> {
    const bovinoRes = await this.pool.query<Bovino>(
      `SELECT * FROM bovinos WHERE id = $1`,
      [bovinoId]
    );
    if (bovinoRes.rows.length === 0) {
      throw new TrazabilidadError('Bovino no encontrado.', 404);
    }
    const bovino = bovinoRes.rows[0]!;

    const eventosRes = await this.pool.query<EventoTrazabilidad>(
      `SELECT * FROM pasaporte_bovino_events
       WHERE bovino_id = $1
       ORDER BY secuencia ASC`,
      [bovinoId]
    );

    // Vista pública (QR): sin autor, metadata por lista blanca y SIN hashes (un hash de un
    // dato privado de baja entropía permite adivinarlo probando candidatos). La integridad
    // se verifica con GET /bovinos/:id/verificar, que recalcula la cadena en el servidor.
    if (viewerOrgId && viewerOrgId === bovino.organizacion_id) {
      return { bovino, eventos: eventosRes.rows, vista: 'COMPLETA' };
    }
    // Proyección explícita: la vista pública no revela qué organización es dueña del animal.
    const bovinoPublico: BovinoPublico = {
      id: bovino.id,
      codigo_arete: bovino.codigo_arete,
      organizacion_id: null,
      raza: bovino.raza,
      sexo: bovino.sexo,
      fecha_nacimiento: bovino.fecha_nacimiento,
      estado: bovino.estado,
      created_at: bovino.created_at,
      updated_at: bovino.updated_at
    };
    return {
      bovino: bovinoPublico,
      eventos: eventosRes.rows.map((e): EventoTrazabilidadPublico => ({
        id: e.id,
        bovino_id: e.bovino_id,
        secuencia: e.secuencia,
        event_type: e.event_type,
        metadata: proyectarMetadataPublica(e.event_type, e.metadata),
        autor_id: null,
        created_at: e.created_at
      })),
      vista: 'PUBLICA'
    };
  }

  /**
   * Auditoría de integridad criptográfica:
   * Valida secuencia contigua (1..N), continuidad de hashes encadenados
   * y correspondencia exacta de cada SHA-256.
   */
  async verificarIntegridadPasaporte(bovinoId: string): Promise<VerificacionCadenaResponse> {
    const bovinoRes = await this.pool.query<Bovino>(
      `SELECT id FROM bovinos WHERE id = $1`,
      [bovinoId]
    );
    if (bovinoRes.rows.length === 0) {
      throw new TrazabilidadError('Bovino no encontrado.', 404);
    }

    const eventosRes = await this.pool.query<EventoTrazabilidad>(
      `SELECT * FROM pasaporte_bovino_events
       WHERE bovino_id = $1
       ORDER BY secuencia ASC`,
      [bovinoId]
    );

    const eventos = eventosRes.rows;
    if (eventos.length === 0) {
      return {
        integro: false,
        total_eventos: 0,
        detalle: 'No existen eventos de trazabilidad registrados para este bovino.'
      };
    }

    for (let i = 0; i < eventos.length; i++) {
      const evento = eventos[i]!;
      const expectedSecuencia = i + 1;

      // 1. Validar secuencia contigua
      if (Number(evento.secuencia) !== expectedSecuencia) {
        return {
          integro: false,
          total_eventos: eventos.length,
          secuencia_corrupta: Number(evento.secuencia),
          detalle: `Secuencia inválida: se esperaba ${expectedSecuencia} pero se encontró ${evento.secuencia}.`
        };
      }

      // 2. Validar encadenamiento de prev_hash
      const expectedPrevHash = i === 0 ? GENESIS_PREV_HASH : eventos[i - 1]!.current_hash;
      if (evento.prev_hash !== expectedPrevHash) {
        return {
          integro: false,
          total_eventos: eventos.length,
          secuencia_corrupta: Number(evento.secuencia),
          detalle: `Discrepancia en prev_hash en la secuencia ${evento.secuencia}.`
        };
      }

      // 3. Recalcular y validar current_hash
      const recalculatedHash = calcularHashEvento(
        evento.prev_hash,
        bovinoId,
        Number(evento.secuencia),
        evento.event_type,
        evento.metadata
      );

      if (evento.current_hash !== recalculatedHash) {
        return {
          integro: false,
          total_eventos: eventos.length,
          secuencia_corrupta: Number(evento.secuencia),
          detalle: `Hash criptográfico alterado o inválido en la secuencia ${evento.secuencia}.`
        };
      }
    }

    return {
      integro: true,
      total_eventos: eventos.length
    };
  }
}
