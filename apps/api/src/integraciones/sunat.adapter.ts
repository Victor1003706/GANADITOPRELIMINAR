import type pg from 'pg';
import crypto from 'node:crypto';
import type {
  TipoComprobanteTributario,
  EstadoIntegracionTributaria,
  TipoDocumentoReceptor,
  LiquidacionCompraInput,
  ComprobanteFiscalRecord,
  EmisionComprobanteResponse,
  ConciliacionPendientesResponse
} from '@ganadito/contracts';

export class SunatError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'SunatError';
  }
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface SunatAdapterOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  forceFailureSimulation?: boolean;
}

function mapComprobanteRow(row: any): ComprobanteFiscalRecord {
  return {
    id: row.id,
    orden_id: row.orden_id,
    tipo_comprobante: row.tipo_comprobante,
    serie: String(row.serie).trim(),
    correlativo: Number(row.correlativo),
    emisor_ruc: String(row.emisor_ruc).trim(),
    receptor_num_doc: String(row.receptor_num_doc).trim(),
    receptor_tipo_doc: row.receptor_tipo_doc,
    monto_subtotal: Number(row.monto_subtotal),
    monto_igv: Number(row.monto_igv),
    monto_total: Number(row.monto_total),
    estado_sunat: row.estado_sunat,
    external_correlation_id: row.external_correlation_id,
    xml_payload_resumen:
      typeof row.xml_payload_resumen === 'string'
        ? JSON.parse(row.xml_payload_resumen)
        : row.xml_payload_resumen,
    cdr_sunat_codigo: row.cdr_sunat_codigo ?? null,
    cdr_sunat_mensaje: row.cdr_sunat_mensaje ?? null,
    retry_count: Number(row.retry_count),
    next_retry_at: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString()
  };
}

export class SunatAdapter {
  private circuitState: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private forceFailureSimulation: boolean;

  constructor(
    private readonly pool: pg.Pool,
    options: SunatAdapterOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 10000;
    this.forceFailureSimulation = options.forceFailureSimulation ?? false;
  }

  public setForceFailureSimulation(enabled: boolean): void {
    this.forceFailureSimulation = enabled;
  }

  public getCircuitState(): CircuitBreakerState {
    if (
      this.circuitState === 'OPEN' &&
      Date.now() - this.lastFailureTime >= this.resetTimeoutMs
    ) {
      this.circuitState = 'HALF_OPEN';
    }
    return this.circuitState;
  }

  public resetCircuit(): void {
    this.circuitState = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.forceFailureSimulation = false;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitState = 'CLOSED';
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitState = 'OPEN';
    }
  }

  /**
   * Obtiene el siguiente correlativo monótono dentro de una transacción serializable.
   */
  async obtenerSiguienteCorrelativo(
    client: pg.PoolClient,
    tipoComprobante: TipoComprobanteTributario,
    serie: string
  ): Promise<number> {
    const res = await client.query<{ max_corr: number | null }>(
      `SELECT MAX(correlativo) AS max_corr
       FROM comprobantes_tributarios
       WHERE tipo_comprobante = $1 AND serie = $2`,
      [tipoComprobante, serie]
    );

    const actual = res.rows[0]?.max_corr;
    return (actual ? Number(actual) : 0) + 1;
  }

  /**
   * Genera y despacha una Liquidación de Compra Electrónica (SEE-SUNAT)
   * vinculada a una orden de compra liquidada y a un productor agropecuario con DNI.
   */
  as