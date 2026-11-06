import type pg from 'pg';
import crypto from 'node:crypto';
import type { CheckoutInput, CheckoutResult, EstadoPago, WebhookPagoPayload } from '@ganadito/contracts';

export class PagoError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'PagoError';
  }
}

/**
 * Configuración del módulo de pagos. Por defecto el módulo está DESHABILITADO:
 * no hay proveedor habilitado ni cobros reales (ver AGENTS.md §2 y plan de reparto N06).
 */
export interface PagosConfig {
  enabled: boolean;
  webhookSecret?: string;
  /** Proveedor fijado por el servidor; el cliente no lo elige. */
  provider: string;
  /** URL base del checkout del proveedor (o del simulador aislado). */
  checkoutBaseUrl?: string;
  /** Ventana anti-replay en milisegundos. */
  replayWindowMs: number;
}

export const MIN_WEBHOOK_SECRET_LENGTH = 32;

/**
 * Resuelve la configuración desde variables de entorno con overrides opcionales,
 * y falla al arrancar si el módulo está habilitado sin la configuración mínima segura.
 */
export function resolvePagosConfig(overrides: Partial<PagosConfig> = {}): PagosConfig {
  const config: PagosConfig = {
    enabled: overrides.enabled ?? process.env.PAYMENTS_ENABLED === 'true',
    webhookSecret: overrides.webhookSecret ?? process.env.WEBHOOK_SECRET,
    provider: overrides.provider ?? process.env.PAYMENTS_PROVIDER ?? 'SIMULADOR',
    checkoutBaseUrl: overrides.checkoutBaseUrl ?? process.env.PAYMENTS_CHECKOUT_BASE_URL,
    replayWindowMs: overrides.replayWindowMs ?? 5 * 60 * 1000
  };

  if (config.enabled) {
    if (!config.webhookSecret || config.webhookSecret.length < MIN_WEBHOOK_SECRET_LENGTH) {
      throw new Error(
        `PAYMENTS_ENABLED=true requiere WEBHOOK_SECRET de al menos ${MIN_WEBHOOK_SECRET_LENGTH} caracteres.`
      );
    }
    if (!config.checkoutBaseUrl) {
      throw new Error('PAYMENTS_ENABLED=true requiere PAYMENTS_CHECKOUT_BASE_URL.');
    }
    try {
      new URL(config.checkoutBaseUrl);
    } catch {
      throw new Error('PAYMENTS_CHECKOUT_BASE_URL no es una URL válida.');
    }
  }

  return config;
}

/**
 * Genera la firma HMAC-SHA256 (hex) sobre `${timestamp}.${rawBody}`.
 * El timestamp forma parte obligatoria del mensaje firmado (protección anti-replay).
 */
export function generateHmacSignature(
  rawBody: string,
  secret: string,
  timestamp: string | number
): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Verifica en tiempo constante una firma HMAC-SHA256 hex sobre `${timestamp}.${rawBody}`.
 * No existe variante sin timestamp: aceptar firmas sólo del body permitiría reenviar
 * un body antiguo con un x-timestamp nuevo.
 */
export function verifyHmacSignature(
  rawBody: string,
  signatureHex: string,
  secret: string,
  timestamp: string | number
): boolean {
  if (!signatureHex || !secret) return false;

  const cleanSig = signatureHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanSig)) return false;

  const expected = Buffer.from(generateHmacSignature(rawBody, secret, timestamp), 'hex');
  const received = Buffer.from(cleanSig, 'hex');

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

/**
 * Interpreta x-timestamp como entero Unix en segundos o milisegundos.
 */
