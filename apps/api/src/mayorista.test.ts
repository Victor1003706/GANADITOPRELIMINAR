import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool, runInitialMigration } from './db.js';
import { buildApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { crearUsuarioConRol } from './test-helpers.js';
import type {
  PoolConProgreso,
  UnirsePoolResponse,
  CerrarPoolsExpiradosResponse
} from '@ganadito/contracts';

describe('Motor de Compras Mayoristas, Demand Pooling B2B y Ofertas Flash', { concurrency: 1 }, () => {
  const pool = getPool();
  const app = buildApp({ pool });
  const authService = new AuthService(pool);

  let vendedorToken: string;
  let vendedorUserId: string;
  let vendedorOrgId: string;

  let comprador1Token: string;
  let comprador1UserId: string;
  let comprador1OrgId: string;

  let comprador2Token: string;
  let comprador2UserId: string;
  let comprador2OrgId: string;

  let poolFlashId: string;

  before(async () => {
    await runInitialMigration();
    await app.ready();

    // 1. Registrar vendedor / proveedor mayorista
    const vRes = await authService.register({
      email: `vendedor_mayorista_${Date.now()}@test.com`,
      password: 'PasswordMayorista2026!',
      nombre: 'Agroinsumos del Centro SAC',
      organizacion_nombre: `Agroinsumos SAC ${Date.now()}`,
      rol_inicial: 'VENDEDOR'
    });
    vendedorUserId = vRes.user.id;
    vendedorOrgId = vRes.activeContext.organizacion_id;

    const vLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: vRes.user.email, password: 'PasswordMayorista2026!' }
    });
    vendedorToken = vLogin.json().access_token;

    // 2. Registrar Comprador 1
    const c1Res = await authService.register({
      email: `comprador1_mayorista_${Date.now()}@test.com`,
      password: 'PasswordMayorista2026!',
      nombre: 'Engorde San Martin SAC',
      organizacion_nombre: `San Martin Engorde ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    comprador1UserId = c1Res.user.id;
    comprador1OrgId = c1Res.activeContext.organizacion_id;

    const c1Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: c1Res.user.email, password: 'PasswordMayorista2026!' }
    });
    comprador1Token = c1Login.json().access_token;

    // 3. Registrar Comprador 2 (Organización distinta)
    const c2Res = await authService.register({
      email: `comprador2_mayorista_${Date.now()}@test.com`,
      password: 'PasswordMayorista2026!',
      nombre: 'Ganadera del Sur SRL',
      organizacion_nombre: `Ganadera del Sur SRL ${Date.now()}`,
      rol_inicial: 'COMPRADOR'
    });
    comprador2UserId = c2Res.user.id;
    comprador2OrgId = c2Res.activeContext.organizacion_id;

    const c2Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: c2Res.user.email, password: 'PasswordMayorista2026!' }
    });
    comprador2Token = c2Login.json().access_token;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  test('1. Creación exitosa de campaña mayorista u oferta flash con cuenta regresiva', async () => {
    const fechaLimite = new Date(Date.now() + 86400000).toISOString(); // 24 horas

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mayorista/pools',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        tipo_producto: 'GRANO_FORRAJE',
        titulo: 'Maíz Amarillo Duro Nacional Grano Selecto',
        descripcion: 'Consolidación de carga a granel para engorde intensivo en Lima y Cañete',
        precio_unitario_mayorista: 0.95,
        meta_volumen: 10000,
        unidad_medida: 'KG',
        fecha_limite: fechaLimite,
        es_oferta_flash: true
      }
    });

    assert.strictEqual(res.statusCode, 201);
    const poolData = res.json();
    poolFlashId = poolData.id;

    assert.ok(poolFlashId);
    assert.strictEqual(poolData.tipo_producto, 'GRANO_FORRAJE');
    assert.strictEqual(poolData.titulo, 'Maíz Amarillo Duro Nacional Grano Selecto');
    assert.strictEqual(poolData.precio_unitario_mayorista, 0.95);
    assert.strictEqual(poolData.meta_volumen, 10000);
    assert.strictEqual(poolData.volumen_acumulado, 0);
    assert.strictEqual(poolData.unidad_medida, 'KG');
    assert.strictEqual(poolData.estado, 'ABIERTO');
    assert.strictEqual(poolData.es_oferta_flash, true);

    // Consulta pública de pools con filtro de flash
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/mayorista/pools?flash=true&tipo_producto=GRANO_FORRAJE'
    });
    assert.strictEqual(listRes.statusCode, 200);
    const pools: PoolConProgreso[] = listRes.json();
    const found = pools.find(p => p.id === poolFlashId);
    assert.ok(found);
    assert.strictEqual(found.progreso_porcentaje, 0);
  });

  test('2. Comprador se une al pool incrementando volumen_acumulado y reservando cuota', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/mayorista/pools/${poolFlashId}/unirse`,
      headers: { authorization: `Bearer ${comprador1Token}` },
      payload: { cantidad: 4000 }
    });

    assert.strictEqual(res.statusCode, 201);
    const data: UnirsePoolResponse = res.json();

    assert.strictEqual(data.participacion.pool_id, poolFlashId);
    assert.strictEqual(data.participacion.comprador_id, comprador1UserId);
    assert.strictEqual(data.participacion.organizacion_compradora_id, comprador1OrgId);
    assert.strictEqual(data.participacion.cantidad, 4000);
    assert.strictEqual(data.participacion.monto_total, 3800.0); // 4000 * 0.95
    assert.strictEqual(data.participacion.estado, 'RESERVADO');

    assert.strictEqual(data.pool.volumen_acumulado, 4000);
    assert.strictEqual(data.pool.estado, 'ABIERTO');
    assert.strictEqual(data.meta_alcanzada, false);

    // Validar cálculo de progreso en endpoint individual (4000 / 10000 = 40%)
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/mayorista/pools/${poolFlashId}`
    });
    assert.strictEqual(detailRes.statusCode, 200);
    const detail: PoolConProgreso = detailRes.json();
    assert.strictEqual(detail.volumen_acumulado, 4000);
    assert.strictEqual(detail.progreso_porcentaje, 40);
  });

  test('3. Cumplimiento de meta mínima con compradores concurrentes conmuta a ALCANZADO y emite Outbox', async () => {
    // 3.1 Crear pool específico con meta de 5000 SACO_50KG
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/mayorista/pools',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        tipo_producto: 'INSUMO_AGRICOLA',
        titulo: 'Fertilizante Urea Agrícola Certificada',
        descripcion: 'Importación directa por contenedor cerrado',
        precio_unitario_mayorista: 120.0,
        meta_volumen: 5000,
        unidad_medida: 'SACO_50KG',
        fecha_limite: new Date(Date.now() + 172800000).toISOString(),
        es_oferta_flash: false
      }
    });
    assert.strictEqual(createRes.statusCode, 201);
    const metaPoolId = createRes.json().id;

    // 3.2 Comprador 1 reserva 3000 y Comprador 2 reserva 2000 simultáneamente
    const [join1, join2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/mayorista/pools/${metaPoolId}/unirse`,
        headers: { authorization: `Bearer ${comprador1Token}` },
        payload: { cantidad: 3000 }
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/mayorista/pools/${metaPoolId}/unirse`,
        headers: { authorization: `Bearer ${comprador2Token}` },
        payload: { cantidad: 2000 }
      })
    ]);

    assert.strictEqual(join1.statusCode, 201);
    assert.strictEqual(join2.statusCode, 201);

    // 3.3 Validar que el pool ahora esté en estado ALCANZADO con volumen 5000
    const finalPoolRes = await app.inject({
      method: 'GET',
      url: `/api/v1/mayorista/pools/${metaPoolId}`
    });
    const finalPool: PoolConProgreso = finalPoolRes.json();
    assert.strictEqual(finalPool.volumen_acumulado, 5000);
    assert.strictEqual(finalPool.estado, 'ALCANZADO');
    assert.strictEqual(finalPool.progreso_porcentaje, 100);

    // 3.4 Verificar que se emitió el evento POOL_META_ALCANZADA en outbox_events
    const outboxCheck = await pool.query(
      `SELECT * FROM outbox_events
       WHERE aggregate_type = 'POOL_MAYORISTA'
         AND aggregate_id = $1
         AND event_type = 'POOL_META_ALCANZADA'`,
      [metaPoolId]
    );
    assert.strictEqual(outboxCheck.rows.length, 1);
    const payload = typeof outboxCheck.rows[0].payload === 'string'
      ? JSON.parse(outboxCheck.rows[0].payload)
      : outboxCheck.rows[0].payload;
    assert.strictEqual(payload.pool_id, metaPoolId);
    assert.strictEqual(payload.volumen_acumulado, 5000);
    assert.strictEqual(payload.meta_volumen, 5000);
  });

  test('4. Rechazo al intentar unirse a un pool cerrado, expirado o con cantidad inválida', async () => {
    // 4.1 Rechazo sin autenticación
    const unauthRes = await app.inject({
      method: 'POST',
      url: `/api/v1/mayorista/pools/${poolFlashId}/unirse`,
      payload: { cantidad: 100 }
    });
    assert.strictEqual(unauthRes.statusCode, 401);

    // 4.2 Rechazo por cantidad menor o igual a cero
    const invalidQtyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/mayorista/pools/${poolFlashId}/unirse`,
      headers: { authorization: `Bearer ${comprador2Token}` },
      payload: { cantidad: -50 }
    });
    assert.strictEqual(invalidQtyRes.statusCode, 400);
    assert.match(invalidQtyRes.json().message, /cantidad a reservar debe ser un número positivo/);

    // 4.3 Rechazo de participación duplicada por la misma organización (Comprador 1 ya participó en poolFlashId)
    const duplicateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/mayorista/pools/${poolFlashId}/unirse`,
      headers: { authorization: `Bearer ${comprador1Token}` },
      payload: { cantidad: 500 }
    });
    assert.strictEqual(duplicateRes.statusCode, 409);
    assert.match(duplicateRes.json().message, /ya cuenta con una participación registrada/);

    // 4.4 Rechazo al intentar unirse a un pool expirado en fecha
    const expiredCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/mayorista/pools',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        tipo_producto: 'EQUIPAMIENTO_SANITARIO',
        titulo: 'Aretes Electrónicos RFID ISO 11784',
        descripcion: 'Kit de aretado oficial con chip UHF',
        precio_unitario_mayorista: 4.5,
        meta_volumen: 2000,
        unidad_medida: 'UNIDAD',
        fecha_limite: new Date(Date.now() + 60000).toISOString()
      }
    });
    const expiredPoolId = expiredCreate.json().id;

    // Forzar expiración de fecha_limite en la base de datos
    await pool.query(
      `UPDATE pools_compra_mayorista SET fecha_limite = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
      [expiredPoolId]
    );

    const tryJoinExpired = await app.inject({
      method: 'POST',
      url: `/api/v1/mayorista/pools/${expiredPoolId}/unirse`,
      headers: { authorization: `Bearer ${comprador2Token}` },
      payload: { cantidad: 200 }
    });
    assert.strictEqual(tryJoinExpired.statusCode, 409);
    assert.match(tryJoinExpired.json().message, /ha expirado/);
  });

  test('5. Ejecución de cierre desasistido: pool con fecha vencida sin alcanzar meta transiciona a EXPIRADO_FALLIDO', async () => {
    // 5.1 Crear pool que no alcanzará la meta
    const createUnfinished = await app.inject({
      method: 'POST',
      url: '/api/v1/mayorista/pools',
      headers: { authorization: `Bearer ${vendedorToken}` },
      payload: {
        tipo_producto: 'MEDIAS_CANALES',
        titulo: 'Medias Canales Nelore Grado A',
        descripcion: 'Compra agrupada para frigoríficos y carnicerías',
        precio_unitario_mayorista: 14.5,
        meta_volumen: 8000,
        unidad_medida: 'KG',
        fecha_limite: new Date(Date.now() + 3600000).toISOString()
      }
    });
    assert.strictEqual(createUnfinished.statusCode, 201);
    const unfinishedPoolId = createUnfinished.json().id;

    // Comprador 1 aporta 2000 (acumulado 2000 < meta 8000)
    await app.inject({
      method: 'POST',
      url: `/api/v1/mayorista/pools/${unfinishedPoolId}/unirse`,
      headers: { authorization: `Bearer ${comprador1Token}` },
      payload: { cantidad: 2000 }
    });

    // 5.2 Expirar la fecha límite en PostgreSQL
    await pool.query(
      `UPDATE pools_compra_mayorista SET fecha_limite = NOW() - INTERVAL '5 seconds' WHERE id = $1`,
      [unfinishedPoolId]
    );

    // 5.3 Invocar endpoint de cierre desasistido
    const anonimo = await app.inject({ method: 'POST', url: '/api/v1/mayorista/pools/cerrar-expirados' });
    assert.strictEqual(anonimo.statusCode, 401, 'antes cualquiera podía cerrar pools');
    const admin = await crearUsuarioConRol(app, authService, 'ADMIN', 'mayorista');
    const closeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/mayorista/pools/cerrar-expirados',
      headers: { authorization: `Bearer ${admin.token}` }
    });
    assert.strictEqual(closeRes.statusCode, 200);
    const closeData: CerrarPoolsExpiradosResponse = closeRes.json();
    assert.ok(closeData.cerrados_count >= 1);
    assert.ok(closeData.pools_afectados.includes(unfinishedPoolId));

    // 5.4 Validar que el pool quedó en EXPIRADO_FALLIDO
    const poolCheck = await pool.query(
      `SELECT estado, volumen_acumulado FROM pools_compra_mayorista WHERE id = $1`,
      [unfinishedPoolId]
    );
    assert.strictEqual(poolCheck.rows[0].estado, 'EXPIRADO_FALLIDO');

    // 5.5 Validar que se emitió el evento POOL_EXPIRADO_FALLIDO en outbox_events
    const outboxExp = await pool.query(
      `SELECT * FROM outbox_events
       WHERE aggregate_type = 'POOL_MAYORISTA'
         AND aggregate_id = $1
         AND event_type = 'POOL_EXPIRADO_FALLIDO'`,
      [unfinishedPoolId]
    );
    assert.strictEqual(outboxExp.rows.length, 1);
  });
});
