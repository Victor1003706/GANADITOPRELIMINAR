import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AiClientService } from './integraciones/ai-client.service.js';
import { AuthService } from './auth/auth.service.js';
import { crearUsuarioConRol } from './test-helpers.js';

describe('Servicio Satélite de IA (ExpoGanadito Vision & Dr. Ganadito Bromatología CIELAB) y Resiliencia', { concurrency: 1 }, () => {
  const pool = getPool();
  let mockSatelliteServer: http.Server;
  let satelliteUrl: string;
  let simulateSlowResponse = false;

  const aiClient = new AiClientService({
    baseUrl: 'http://127.0.0.1:8001',
    timeoutMs: 300,
    failureThreshold: 2,
    resetTimeoutMs: 5000
  });

  const app = buildApp({ pool, aiClient });
  let token = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  before(async () => {
    await runInitialMigration();
    await app.ready();
    token = (await crearUsuarioConRol(app, new AuthService(pool), 'OPERADOR_CAMAL', 'ia')).token;

    // Levantar servidor satélite en puerto efímero para pruebas deterministas de integración HTTP
    mockSatelliteServer = http.createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const body = rawBody ? JSON.parse(rawBody) : {};

        if (simulateSlowResponse) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (req.destroyed || res.writableEnded) {
            return;
          }
        }

        res.setHeader('Content-Type', 'application/json');

      if (req.method === 'POST' && req.url === '/api/v1/bromatologia/analizar-color') {
        const bgr = body.bgr_color ?? [95, 100, 225];
        const isDark = bgr[2] < 100;
        const lStar = isDark ? 34.2 : 56.8;
        res.writeHead(200);
        res.end(
          JSON.stringify({
            l_star_promedio: lStar,
            a_star_promedio: isDark ? 16.4 : 33.5,
            b_star_promedio: isDark ? 7.1 : 18.2,
            alerta_dfd: lStar < 46.0,
            diagnostico:
              lStar < 46.0
                ? 'Posible Carne Oscura, Firme y Seca DFD'
                : 'Coloración muscular rojo cereza brillante normal (Óptimo)',
            recomendacion:
              lStar < 46.0
                ? 'Se recomienda derivación industrial o inspección veterinaria.'
                : 'Corte cárnico apto para comercialización directa en frío.',
            umbral_dfd_l_star: 46.0,
            estado: 'COMPLETADO'
          })
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/vision/analizar-video') {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            biotipo_sugerido: 'CARNICO_CEBUINO_CRUZADO',
            condicion_corporal_score: 3.85,
            estimacion_dentaria: '2_A_4_DIENTES_PERMANENTES',
            confianza_score: 0.92,
            fotogramas_muestreados: 5,
            duracion_evaluada_seg: body.duracion_segundos ?? 15.0,
            es_vinculante: false,
            estado: 'COMPLETADO'
          })
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/bromatologia/checklist-minsa') {
        const temp = Number(body.temperatura_recepcion_c ?? 2.0);
        const tempOk = temp >= 0 && temp <= 4.0;
        res.writeHead(200);
        res.end(
          JSON.stringify({
            normativa_referencia: 'RM N.° 822-2018/MINSA',
            aprobado_sanitariamente: tempOk,
            rechazo_sanitario: !tempOk,
            temperatura_recepcion_c: temp,
            temperatura_conforme: tempOk,
            color_conforme: true,
            olor_conforme: true,
            dictamen: tempOk ? 'APROBADO_CONFORME_MINSA' : 'RECHAZO_SANITARIO_MINSA',
            observaciones: tempOk
              ? ['Conforme a RM N.° 822-2018/MINSA']
              : [`RECHAZO SANITARIO: Temperatura (${temp} °C) > 4.0 °C`],
            estado: 'COMPLETADO'
          })
        );
        return;
      }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
      } catch {
        // Ignorar desconexiones de cliente por abort/timeout
      }
    });

    await new Promise<void>((resolve) => {
      mockSatelliteServer.listen(0, '127.0.0.1', () => {
        const addr = mockSatelliteServer.address();
        if (addr && typeof addr === 'object') {
          satelliteUrl = `http://127.0.0.1:${addr.port}`;
          aiClient.setBaseUrl(satelliteUrl);
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => mockSatelliteServer.close(() => resolve()));
    await app.close();
    await closePool();
  });

  test('1. Solicitud de análisis bromatológico CIELAB con respuesta exitosa (L* normal vs alerta DFD)', async () => {
    aiClient.resetCircuit();
    aiClient.setBaseUrl(satelliteUrl);

    // Caso 1: Carne roja normal (L* > 50 -> alerta_dfd: false)
    const normalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ia/bromatologia/analizar-color',
      headers: auth(),
      payload: {
        bgr_color: [95, 100, 225]
      }
    });

    assert.strictEqual(normalRes.statusCode, 200);
    const normalData = normalRes.json();
    assert.strictEqual(normalData.estado, 'COMPLETADO');
    assert.strictEqual(normalData.servicio_disponible, true);
    assert.strictEqual(normalData.fallback_manual, false);
    assert.strictEqual(normalData.alerta_dfd, false);
    assert.ok(normalData.l_star_promedio > 46.0);

    // Caso 2: Carne oscura DFD (L* < 46 -> alerta_dfd: true)
    const dfdRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ia/bromatologia/analizar-color',
      headers: auth(),
      payload: {
        bgr_color: [25, 20, 65]
      }
    });

    assert.strictEqual(dfdRes.statusCode, 200);
    const dfdData = dfdRes.json();
    assert.strictEqual(dfdData.estado, 'COMPLETADO');
    assert.strictEqual(dfdData.alerta_dfd, true);
    assert.ok(dfdData.l_star_promedio < 46.0);
    assert.match(dfdData.diagnostico, /Posible Carne Oscura, Firme y Seca DFD/);
  });

  test('2. Análisis de video ExpoGanadito y checklist sanitario RM N.° 822-2018/MINSA exitosos', async () => {
    aiClient.resetCircuit();
    aiClient.setBaseUrl(satelliteUrl);

    const videoRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ia/vision/analizar-video',
      headers: auth(),
      payload: {
        video_url: 'https://cdn.ganadito.pe/lotes/lote-15s.mp4',
        duracion_segundos: 15
      }
    });

    assert.strictEqual(videoRes.statusCode, 200);
    const videoData = videoRes.json();
    assert.strictEqual(videoData.estado, 'COMPLETADO');
    assert.strictEqual(videoData.servicio_disponible, true);
    assert.strictEqual(videoData.es_vinculante, false);
    assert.ok(videoData.condicion_corporal_score >= 1 && videoData.condicion_corporal_score <= 5);

    const minsaRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ia/bromatologia/checklist-minsa',
      headers: auth(),
      payload: {
        temperatura_recepcion_c: 6.5,
        color_organoleptico: 'ROJO_CEREZA_BRILLANTE',
        ausencia_olores_extranos: true
      }
    });

    assert.strictEqual(minsaRes.statusCode, 200);
    const minsaData = minsaRes.json();
    assert.strictEqual(minsaData.rechazo_sanitario, true);
    assert.strictEqual(minsaData.aprobado_sanitariamente, false);
  });

  test('2b. Sin sesión las rutas de IA responden 401 (no son un proxy anónimo al satélite)', async () => {
    for (const url of ['/api/v1/ia/vision/analizar-video', '/api/v1/ia/bromatologia/analizar-color', '/api/v1/ia/bromatologia/checklist-minsa']) {
      const r = await app.inject({ method: 'POST', url, payload: {} });
      assert.strictEqual(r.statusCode, 401, url);
    }
  });

  test('3. Prueba de Resiliencia ante Caída (Puerto cerrado): Fastify captura el fallo con gracia y retorna 200 con fallback_manual: true', async () => {
    aiClient.resetCircuit();
    // Apuntar a un puerto cerrado donde ningún proceso escucha
    aiClient.setBaseUrl('http://127.0.0.1:59998');

    const resColor = await app.inject({
      method: 'POST',
      url: '/api/v1/ia/bromatologia/analizar-color',
      headers: auth(),
      payload: {
        bgr_color: [90, 90, 200]
      }
    });

    assert.strictEqual(resColor.statusCode, 200, 'La API transaccional NO debe caer ni retornar 500');
    const bodyColor = resColor.json();
    assert.strictEqual(bodyColor.servicio_disponible, false);
    assert.strictEqual(bodyColor.fallback_manual, true);
    assert.strictEqual(bodyColor.estado, 'PENDIENTE_REVISION_MANUAL');

    const resVideo = await app.inject({
      method: 'POST',
      url: '/api/v1/ia/vision/analizar-video',
      headers: auth(),
      payload: {
        video_url: 'https://cdn.ganadito.pe/lotes/offline-test.mp4'
      }
    });

    assert.strictEqual(resVideo.statusCode, 200);
    const bodyVideo = resVideo.json();
    assert.strictEqual(bodyVideo.servicio_disponible, false);
    assert.strictEqual(bodyVideo.fallback_manual, true);
    assert.strictEqual(bodyVideo.estado, 'PENDIENTE_REVISION_MANUAL');

    // Al acumular 2 fallos consecutivos, el Circuit Breaker debe haber pasado a estado OPEN
    assert.strictEqual(aiClient.getCircuitState(), 'OPEN');
  });

  test('4. Prueba de Timeout y Circuit Breaker: si el satélite excede el tiempo máximo, aborta y responde PENDIENTE_REVISION_MANUAL', async () => {
    aiClient.resetCircuit();
    aiClient.setBaseUrl(satelliteUrl);
    simulateSlowResponse = true;

    try {
      const resTimeout = await app.inject({
        method: 'POST',
        url: '/api/v1/ia/bromatologia/analizar-color',
      headers: auth(),
        payload: {
          bgr_color: [100, 100, 210]
        }
      });

      assert.strictEqual(resTimeout.statusCode, 200);
      const data = resTimeout.json();
      assert.strictEqual(data.servicio_disponible, false);
      assert.strictEqual(data.fallback_manual, true);
      assert.strictEqual(data.estado, 'PENDIENTE_REVISION_MANUAL');
    } finally {
      simulateSlowResponse = false;
    }
  });
});

describe('IA en contingencia: sin dictámenes ni mediciones inventadas', { concurrency: 1 }, () => {
  const pool = getPool();
  const caido = new AiClientService({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 200, failureThreshold: 99 });
  test('el checklist MINSA sin satélite no aprueba; el video no inventa puntaje; no se filtran errores internos', async () => {
    void pool;
    const minsa = await caido.evaluarChecklistMinsa({} as any);
    assert.strictEqual(minsa.aprobado_sanitariamente, null, 'antes un cuerpo vacío daba aprobado: true');
    assert.strictEqual(minsa.rechazo_sanitario, null);
    assert.strictEqual(minsa.dictamen, 'PENDIENTE_REVISION_MANUAL');
    assert.ok(!String(minsa.motivo_fallback).includes('HTTP_'));
    const video = await caido.analizarVideo({});
    assert.strictEqual(video.condicion_corporal_score, null);
    assert.ok(!/ECONNREFUSED|fetch failed|HTTP_/.test(String(video.motivo_fallback)));
  });
});