export function parseWebhookTimestampMs(raw: string): number | null {
  if (!/^\d{1,16}$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  return value < 1e11 ? value * 1000 : value;
}

const ESTADOS_EXITO = new Set(['CONFIRMADO', 'PAID', 'SUCCEEDED']);
const ESTADOS_FALLO = new Set(['FALLIDO', 'FAILED']);

function aCentimos(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export type MotivoConciliacion =
  | 'MONTO_NO_COINCIDE'
  | 'MONEDA_NO_COINCIDE'
  | 'ORDEN_NO_COINCIDE'
  | 'ORDEN_NO_PAGABLE';

export interface ResultadoWebhook {
  status: 'success' | 'rejected';
  transaccion_id: string;
  orden_id: string;
  estado: EstadoPago;
  idempotente: boolean;
  motivo?: MotivoConciliacion | 'PAGO_FALLIDO';
}

export class PagosService {
  constructor(
    private pool: pg.Pool,
    private config: PagosConfig
  ) {}

  /**
   * Inicia (o reutiliza) la intención de pago de una orden en PENDIENTE_PAGO.
   * La orden se bloquea FOR UPDATE para que dos checkouts simultáneos no creen
   * dos transacciones vivas sobre la misma orden.
   */
  async iniciarCheckout(
    userId: string,
    activeOrgId: string | undefined,
    input: CheckoutInput
  ): Promise<CheckoutResult> {
    const ordenIdInput = input?.orden_id;

    if (typeof ordenIdInput !== 'string' || !ordenIdInput.trim()) {
      throw new PagoError('orden_id es obligatorio para iniciar el checkout.', 400);
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const ordenRes = await client.query<{
        id: string;
        comprador_id: string;
        organizacion_compradora_id: string | null;
        total_a_pagar: string | number;
        estado: string;
      }>(
        `SELECT id, comprador_id, organizacion_compradora_id, total_a_pagar, estado
         FROM ordenes_compra
         WHERE id = $1
         FOR UPDATE`,
        [ordenIdInput.trim()]
      );

      if (ordenRes.rows.length === 0) {
        throw new PagoError('Orden de compra no encontrada.', 404);
      }

      const orden = ordenRes.rows[0]!;

      const isOwner =
        orden.comprador_id === userId ||
        (activeOrgId !== undefined && orden.organizacion_compradora_id === activeOrgId);

      if (!isOwner) {
        throw new PagoError('No tiene autorización para realizar el pago de esta orden de compra.', 403);
      }

      if (orden.estado !== 'PENDIENTE_PAGO') {
        throw new PagoError(
          `La orden de compra no se encuentra pendiente de pago (estado actual: ${orden.estado}).`,
          409
        );
      }

      const montoTotal = Number(orden.total_a_pagar);

      // Reutilizar una transacción viva en lugar de abrir una segunda (evita doble cobro).
      const vivaRes = await client.query<{
        id: string;
        monto: string | number;
        moneda: string;
        proveedor: string;
        referencia_externa: string;
      }>(
        `SELECT id, monto, moneda, proveedor, referencia_externa
         FROM pagos_transacciones
         WHERE orden_id = $1 AND estado = 'INICIADO'
         ORDER BY created_at DESC
         LIMIT 1`,
        [orden.id]
      );

      let transaccionId: string;
      let referenciaExterna: string;
      let proveedor: string;

      if (vivaRes.rows.length > 0) {
        const viva = vivaRes.rows[0]!;
        transaccionId = viva.id;
        referenciaExterna = viva.referencia_externa;
        proveedor = viva.proveedor;
      } else {
        transaccionId = crypto.randomUUID();
        referenciaExterna = `GANADITO-PAY-${Date.now()}-${transaccionId.slice(0, 8).toUpperCase()}`;
        proveedor = this.config.provider;

        await client.query(
          `INSERT INTO pagos_transacciones (
             id, orden_id, monto, moneda, proveedor, referencia_externa, estado
           ) VALUES ($1, $2, $3, 'PEN', $4, $5, 'INICIADO')`,
          [transaccionId, orden.id, montoTotal, proveedor, referenciaExterna]
        );
      }

      await client.query('COMMIT');

      const checkoutUrl = new URL(
        `pay/${encodeURIComponent(transaccionId)}`,
        this.config.checkoutBaseUrl!.endsWith('/')
          ? this.config.checkoutBaseUrl!
          : `${this.config.checkoutBaseUrl!}/`
      );
      checkoutUrl.searchParams.set('ref', referenciaExterna);

      return {
        transaccion_id: transaccionId,
        orden_id: orden.id,
        monto: montoTotal,
        moneda: 'PEN',
        proveedor,
        referencia_externa: referenciaExterna,
        checkout_url: checkoutUrl.toString(),
        estado: 'INICIADO'
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Procesa el webhook firmado del proveedor.
   *
   * Invariantes:
   * - Sólo un evento de éxito con monto, moneda y orden coincidentes, sobre una orden
   *   PENDIENTE_PAGO, confirma la transacción y pasa la orden a PAGADO.
   * - Un evento de fallo marca la transacción FALLIDO y deja la orden PENDIENTE_PAGO.
   * - Un evento auténtico pero incoherente deja la transacción EN_CONCILIACION y la orden intacta.
   * - Reenvíos del mismo resultado son idempotentes; resultados contradictorios sobre una
   *   transacción ya resuelta responden 409 sin modificar nada.
   */
  async procesarWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    parsedBody: WebhookPagoPayload
  ): Promise<ResultadoWebhook> {
    const signatureHeader = headers['x-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!signature || !signature.trim()) {
      throw new PagoError('Firma HMAC requerida en la cabecera x-signature.', 401);
    }

    // El timestamp sólo se acepta desde la cabecera, porque es parte del mensaje firmado.
    const timestampHeader = headers['x-timestamp'];
    const rawTs = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;

    if (!rawTs || !rawTs.trim()) {
      throw new PagoError('Timestamp requerido en la cabecera x-timestamp (anti-replay).', 401);
    }

    const rawTsStr = rawTs.trim();
    const timestampMs = parseWebhookTimestampMs(rawTsStr);

    if (timestampMs === null) {
      throw new PagoError('Timestamp inválido en el webhook.', 401);
    }

    if (Math.abs(Date.now() - timestampMs) > this.config.replayWindowMs) {
      throw new PagoError('Timestamp expirado o desfasado (posible replay attack detectado).', 401);
    }

    if (!verifyHmacSignature(rawBody, signature, this.config.webhookSecret!, rawTsStr)) {
      throw new PagoError('Firma HMAC inválida o firma adulterada.', 401);
    }

    // A partir de aquí el mensaje es auténtico: validar su contenido.
    if (!parsedBody || typeof parsedBody !== 'object') {
      throw new PagoError('Cuerpo del webhook inválido.', 400);
    }

    const refExterna =
      typeof parsedBody.referencia_externa === 'string' && parsedBody.referencia_externa.trim()
        ? parsedBody.referencia_externa.trim()
        : null;
    const txId =
      typeof parsedBody.transaccion_id === 'string' && parsedBody.transaccion_id.trim()
        ? parsedBody.transaccion_id.trim()
        : null;

    if (!refExterna && !txId) {
      throw new PagoError('El webhook debe incluir "referencia_externa" o "transaccion_id".', 400);
    }

    if (txId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txId)) {
      throw new PagoError('transaccion_id no tiene formato UUID.', 400);
    }

    const estadoEntrante = typeof parsedBody.estado === 'string' ? parsedBody.estado.toUpperCase() : '';
    const esExito = ESTADOS_EXITO.has(estadoEntrante);
    const esFallo = ESTADOS_FALLO.has(estadoEntrante);

    if (!esExito && !esFallo) {
      throw new PagoError(`Estado de pago no reconocido en el webhook: "${String(parsedBody.estado)}".`, 422);
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Si llegan ambos identificadores deben referirse a la misma transacción.
      const txRes = await client.query<{
        id: string;
        orden_id: string;
        monto: string | number;
        moneda: string;
        estado: EstadoPago;
        referencia_externa: string;
      }>(
        `SELECT id, orden_id, monto, moneda, estado, referencia_externa
         FROM pagos_transacciones
         WHERE ($1::varchar IS NULL OR referencia_externa = $1)
           AND ($2::uuid IS NULL OR id = $2)
         FOR UPDATE`,
        [refExterna, txId]
      );

      if (txRes.rows.length !== 1) {
        throw new PagoError('Transacción de pago no encontrada.', 404);
      }

      const tx = txRes.rows[0]!;

      // Transacción ya resuelta: idempotencia o contradicción.
      if (tx.estado !== 'INICIADO') {
        const mismoResultado =
          (tx.estado === 'CONFIRMADO' && esExito) || (tx.estado === 'FALLIDO' && esFallo);

        if (mismoResultado) {
          await client.query('COMMIT');
          return {
            status: 'success',
            transaccion_id: tx.id,
            orden_id: tx.orden_id,
            estado: tx.estado,
            idempotente: true
          };
        }

        throw new PagoError(
          `La transacción ya fue resuelta como ${tx.estado}; el evento entrante (${estadoEntrante}) requiere revisión manual.`,
          409
        );
      }

      const rawWebhook = JSON.stringify(parsedBody);

      if (esFallo) {
        await client.query(
          `UPDATE pagos_transacciones
           SET estado = 'FALLIDO', raw_webhook = $1, updated_at = NOW()
           WHERE id = $2`,
          [rawWebhook, tx.id]
        );
        await client.query('COMMIT');
        return {
          status: 'rejected',
          transaccion_id: tx.id,
          orden_id: tx.orden_id,
          estado: 'FALLIDO',
          idempotente: false,
          motivo: 'PAGO_FALLIDO'
        };
      }

      const ordenRes = await client.query<{
        id: string;
        estado: string;
        total_a_pagar: string | number;
      }>(
        `SELECT id, estado, total_a_pagar
         FROM ordenes_compra
         WHERE id = $1
         FOR UPDATE`,
        [tx.orden_id]
      );

      if (ordenRes.rows.length === 0) {
        throw new PagoError('Orden de compra vinculada no encontrada.', 404);
      }

      const orden = ordenRes.rows[0]!;

      const centimosRecibidos = aCentimos(parsedBody.monto);
      const centimosTx = aCentimos(tx.monto);
      const centimosOrden = aCentimos(orden.total_a_pagar);
      const monedaRecibida =
        typeof parsedBody.moneda === 'string' ? parsedBody.moneda.trim().toUpperCase() : null;

      let motivo: MotivoConciliacion | null = null;
      if (parsedBody.orden_id !== undefined && parsedBody.orden_id !== tx.orden_id) {
        motivo = 'ORDEN_NO_COINCIDE';
      } else if (
        centimosRecibidos === null ||
        centimosRecibidos !== centimosTx ||
        centimosRecibidos !== centimosOrden
      ) {
        motivo = 'MONTO_NO_COINCIDE';
      } else if (monedaRecibida !== tx.moneda.toUpperCase()) {
        motivo = 'MONEDA_NO_COINCIDE';
      } else if (orden.estado !== 'PENDIENTE_PAGO') {
        motivo = 'ORDEN_NO_PAGABLE';
      }

      if (motivo) {
        // Evento auténtico pero incoherente: no confirmar; queda para conciliación manual.
        await client.query(
          `UPDATE pagos_transacciones
           SET estado = 'EN_CONCILIACION', raw_webhook = $1, updated_at = NOW()
           WHERE id = $2`,
          [rawWebhook, tx.id]
        );
        await client.query('COMMIT');
        return {
          status: 'rejected',
          transaccion_id: tx.id,
          orden_id: tx.orden_id,
          estado: 'EN_CONCILIACION',
          idempotente: false,
          motivo
        };
      }

      await client.query(
        `UPDATE pagos_transacciones
         SET estado = 'CONFIRMADO', raw_webhook = $1, updated_at = NOW()
         WHERE id = $2`,
        [rawWebhook, tx.id]
      );

      await client.query(
        `UPDATE ordenes_compra
         SET estado = 'PAGADO', updated_at = NOW()
         WHERE id = $1 AND estado = 'PENDIENTE_PAGO'`,
        [orden.id]
      );

      const outboxPayload = {
        orden_id: orden.id,
        transaccion_id: tx.id,
        referencia_externa: tx.referencia_externa,
        monto: Number(tx.monto),
        moneda: tx.moneda,
        estado: 'PAGADO',
        timestamp: new Date().toISOString()
      };

      await client.query(
        `INSERT INTO outbox_events (
           aggregate_type, aggregate_id, event_type, payload, status
         ) VALUES ('ORDEN_COMPRA', $1, 'ORDEN_PAGADA', $2, 'PENDIENTE')`,
        [orden.id, JSON.stringify(outboxPayload)]
      );

      await client.query('COMMIT');

      return {
        status: 'success',
        transaccion_id: tx.id,
        orden_id: orden.id,
        estado: 'CONFIRMADO',
        idempotente: false
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
