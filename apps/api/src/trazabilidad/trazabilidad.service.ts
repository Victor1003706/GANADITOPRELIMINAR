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
    if (!input