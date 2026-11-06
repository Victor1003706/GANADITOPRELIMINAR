import type { FastifyPluginAsync } from 'fastify';
import { AiClientService } from './ai-client.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import type pg from 'pg';
import type {
  VideoAnalisisInput,
  AnalisisBromatologicoInput,
  ChecklistMinsaInput
} from '@ganadito/contracts';

export interface AiRoutesOptions {
  pool: pg.Pool;
  aiClient?: AiClientService;
  aiServiceUrl?: string;
}

export const aiRoutes: FastifyPluginAsync<AiRoutesOptions> = async (fastify, options) => {
  const aiClient =
    options.aiClient ??
    new AiClientService({
      baseUrl: options.aiServiceUrl
    });

  // Exponer referencia en la instancia para pruebas o reconfiguración dinámica
  (fastify as any).aiClient = aiClient;

  // Ninguna ruta de IA es anónima: antes servían de proxy abierto hacia el satélite
  // (videos a FFmpeg, apertura del circuit breaker con 3 fallos).
  const authenticate = createAuthMiddleware(options.pool);
  fastify.addHook('onRequest', authenticate);

  /**
   * POST /api/v1/ia/vision/analizar-video
   * Delega el análisis de video de 15s (ExpoGanadito) al satélite Python con Circuit Breaker y fallback no bloqueante.
   */
  const handleAnalizarVideo = async (request: { body: VideoAnalisisInput }, reply: any) => {
    const resultado = await aiClient.analizarVideo(request.body ?? {});
    return reply.status(200).send(resultado);
  };

  fastify.post<{ Body: VideoAnalisisInput }>('/vision/analizar-video', handleAnalizarVideo);

  /**
   * POST /api/v1/ia/bromatologia/analizar-color
   * Delega el análisis colorimétrico CIELAB (Dr. Ganadito) al satélite Python con fallback resiliente.
   */
  const handleAnalizarColor = async (request: { body: AnalisisBromatologicoInput }, reply: any) => {
    const resultado = await aiClient.analizarColorBromatologico(request.body ?? {});
    return reply.status(200).send(resultado);
  };

  fastify.post<{ Body: AnalisisBromatologicoInput }>('/bromatologia/analizar-color', handleAnalizarColor);

  /**
   * POST /api/v1/ia/bromatologia/checklist-minsa
   * Evalúa el checklist sanitario RM N.° 822-2018/MINSA con fallback resiliente.
   */
  const handleChecklistMinsa = async (request: { body: ChecklistMinsaInput }, reply: any) => {
    const resultado = await aiClient.evaluarChecklistMinsa(request.body ?? ({} as any));
    return reply.status(200).send(resultado);
  };

  fastify.post<{ Body: ChecklistMinsaInput }>('/bromatologia/checklist-minsa', handleChecklistMinsa);
};
