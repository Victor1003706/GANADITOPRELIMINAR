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
            dicta