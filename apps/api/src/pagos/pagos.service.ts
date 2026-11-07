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
  | 'MONTO_NO