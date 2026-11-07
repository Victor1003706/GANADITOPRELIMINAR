import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { AiClientService } from './integraciones/ai-client.service.js';
import { crearUsuarioConRol } from './test-helpers.js';

const VISTA = {
  puntos: { punta_hombro: [300, 400], punta_nalga: [1000, 400], cruz: [400, 250], pecho_inferior: [400, 600] },
  calibracion: { tipo: 'REFERENCIA', punto_a: [100, 700], punto_b: [600, 700], distancia_cm: 100 }
};

type Modo = 'ok' | 'rechazo' | 'caido' | 'vinculante' | 'vistas_objeto' | 'sin_incertidumbre' | 'advertencia_no_texto' | 'sin_muestra' | 'una_vista_vistas_objeto' | 'una_vista_vistas_vacio';

describe('Estimaciones de peso por lote y pesajes de balanza', { concurrency: 1 }, () => {
  const pool = getPool();
  let modo: Modo = 'ok';
  let llamadas: Array<{ url: string; body: any }> = [];
  let satelite: http.Server;

  const aiClient = new AiClientService({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500, failureThreshold: 3 });
  const app = buildApp({ pool, aiClient });
  const authService = new AuthService(pool);

  let vendedor: { token: string; orgId: string };
  let otroVendedor: { token: string };
  let comprador: { token: string };
  let admin: { token: string };
  const lotesCreados: string[] = [];

  function respuestaSatelite(peso: number, nVistas: number) {
    const base = {
      peso_estimado_kg: peso,
      rango_min_kg: Math.round(peso * 0.82 * 10) / 10,
      rango_max_kg: Math.round(peso * 1.21 * 10) / 10,
      metodo: 'ZOOMETRIA_SCHAEFFER_V1',
      version_parametros: '2026-11-04-supuestos',
      es_vinculante: modo === 'vinculante',
      validado: false,
      advertencias: ['Estimación orientativa: no es un pesaje y puede equivocarse.'],
      incertidumbre: {
        nivel_confianza: 0.9, desviacion_log: 0.12, coeficiente_variacion: 0.12, n_simulaciones: 4000, semilla: 1,
        contribuciones: [{ fuente: 'modelo', descripcion: 'x', contribucion: 1, por_vista: false }]
      },
      estado: 'COMPLETADO'
    };
    const muestra = { largo_corporal_cm: 140, profundidad_pecho_cm: 70, perimetro_toracico_cm: 183.7 };
    const calidad = [{ codigo: 'PERFIL', estado: 'OK', valor: 0, umbral: '<= 20 grados', detalle: '' }];
    // Respuestas con el núcleo numérico válido pero el resto malformado (hallazgo de #41).
    if (modo === 'vistas_objeto') return { ...base, vistas: {} };
    if (modo === 'sin_incertidumbre') return { ...base, incertidumbre: { nivel_confianza: 0.9 }, muestra, calidad };
    if (modo === 'advertencia_no_texto') return { ...base, advertencias: [1, { x: 2 }], muestra, calidad };
    if (modo === 'sin_muestra') return { ...base, calidad };
    if (modo === 'una_vista_vistas_objeto') return { ...base, muestra, calidad, vistas: {} };
    if (modo === 'una_vista_vistas_vacio') return { ...base, muestra, calidad, vistas: [] };
    if (nVistas === 1) return { ...base, muestra, calidad };
    return { ...base, vistas: Array.from({ length: nVistas }, (_, i) => ({ indice: i, muestra, calidad })) };
  }

  async function registrar(rol: 'VENDEDOR' | 'COMPRADOR', etiqueta: string) {
    const email = `peso_${etiqueta}_${crypto.randomUUID().slice(0, 8)}@test.com`;
    const password = 'PasswordPeso2026!';
    const reg = await authService.register({ email, password, nombre: etiqueta, organizacion_nombre: `Org ${etiqueta}`, rol_inicial: rol });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    return { token: login.json().access_token as string, orgId: reg.activeContext.organizacion_id };
  }

  async function crearLote(token: string, extra: Record<string, unknown> = {}) {
    const r = await app.inject({
      method: '