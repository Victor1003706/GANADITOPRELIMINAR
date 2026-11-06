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
        signal: controller.signal
      });

      if (opciones.rechazosNoSonFallas && response.status >= 400 && response.status < 500) {
        const detalle = await response.json().catch(() => null);
        // El servicio respondió: está sano aunque la solicitud fuera inválida.
        this.recordSuccess();
        throw new AiSolicitudRechazadaError(response.status, detalle);
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP_${response.status}: ${errBody}`);
      }

      const data = (await response.json()) as TResponse;
      this.recordSuccess();
      return data;
    } catch (error) {
      if (error instanceof AiSolicitudRechazadaError) throw error;
      this.recordFailure();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Estimación orientativa de peso (1 vista -> /peso/estimar; 2-4 -> /peso/estimar-multivista).
   * A diferencia de los otros análisis NO hay respuesta de contingencia: inventar un peso
   * sería peor que no darlo. Lanza AiSolicitudRechazadaError (4xx) o AiNoDisponibleError.
   */
  async estimarPeso(vistas: unknown[]): Promise<unknown> {
    const [ruta, cuerpo] =
      vistas.length === 1 ? ['/api/v1/peso/estimar', vistas[0]] : ['/api/v1/peso/estimar-multivista', { vistas }];
    return this.postPeso(ruta, cuerpo);
  }

  /** Evaluación contra balanza y propuesta de calibración (no la aplica). */
  async evaluarPeso(pares: unknown[]): Promise<unknown> {
    return this.postPeso('/api/v1/peso/evaluar', { pares });
  }

  private async postPeso(ruta: string, cuerpo: unknown): Promise<unknown> {
    try {
      return await this.postJson<unknown>(ruta, cuerpo, { timeoutMs: TIMEOUT_PESO_MS, rechazosNoSonFallas: true });
    } catch (err: any) {
      if (err instanceof AiSolicitudRechazadaError) throw err;
      throw new AiNoDisponibleError(err?.name === 'AbortError' ? 'TIEMPO_AGOTADO' : String(err?.message ?? err));
    }
  }

  /**
   * Analiza video de lote ganadero de 15 segundos (ExpoGanadito Video Pipeline).
   * Si el servicio satélite no responde, retorna fallback con estado 'PENDIENTE_REVISION_MANUAL'.
   */
  async analizarVideo(input: VideoAnalisisInput): Promise<VisionAnalisisResult> {
    try {
      const data = await this.postJson<VisionAnalisisResult>(
        '/api/v1/vision/analizar-video',
        input
      );
      return {
        ...data,
        es_vinculante: false,
        estado: 'COMPLETADO',
        servicio_disponible: true,
        fallback_manual: false
      };
    } catch (err: any) {
      return {
        biotipo_sugerido: 'PENDIENTE_CLASIFICACION',
        // Sin satélite no hay medición: null, nunca un puntaje inventado.
        condicion_corporal_score: null,
        estimacion_dentaria: 'PENDIENTE_INSPECCION',
        confianza_score: 0,
        fotogramas_muestreados: 0,
        duracion_evaluada_seg: input.duracion_segundos ?? 15.0,
        es_vinculante: false,
        estado: 'PENDIENTE_REVISION_MANUAL',
        servicio_disponible: false,
        fallback_manual: true,
        motivo_fallback: 'Satélite de visión computacional no disponible'
      };
    }
  }

  /**
   * Analiza colorimetría muscular en espacio CIELAB (Dr. Ganadito Bromatología).
   * Si el satélite Python falla o está apagado, degrada con gracia a 'PENDIENTE_REVISION_MANUAL'.
   */
  async analizarColorBromatologico(
    input: AnalisisBromatologicoInput
  ): Promise<AnalisisBromatologicoResult> {
    try {
      const data = await this.postJson<AnalisisBromatologicoResult>(
        '/api/v1/bromatologia/analizar-color',
        input
      );
      return {
        ...data,
        estado: 'COMPLETADO',
        servicio_disponible: true,
        fallback_manual: false
      };
    } catch (err: any) {
      return {
        l_star_promedio: null,
        a_star_promedio: null,
        b_star_promedio: null,
        alerta_dfd: false,
        diagnostico:
          'Satélite de visión CIELAB fuera de línea. Se deriva a revisión bromatológica manual.',
        recomendacion:
          'Continuar flujo comercial bajo estado PENDIENTE_REVISION_MANUAL con inspección organoléptica en recepción.',
        umbral_dfd_l_star: 46.0,
        estado: 'PENDIENTE_REVISION_MANUAL',
        servicio_disponible: false,
        fallback_manual: true,
        motivo_fallback: 'Satélite bromatológico no disponible'
      };
    }
  }

  /**
   * Evalúa checklist sanitario RM N.° 822-2018/MINSA.
   * Si el satélite Python falla, responde sin bloquear con estado 'PENDIENTE_REVISION_MANUAL'.
   */
  async evaluarChecklistMinsa(input: ChecklistMinsaInput): Promise<ChecklistMinsaResult> {
    try {
      const data = await this.postJson<ChecklistMinsaResult>(
        '/api/v1/bromatologia/checklist-minsa',
        input
      );
      return {
        ...data,
        estado: 'COMPLETADO',
        servicio_disponible: true,
        fallback_manual: false
      };
    } catch (err: any) {
      const temp = Number(input.temperatura_recepcion_c ?? 0);
      const tempOk = temp >= 0 && temp <= 4.0;
      const colorOk =
        typeof input.color_organoleptico === 'boolean'
          ? input.color_organoleptico
          : ['NORMAL', 'ROJO_CEREZA_BRILLANTE', 'CONFORME', 'OPTIMO'].includes(
              String(input.color_organoleptico ?? 'NORMAL').toUpperCase()
            );
      const olorOk = input.ausencia_olores_extranos ?? true;
      const aprobado = tempOk && colorOk && olorOk;

      // Contingencia: SIN dictamen. Antes un cuerpo vacío (temp 0, color y olor por defecto)
      // devolvía aprobado_sanitariamente: true sin ninguna medición real.
      void aprobado;
      return {
        normativa_referencia: 'RM N.° 822-2018/MINSA',
        aprobado_sanitariamente: null,
        rechazo_sanitario: null,
        temperatura_recepcion_c: temp,
        temperatura_conforme: tempOk,
        color_conforme: colorOk,
        olor_conforme: olorOk,
        dictamen: 'PENDIENTE_REVISION_MANUAL',
        observaciones: [
          'Satélite IA no disponible; pre-evaluación de contingencia local aplicada. Requiere firma manual del inspector sanitario.'
        ],
        estado: 'PENDIENTE_REVISION_MANUAL',
        servicio_disponible: false,
        fallback_manual: true,
        motivo_fallback: 'Satélite sanitario no disponible'
      };
    }
  }
}
