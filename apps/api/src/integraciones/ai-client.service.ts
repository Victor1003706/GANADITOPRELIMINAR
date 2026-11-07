import type {
  VideoAnalisisInput,
  VisionAnalisisResult,
  AnalisisBromatologicoInput,
  AnalisisBromatologicoResult,
  ChecklistMinsaInput,
  ChecklistMinsaResult
} from '@ganadito/contracts';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * El satélite rechazó la solicitud (4xx): es un error del cliente (puntos, foto,
 * calibración), no una caída del servicio, y por eso NO abre el circuito.
 */
export class AiSolicitudRechazadaError extends Error {
  constructor(public readonly status: number, public readonly detalle: unknown) {
    super(`HTTP_${status}`);
    this.name = 'AiSolicitudRechazadaError';
  }
}

/** El satélite no está disponible (red, 5xx, tiempo agotado o circuito abierto). */
export class AiNoDisponibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiNoDisponibleError';
  }
}

interface PostJsonOptions {
  timeoutMs?: number;
  /** Si es true, un 4xx se lanza como AiSolicitudRechazadaError sin contar como falla. */
  rechazosNoSonFallas?: boolean;
}

/** Tiempo máximo de las rutas de peso: Monte Carlo de hasta 4 vistas en el satélite. */
export const TIMEOUT_PESO_MS = 20000;

export interface AiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  failureThreshold?: number;
  resetTimeoutMs?: number;
}

/**
 * Adaptador Resiliente para el Servicio Satélite de Inteligencia Artificial (Python FastAPI).
 *
 * Implementa:
 * - Timeout estricto de 5 segundos (por defecto 5000 ms) con AbortController.
 * - Patrón Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN) para evitar cascadas de latencia.
 * - Fallback no bloqueante: Si el satélite Python está apagado, falla o excede 5s,
 *   responde con estado 'PENDIENTE_REVISION_MANUAL', servicio_disponible: false y fallback_manual: true.
 */
export class AiClientService {
  private baseUrl: string;
  private readonly timeoutMs: number;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  private circuitState: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  constructor(options: AiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.AI_SERVICE_URL ?? 'http://localhost:8001').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 10000;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getCircuitState(): CircuitState {
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

  private async postJson<TResponse>(path: string, payload: unknown, opciones: PostJsonOptions = {}): Promise<TResponse> {
    const currentState = this.getCircuitState();
    if (currentState === 'OPEN') {
      throw new Error('CIRCUIT_BREAKER_OPEN: Satélite de IA temporalmente en enfriamiento.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opciones.timeoutMs ?? this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload ?? {}),
   