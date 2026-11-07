import bcryptjs from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool, runInitialMigration } from '../db.js';
import { calcularHashEvento, GENESIS_PREV_HASH } from '@ganadito/contracts';

// ============================================================================
// GUARDIA DE SEGURIDAD CONTRA EJECUCIÓN EN PRODUCCIÓN
// ============================================================================

/**
 * Guardia de seguridad para impedir ejecuciones accidentales en entornos de producción
 * o sobre bases de datos no locales/tests.
 */
const HOSTS_SEED_PERMITIDOS = new Set(['localhost', '127.0.0.1', '::1', 'ganadito-postgres', 'postgres']);

/**
 * Hosts permitidos: lista exacta local/docker/CI, más los indicados explícitamente en
 * SEED_ALLOWED_HOSTS (separados por coma). No se usan coincidencias parciales del nombre
 * (p. ej. "includes('test')" aceptaría "prod-test-db.example.com").
 */
export function esHostSeedPermitido(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  const extra = (process.env.SEED_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return HOSTS_SEED_PERMITIDOS.has(host) || extra.includes(host);
}

/**
 * Parámetros de la cadena de conexión que pg (pg-connection-string) acepta para sustituir
 * el destino indicado en la autoridad de la URL. Si se permitieran, una URL que parece
 * local (`postgres://localhost/db?host=prod.example.com`) conectaría a otro servidor.
 */
const PARAMETROS_DESTINO_PROHIBIDOS = new Set(['host', 'hostaddr', 'port', 'socket']);
const PROTOCOLOS_PERMITIDOS = new Set(['postgres:', 'postgresql:']);

/**
 * Valida el destino efectivo del seed SIN abrir conexiones. Devuelve el motivo del
 * rechazo o null si el destino es local y está permitido.
 */
/** Contraseña de los usuarios de demostración (ver comentario en la creación de usuarios). */
export function resolverPasswordSeed(env: NodeJS.ProcessEnv): string {
  const fueraDeLocal = (env.SEED_ALLOWED_HOSTS ?? '').trim() !== '';
  const propia = env.SEED_PASSWORD?.trim();
  if (fueraDeLocal) {
    if (!propia || propia.length < 12) {
      throw new Error('Con SEED_ALLOWED_HOSTS se requiere SEED_PASSWORD (mínimo 12 caracteres).');
    }
    return propia;
  }
  return propia || 'ganadito2026';
}

export function validarDestinoSeed(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV === 'production') {
    return 'No se permite ejecutar seeders con NODE_ENV="production".';
  }

  const dbUrl = env.DATABASE_URL;
  if (dbUrl) {
    let url: URL;
    try {
      url = new URL(dbUrl);
    } catch {
      return 'DATABASE_URL no es una URL válida.';
    }
    if (!PROTOCOLOS_PERMITIDOS.has(url.protocol)) {
      return `DATABASE_URL usa un protocolo no permitido (${url.protocol}).`;
    }
    for (const nombre of url.searchParams.keys()) {
      if (PARAMETROS_DESTINO_PROHIBIDOS.has(nombre.toLowerCase())) {
        return `DATABASE_URL incluye el parámetro "${nombre}", que sustituye el destino de la conexión.`;
      }
    }
    if (!url.hostname || !esHostSeedPermitido(decodeURIComponent(url.hostname))) {
      return `DATABASE_URL no apunta a un host local permitido (${url.hostname || 'sin host'}).`;
    }
    return null;
  }

  const dbHost = env.DATABASE_HOST ?? 'localhost';
  if (!esHostSeedPermitido(dbHost)) {
    return `DATABASE_HOST (${dbHost}) no es un host local permitido.`;
  }
  return null;
}

/**
 * Guardia de seguridad para impedir ejecuciones accidentales en producción
 * o sobre bases de datos no locales. Se ejecuta antes de toda conexión y migración.
 */
export function assertSafeSeedEnvironment(): void {
  const motivo = validarDestinoSeed();
  if (motivo) {
    console.error(`⛔ [ERROR CRÍTICO] ${motivo} Use SEED_ALLOWED_HOSTS para autorizar otro host explícitamente. Abortando.`);
    process.exit(1);
  }
}

// ============================================================================
// CONSTANTES Y UUIDS DETERMINÍSTICOS PARA IDEMPOTENCIA TOTAL
// ============================================================================

export const SEED_IDS = {
  // 1. Organizaciones
  ORG_PUNO: 'b1111111-1111-4111-8111-111111111111',
  ORG_LURIN: 'b2222222-2222-4222-8222-222222222222',
  ORG_AREQUIPA: 'b3333333-3333-4333-8333-333333333333',
  ORG_MAGDALENA: 'b4444444-4444-4444-8444-444444444444',
  ORG_LOGISTICA: 'b5555555-5555-4555-8555-555555555555',

  // 2. Usuarios
  USER_PUNO: 'a1111111-1111-4111-8111-111111111111',
  USER_LURIN: 'a2222222-2222-4222-8222-222222222222',
  USER_AREQUIPA: 'a3333333-3333-4333-8333-333333333333',
  USER_MAGDALENA: 'a4444444-4444-4444-8444-444444444444',
  USER_LOGISTICA: 'a5555555-5555-4555-8555-555555555555',
  USER_ADMIN: 'a0000000-0000-4000-8000-000000000000',

  // 3. Establecimientos PostGIS
  ESTAB_LURIN: 'c1111111-1111-4111-8111-111111111111',
  ESTAB_AREQUIPA: 'c2222222-2222-4222-8222-222222222222',
  ESTAB_PUNO: 'c3333333-3333-4333-8333-333333333333',
  ESTAB_MAGDALENA: 'c4444444-4444-4444-8444-444444444444',

  // 4. Cotizaciones Spot
  SPOT_1: 'd1111111-1111-4111-8111-111111111111',
  SPOT_2: 'd2222222-2222-4222-8222-222222222222',
  SPOT_3: 'd3333333-3333-4333-8333-333333333333',

  // 5. Subastas y Pujas
  LOTE_ACTIVO: 'e1111111-1111-4111-8111-111111111111',
  LOTE_ADJUDICADO: 'e2222222-2222-4222-8222-222222222222',
  PUJA_ACT_1: 'ea111111-1111-4111-8111-111111111111',
  PUJA_ACT_2: 'ea222222-2222-4222-8222-222222222222',
  PUJA_ADJ_1: 'ea333333-3333-4333-8333-333333333333',

  // 6. Órdenes de compra comercial
  ORDEN_ADJUDICADA: 'f1111111-1111-4111-8111-111111111111',

  // 7. Demand Pooling & Ofertas Flash
  POOL_MAIZ: '11112222-1111-4111-8111-111111111111',
  POOL_FLASH: '22223333-2222-4222-8222-222222222222',
  PART_MAIZ: '33334444-3333-4333-8333-333333333333',

  // 8. Trazabilidad bovina
  BOVINO: '77771111-7777-4777-8777-111111111111',

  // 9. Transporte y fletes
  UNIDAD_JAULA: '88881111-8888-4888-8888-111111111111',
  UNIDAD_FURGON: '88882222-8888-4888-8888-222222222222',
  FLETE_SOLICITUD: '88883333-8888-4888-8888-333333333333',

  // 10. Tributario y Factoring CAVALI
  COMPROBANTE_LCE: '99991111-9999-4999-8999-111111111111',
  CAVALI_SOLICITUD: '99992222-9999-4999-8999-222222222222'
};

export async function runDatabaseSeed(): Promise<void> {
  // Guardia de seguridad activa
  assertSafeSeedEnvironment();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌱 GANADITO — INICIALIZACIÓN DE MOTOR DE DATOS SEMILLA (SEEDERS E2E)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Ejecutar migraciones canónicas para garantizar que el esquema esté al 100%
  console.log('▶ [1/11] Verificando y aplicando migraciones canónicas (0001 a 0009)...');
  await runInitialMigration();
  console.log('  ✔ Migraciones aplicadas con éxito.');

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 2. Limpieza idempotente previa de registros semilla
    console.log('▶ [2/11] Limpieza idempotente previa de datos semilla...');
    await client.query(
      `DELETE FROM factoring_cavali_solicitudes WHERE cavali_tracking_id = 'CAV-2026-00042' OR id = $1`,
      [SEED_IDS.CAVALI_SOLICITUD]
    );
    await client.query(
      `DELETE FROM comprobantes_tributarios WHERE (tipo_comprobante = 'LIQUIDACION_COMPRA_ELECTRONICA' AND serie = 'E001' AND correlativo = 42) OR id = $1`,
      [SEED_IDS.COMPROBANTE_LCE]
    );
    await client.query(
      `DELETE FROM fletes_solicitudes WHERE id = $1`,
      [SEED_IDS.FLETE_SOLICITUD]
    );
    await client.query(
      `DELETE FROM transportistas_unidades WHERE placa IN ('V4T-980', 'B8C-712') OR id IN ($1, $2)`,
      [SEED_IDS.UNIDAD_JAULA, SEED_IDS.UNIDAD_FURGON]
    );
    await client.query(
      `DELETE FROM pasaporte_bovino_events WHERE bovino_id = $1`,
      [SEED_IDS.BOVINO]
    );
    await client.query(
      `DELETE FROM bovinos WHERE codigo_arete = 'PE-04-9821' OR id = $1`,
      [SEED_IDS.BOVINO]
    );
    await client.query(
      `DELETE FROM pool_participaciones WHERE id = $1`,
      [SEED_IDS.PART_MAIZ]
    );
    await client.query(
      `DELETE FROM pools_compra_mayorista WHERE id IN ($1, $2)`,
      [SEED_IDS.POOL_MAIZ, SEED_IDS.POOL_FLASH]
    );
    await client.query(
      `DELETE FROM ordenes_compra WHERE lote_id IN ($1, $2) OR id = $3`,
      [SEED_IDS.LOTE_ACTIVO, SEED_IDS.LOTE_ADJUDICADO, SEED_IDS.ORDEN_ADJUDICADA]
    );
    await client.query(
      `DELETE FROM subasta_pujas WHERE lote_id IN ($1, $2)`,
      [SEED_IDS.LOTE_ACTIVO, SEED_IDS.LOTE_ADJUDICADO]
    );
    await client.query(
      `DELETE FROM lotes_subasta WHERE codigo_lote IN ('LOTE-ACT-2026-001', 'LOTE-ADJ-2026-002') OR id IN ($1, $2)`,
      [SEED_IDS.LOTE_ACTIVO, SEED_IDS.LOTE_ADJUDICADO]
    );
    await client.query(
      `DELETE FROM cotizaciones_spot WHERE id IN ($1, $2, $3)`,
      [SEED_IDS.SPOT_1, SEED_IDS.SPOT_2, SEED_IDS.SPOT_3]
    );
    await client.query(
      `DELETE FROM establecimientos WHERE id IN ($1, $2, $3, $4)`,
      [SEED_IDS.ESTAB_LURIN, SEED_IDS.ESTAB_AREQUIPA, SEED_IDS.ESTAB_PUNO, SEED_IDS.ESTAB_MAGDALENA]
    );
    await client.query(
      `DELETE FROM user_organizaciones_roles WHERE user_id IN ($1, $2, $3, $4, $5, $6) OR organizacion_id IN ($7, $8, $9, $10, $11)`,
      [
        SEED_IDS.USER_PUNO,
        SEED_IDS.USER_LURIN,
        SEED_IDS.USER_AREQUIPA,
        SEED_IDS.USER_MAGDALENA,
        SEED_IDS.USER_LOGISTICA,
        SEED_IDS.USER_ADMIN,
        SEED_IDS.ORG_PUNO,
        SEED_IDS.ORG_LURIN,
        SEED_IDS.ORG_AREQUIPA,
        SEED_IDS.ORG_MAGDALENA,
        SEED_IDS.ORG_LOGISTICA
      ]
    );
    await client.query(
      `DELETE FROM users WHERE email IN ('puno@ganadito.pe', 'lurin@ganadito.pe', 'arequipa@ganadito.pe', 'magdalena@ganadito.pe', 'logistica@ganadito.pe', 'admin@ganadito.pe') OR id IN ($1, $2, $3, $4, $5, $6)`,
      [
        SEED_IDS.USER_PUNO,
        SEED_IDS.USER_LURIN,
        SEED_IDS.USER_AREQUIPA,
        SEED_IDS.USER_MAGDALENA,
        SEED_IDS.USER_LOGISTICA,
        SEED_IDS.USER_ADMIN
      ]
    );
    await client.query(
      `DELETE FROM organizaciones WHERE ruc IN ('20451234561', '20608492015', '20549876543', '10458912341', '20781234567') OR id IN ($1, $2, $3, $4, $5)`,
      [
        SEED_IDS.ORG_PUNO,
        SEED_IDS.ORG_LURIN,
        SEED_IDS.ORG_AREQUIPA,
        SEED_IDS.ORG_MAGDALENA,
        SEED_IDS.ORG_LOGISTICA
      ]
    );
    console.log('  ✔ Limpieza idempotente completada.');

    // 3. Inserción de Organizaciones
    console.log('▶ [3/11] Sembrando Organizaciones de la cadena de valor ganadera...');
    const organizaciones = [
      {
        id: SEED_IDS.ORG_PUNO,
        razon_social: 'Cooperativa Comunal San Salvador',
        ruc: '20451234561',
        ppa: 'PPA-PUNO-2026-001',
        estado: 'ACTIVA'
      },
      {
        id: SEED_IDS.ORG_LURIN,
        razon_social: 'Engordador del Valle SAC',
        ruc: '20608492015',
        ppa: 'PPA-LIMA-2026-002',
        estado: 'ACTIVA'
      },
      {
        id: SEED_IDS.ORG_AREQUIPA,
        razon_social: 'Frigorífico Metropolitano SAC',
        ruc: '20549876543',
        ppa: null,
        estado: 'ACTIVA'
      },
      {
        id: SEED_IDS.ORG_MAGDALENA,
        razon_social: 'Carnes & Cortes Don Lucho EIRL',
        ruc: '10458912341',
        ppa: null,
        estado: 'ACTIVA'
      },
      {
        id: SEED_IDS.ORG_LOGISTICA,
        razon_social: 'Logística Pecuaria Andina EIRL',
        ruc: '20781234567',
        ppa: null,
        estado: 'ACTIVA'
      }
    ];

    for (const org of organizaciones) {
      await client.query(
        `INSERT INTO organizaciones (id, razon_social, ruc, ppa, estado)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, org.razon_social, org.ruc, org.ppa, org.estado]
      );
    }
    console.log(`  ✔ 5 Organizaciones registradas con RUCs y registros PPA.`);

    // 4. Inserción de Usuarios y Roles RBAC
    console.log('▶ [4/11] Sembrando Usuarios, credenciales bcrypt y Roles RBAC...');
    // Con SEED_ALLOWED_HOSTS (cualquier host fuera de local) se exige SEED_PASSWORD: la
    // contraseña conocida 'ganadito2026' (también del ADMIN) solo vale en local.
    const passwordSeed = resolverPasswordSeed(process.env);
    const universalPasswordHash = bcryptjs.hashSync(passwordSeed, 10);

    const usuarios = [
      {
        id: SEED_IDS.USER_PUNO,
        email: 'puno@ganadito.pe',
        nombre: 'Mateo Mamani Condori',
        telefono: '+51 951 234 567',
        orgId: SEED_IDS.ORG_PUNO,
        rol: 'VENDEDOR'
      },
      {
        id: SEED_IDS.USER_LURIN,
        email: 'lurin@ganadito.pe',
        nombre: 'Carlos Benavides Prado',
        telefono: '+51 987 654 321',
        orgId: SEED_IDS.ORG_LURIN,
        rol: 'COMPRADOR'
      },
      {
        id: SEED_IDS.USER_AREQUIPA,
        email: 'arequipa@ganadito.pe',
        nombre: 'Renato Valdivia Zúñiga',
        telefono: '+51 954 112 233',
        orgId: SEED_IDS.ORG_AREQUIPA,
        rol: 'OPERADOR_CAMAL'
      },
      {
        id: SEED_IDS.USER_MAGDALENA,
        email: 'magdalena@ganadito.pe',
        nombre: 'Luis "Don Lucho" Mendoza',
        telefono: '+51 999 888 777',
        orgId: SEED_IDS.ORG_MAGDALENA,
        rol: 'COMPRADOR'
      },
      {
        id: SEED_IDS.USER_LOGISTICA,
        email: 'logistica@ganadito.pe',
        nombre: 'Walter Quispe Huaranca',
        telefono: '+51 978 445 566',
        orgId: SEED_IDS.ORG_LOGISTICA,
        rol: 'TRANSPORTISTA'
      },
      {
        id: SEED_IDS.USER_ADMIN,
        email: 'admin@ganadito.pe',
        nombre: 'Superintendente General Ganadito',
        telefono: '+51 900 000 001',
        orgId: SEED_IDS.ORG_LURIN,
        rol: 'ADMIN'
      }
    ];

    for (const u of usuarios) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, nombre, telefono)
         VALUES ($1, $2, $3, $4, $5)`,
        [u.id, u.email, universalPasswordHash, u.nombre, u.telefono]
      );

      await client.query(
        `INSERT INTO user_organizaciones_roles (user_id, organizacion_id, rol, is_active_context)
         VALUES ($1, $2, $3, true)`,
        [u.id, u.orgId, u.rol]
      );
    }
    console.log(`  ✔ 6 Usuarios creados (contraseña: la de SEED_PASSWORD o 'ganadito2026' en local) con roles activos.`);

    // 5. Inserción de Establecimientos PostGIS
    console.log('▶ [5/11] Sembrando Establecimientos georreferenciados en PostGIS...');
    const establecimientos = [
      {
        id: SEED_IDS.ESTAB_LURIN,
        organizacion_id: SEED_IDS.ORG_LURIN,
        nombre_comercial: 'Feedlot Lurín - Engordador del Valle',
        tipo: 'ESTABLO',
        lng: -76.8712,
        lat: -12.2741,
        direccion_texto: 'Km 38.5 Panamericana Sur, Lurín, Lima',
        ubigeo: '150119'
      },
      {
        id: SEED_IDS.ESTAB_AREQUIPA,
        organizacion_id: SEED_IDS.ORG_AREQUIPA,
        nombre_comercial: 'Camal Frigorífico Municipal Arequipa',
        tipo: 'CAMAL',
        lng: -71.5375,
        lat: -16.4090,
        direccion_texto: 'Av. Los Incas s/n, Arequipa',
        ubigeo: '040101'
      },
      {
        id: SEED_IDS.ESTAB_PUNO,
        organizacion_id: SEED_IDS.ORG_PUNO,
        nombre_comercial: 'Centro de Acopio Comunal San Salvador',
        tipo: 'CENTRO_BENEFICIO',
        lng: -70.0219,
        lat: -15.8402,
        direccion_texto: 'Sector San Salvador s/n, Puno',
        ubigeo: '210101'
      },
      {
        id: SEED_IDS.ESTAB_MAGDALENA,
        organizacion_id: SEED_IDS.ORG_MAGDALENA,
        nombre_comercial: 'Carnicería Don Lucho - Mercado Magdalena',
        tipo: 'PUESTO_MERCADO',
        lng: -77.0708,
        lat: -12.0912,
        direccion_texto: 'Mercado de Magdalena Puesto 45, Lima',
        ubigeo: '150120'
      }
    ];

    for (const est of establecimientos) {
      await client.query(
        `INSERT INTO establecimientos (id, organizacion_id, nombre_comercial, tipo, coordenadas, direccion_texto, ubigeo, activo)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8, true)`,
        [est.id, est.organizacion_id, est.nombre_comercial, est.tipo, est.lng, est.lat, est.direccion_texto, est.ubigeo]
      );
    }
    console.log(`  ✔ 4 Establecimientos georreferenciados (Lurín, Arequipa, Puno, Magdalena).`);

    // 6. Inserción de Cotizaciones de la Pizarra Spot
    console.log('▶ [6/11] Sembrando Cotizaciones en tiempo real en la Pizarra Spot...');
    const spotQuotes = [
      {
        id: SEED_IDS.SPOT_1,
        establecimiento_id: SEED_IDS.ESTAB_PUNO,
        producto: 'GANADO_EN_PIE',
        categoria: 'TORETE_RECRIA',
        calidad: 'PRIMERA',
        unidad_medida: 'KG_VIVO',
        moneda: 'PEN',
        precio_unitario: 8.20,
        procedencia_ubigeo: '210101'
      },
      {
        id: SEED_IDS.SPOT_2,
        establecimiento_id: SEED_IDS.ESTAB_LURIN,
        producto: 'GANADO_EN_PIE',
        categoria: 'VACUNO_ENGORDADO',
        calidad: 'ESPECIAL',
        unidad_medida: 'KG_VIVO',
        moneda: 'PEN',
        precio_unitario: 9.80,
        procedencia_ubigeo: '150119'
      },
      {
        id: SEED_IDS.SPOT_3,
        establecimiento_id: SEED_IDS.ESTAB_AREQUIPA,
        producto: 'CARNE_CANAL',
        categoria: 'MEDIA_CANAL',
        calidad: 'EXTRA',
        unidad_medida: 'KG_CANAL',
        moneda: 'PEN',
        precio_unitario: 16.50,
        procedencia_ubigeo: '040101'
      }
    ];

    for (const sq of spotQuotes) {
      await client.query(
        `INSERT INTO cotizaciones_spot (id, establecimiento_id, producto, categoria, calidad, unidad_medida, moneda, precio_unitario, procedencia_ubigeo, vigencia_hasta, verificado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + INTERVAL '7 days', true)`,
        [
          sq.id,
          sq.establecimiento_id,
          sq.producto,
          sq.categoria,
          sq.calidad,
          sq.unidad_medida,
          sq.moneda,
          sq.precio_unitario,
          sq.procedencia_ubigeo
        ]
      );
    }
    console.log(`  ✔ 3 Cotizaciones spot vigentes (Torete Puno S/ 8.20, Engordado Lurín S/ 9.80, Media Canal AQP S/ 16.50).`);

    // 7. Subastas en Vivo, Históricas y Órdenes de Compra
    console.log('▶ [7/11] Sembrando Sala de Subastas (Lote Activo + Lote Adjudicado con Orden Liquidada)...');
    // 7a. Lote Activo (Cierre en 48 horas)
    await client.query(
      `INSERT INTO lotes_subasta (
        id, codigo_lote, vendedor_id, estado, precio_base, precio_actual, incremento_minimo,
        postor_ganador_id, fecha_inicio, fecha_cierre, anti_sniping_seconds, anti_sniping_extension, version
      ) VALUES (
        $1, 'LOTE-ACT-2026-001', $2, 'ACTIVO', 38000.00, 39500.00, 500.00,
        $3, NOW() - INTERVAL '6 hours', NOW() + INTERVAL '48 hours', 60, 120, 3
      )`,
      [SEED_IDS.LOTE_ACTIVO, SEED_IDS.ORG_PUNO, SEED_IDS.USER_LURIN]
    );

    await client.query(
      `INSERT INTO subasta_pujas (id, lote_id, postor_id, monto, secuencia, idempotency_key)
       VALUES
        ($1, $2, $3, 38500.00, 1, 'lote-act-puja-1'),
        ($4, $2, $5, 39500.00, 2, 'lote-act-puja-2')`,
      [SEED_IDS.PUJA_ACT_1, SEED_IDS.LOTE_ACTIVO, SEED_IDS.USER_MAGDALENA, SEED_IDS.PUJA_ACT_2, SEED_IDS.USER_LURIN]
    );

    // 7b. Lote Adjudicado Histórico
    await client.query(
      `INSERT INTO lotes_subasta (
        id, codigo_lote, vendedor_id, estado, precio_base, precio_actual, incremento_minimo,
        postor_ganador_id, fecha_inicio, fecha_cierre, anti_sniping_seconds, anti_sniping_extension, version
      ) VALUES (
        $1, 'LOTE-ADJ-2026-002', $2, 'ADJUDICADO', 32000.00, 35000.00, 500.00,
        $3, NOW() - INTERVAL '7 days', NOW() - INTERVAL '5 days', 60, 120, 2
      )`,
      [SEED_IDS.LOTE_ADJUDICADO, SEED_IDS.ORG_PUNO, SEED_IDS.USER_LURIN]
    );

    await client.query(
      `INSERT INTO subasta_pujas (id, lote_id, postor_id, monto, secuencia, idempotency_key)
       VALUES ($1, $2, $3, 35000.00, 1, 'lote-adj-puja-1')`,
      [SEED_IDS.PUJA_ADJ_1, SEED_IDS.LOTE_ADJUDICADO, SEED_IDS.USER_LURIN]
    );

    // Orden de compra liquidada asociada al lote adjudicado
    await client.query(
      `INSERT INTO ordenes_compra (
        id, lote_id, comprador_id, organizacion_compradora_id, vendedor_id, organizacion_vendedora_id,
        monto_adjudicado, comision_plataforma, total_a_pagar, estado
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        35000.00, 700.00, 35700.00, 'LIQUIDADO'
      )`,
      [
        SEED_IDS.ORDEN_ADJUDICADA,
        SEED_IDS.LOTE_ADJUDICADO,
        SEED_IDS.USER_LURIN,
        SEED_IDS.ORG_LURIN,
        SEED_IDS.USER_PUNO,
        SEED_IDS.ORG_PUNO
      ]
    );
    console.log(`  ✔ Subastas configuradas: LOTE-ACT-2026-001 (Activo S/ 39,500) y LOTE-ADJ-2026-002 (Liquidado S/ 35,000).`);

    // 8. Demand Pooling y Ofertas Flash
    console.log('▶ [8/11] Sembrando Pools Mayoristas B2B y Ofertas Flash...');
    await client.query(
      `INSERT INTO pools_compra_mayorista (
        id, creador_id, organizacion_id, tipo_producto, titulo, descripcion,
        precio_unitario_mayorista, meta_volumen, volumen_acumulado, unidad_medida,
        fecha_limite, estado, es_oferta_flash
      ) VALUES (
        $1, $2, $3, 'GRANO_FORRAJE', 'Pool de Compra: Maíz Amarillo Duro Nacional (Campaña 2026)',
        'Compra agregada de maíz amarillo seco para formulación de raciones de engorde en feedlot. Descuento directo de molino.',
        1.15, 30.00, 18.00, 'TONELADA',
        NOW() + INTERVAL '10 days', 'ABIERTO', false
      )`,
      [SEED_IDS.POOL_MAIZ, SEED_IDS.USER_LURIN, SEED_IDS.ORG_LURIN]
    );

    await client.query(
      `INSERT INTO pool_participaciones (
        id, pool_id, comprador_id, organizacion_compradora_id, cantidad, monto_total, estado
      ) VALUES (
        $1, $2, $3, $4, 18.00, 20700.00, 'CONFIRMADO'
      )`,
      [SEED_IDS.PART_MAIZ, SEED_IDS.POOL_MAIZ, SEED_IDS.USER_LURIN, SEED_IDS.ORG_LURIN]
    );

    await client.query(
      `INSERT INTO pools_compra_mayorista (
        id, creador_id, organizacion_id, tipo_producto, titulo, descripcion,
        precio_unitario_mayorista, meta_volumen, volumen_acumulado, unidad_medida,
        fecha_limite, estado, es_oferta_flash
      ) VALUES (
        $1, $2, $3, 'MEDIAS_CANALES', 'Oferta Flash: 10 Medias Canales Vacuno Seleccionado',
        'Lote especial de vacuno en media canal con maduración de 48h en cámara de beneficio. Cadena de frío asegurada a 2°C.',
        15.80, 10.00, 4.00, 'UNIDAD',
        NOW() + INTERVAL '14 hours', 'ABIERTO', true
      )`,
      [SEED_IDS.POOL_FLASH, SEED_IDS.USER_AREQUIPA, SEED_IDS.ORG_AREQUIPA]
    );
    console.log(`  ✔ Pools sembrados: Maíz Amarillo (Meta: 30 TM / Acumulado: 18 TM) y Oferta Flash 10 Medias Canales (14h restantes).`);

    // 9. Trazabilidad Bovina y Pasaporte Digital SHA-256
    console.log('▶ [9/11] Sembrando Trazabilidad Bovina y Pasaporte Digital con Hashes Criptográficos Reales...');
    await client.query(
      `INSERT INTO bovinos (id, codigo_arete, organizacion_id, raza, sexo, fecha_nacimiento, estado)
       VALUES ($1, 'PE-04-9821', $2, 'Simmental', 'MACHO', '2024-06-15', 'VIVO')`,
      [SEED_IDS.BOVINO, SEED_IDS.ORG_PUNO]
    );

    // Evento 1: REGISTRO_INICIAL
    const meta1 = {
      arete: 'PE-04-9821',
      raza: 'Simmental',
      predio_nacimiento: 'Comunidad San Salvador, Puno',
      pesaje_inicial_kg: 185.0
    };
    const hash1 = calcularHashEvento(GENESIS_PREV_HASH, SEED_IDS.BOVINO, 1, 'REGISTRO_INICIAL', meta1);

    await client.query(
      `INSERT INTO pasaporte_bovino_events (bovino_id, secuencia, event_type, metadata, prev_hash, current_hash, autor_id)
       VALUES ($1, 1, 'REGISTRO_INICIAL', $2, $3, $4, $5)`,
      [SEED_IDS.BOVINO, JSON.stringify(meta1), GENESIS_PREV_HASH, hash1, SEED_IDS.USER_PUNO]
    );

    // Evento 2: VACUNACION
    const meta2 = {
      vacuna: 'Fiebre Aftosa y Carbunclo Bacteridiano',
      dosis_ml: 5,
      lote_vacuna: 'VAC-2025-789',
      certificado_senasa: 'SENASA-VAC-44912'
    };
    const hash2 = calcularHashEvento(hash1, SEED_IDS.BOVINO, 2, 'VACUNACION', meta2);

    await client.query(
      `INSERT INTO pasaporte_bovino_events (bovino_id, secuencia, event_type, metadata, prev_hash, current_hash, autor_id)
       VALUES ($1, 2, 'VACUNACION', $2, $3, $4, $5)`,
      [SEED_IDS.BOVINO, JSON.stringify(meta2), hash1, hash2, SEED_IDS.USER_PUNO]
    );

    // Evento 3: MOVILIZACION_CSTI
    const meta3 = {
      csti_numero: 'CSTI-2026-08129',
      origen_ubigeo: '210101',
      destino_ubigeo: '150119',
      placa_transporte: 'V4T-980'
    };
    const hash3 = calcularHashEvento(hash2, SEED_IDS.BOVINO, 3, 'MOVILIZACION_CSTI', meta3);

    await client.query(
      `INSERT INTO pasaporte_bovino_events (bovino_id, secuencia, event_type, metadata, prev_hash, current_hash, autor_id)
       VALUES ($1, 3, 'MOVILIZACION_CSTI', $2, $3, $4, $5)`,
      [SEED_IDS.BOVINO, JSON.stringify(meta3), hash2, hash3, SEED_IDS.USER_PUNO]
    );
    console.log(`  ✔ Bovino PE-04-9821 con cadena de 3 bloques SHA-256 matemáticamente verificados.`);

    // 10. Flota Logística y Solicitud de Flete
    console.log('▶ [10/11] Sembrando Flota de Transporte y Solicitud de Flete Ganadito Cargo...');
    await client.query(
      `INSERT INTO transportistas_unidades (
        id, organizacion_id, transportista_id, placa, tipo_unidad, capacidad_toneladas, capacidad_cabezas, tiene_termoregistrador, activa
      ) VALUES
       ($1, $2, $3, 'V4T-980', 'CAMION_JAULA_DOBLE_PISO', 28.00, 40, false, true),
       ($4, $2, $3, 'B8C-712', 'FURGON_ISOTERMICO_REFRIGERADO', 12.50, null, true, true)`,
      [SEED_IDS.UNIDAD_JAULA, SEED_IDS.ORG_LOGISTICA, SEED_IDS.USER_LOGISTICA, SEED_IDS.UNIDAD_FURGON]
    );

    await client.query(
      `INSERT INTO fletes_solicitudes (
        id, orden_compra_id, solicitante_id, origen_establecimiento_id, destino_establecimiento_id,
        tipo_carga, peso_toneladas, distancia_km, costo_flete_bruto, comision_referral_fee, total_flete,
        unidad_id, transportista_id, estado
      ) VALUES (
        $1, $2, $3, $4, $5,
        'CARNE_CANAL', 4.50, 32.50, 850.00, 42.50, 892.50,
        null, null, 'PENDIENTE_ASIGNACION'
      )`,
      [
        SEED_IDS.FLETE_SOLICITUD,
        SEED_IDS.ORDEN_ADJUDICADA,
        SEED_IDS.USER_LURIN,
        SEED_IDS.ESTAB_LURIN,
        SEED_IDS.ESTAB_MAGDALENA
      ]
    );
    console.log(`  ✔ Unidades registradas (V4T-980 jaula, B8C-712 furgón frío) y flete pendiente Lurín -> Magdalena.`);

    // 11. Facturación Electrónica SUNAT y Factoring CAVALI
    console.log('▶ [11/11] Sembrando Comprobante Tributario SEE-SUNAT y Factoring CAVALI...');
    await client.query(
      `INSERT INTO comprobantes_tributarios (
        id, orden_id, tipo_comprobante, serie, correlativo, emisor_ruc, receptor_num_doc, receptor_tipo_doc,
        monto_subtotal, monto_igv, monto_total, estado_sunat, external_correlation_id, xml_payload_resumen,
        cdr_sunat_codigo, cdr_sunat_mensaje, retry_count
      ) VALUES (
        $1, $2, 'LIQUIDACION_COMPRA_ELECTRONICA', 'E001', 42, '20608492015', '20451234561', 'RUC',
        35000.00, 0.00, 35000.00, 'CONFIRMADO', 'SUNAT-LCE-E001-00000042',
        $3, '0', 'La Liquidación de Compra Electrónica número E001-00000042 ha sido aceptada satisfactoriamente por SUNAT.', 0
      )`,
      [
        SEED_IDS.COMPROBANTE_LCE,
        SEED_IDS.ORDEN_ADJUDICADA,
        JSON.stringify({
          serie: 'E001',
          correlativo: 42,
          emisor: '20608492015',
          receptor: '20451234561',
          total: 35000.00,
          items: [{ descripcion: '20 toretes Brown Swiss de recría', cantidad: 20, valor_unitario: 1750.00 }]
        })
      ]
    );

    await client.query(
      `INSERT INTO factoring_cavali_solicitudes (
        id, orden_id, comprobante_id, organizacion_id, monto_factura, porcentaje_adelanto, tasa_descuento_mensual,
        estado, cavali_tracking_id
      ) VALUES (
        $1, $2, $3, $4, 35000.00, 80.00, 1.20,
        'CONFIRMADO', 'CAV-2026-00042'
      )`,
      [
        SEED_IDS.CAVALI_SOLICITUD,
        SEED_IDS.ORDEN_ADJUDICADA,
        SEED_IDS.COMPROBANTE_LCE,
        SEED_IDS.ORG_LURIN
      ]
    );
    console.log(`  ✔ Comprobante E001-00000042 y Solicitud CAVALI CAV-2026-00042 confirmados.`);

    await client.query('COMMIT');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ BASE DE DATOS GANADITO SEMBRADA CON ÉXITO (100% IDEMPOTENTE)');
    console.log('   Credenciales de prueba:');
    console.log('   • Admin:      admin@ganadito.pe      / <contraseña del seed>');
    console.log('   • Vendedor:   puno@ganadito.pe       / <contraseña del seed>');
    console.log('   • Comprador:  lurin@ganadito.pe      / <contraseña del seed>');
    console.log('   • Camal:      arequipa@ganadito.pe   / <contraseña del seed>');
    console.log('   • Minorista:  magdalena@ganadito.pe  / <contraseña del seed>');
    console.log('   • Transporte: logistica@ganadito.pe  / <contraseña del seed>');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error durante la siembra de la base de datos:', error);
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

// Ejecutar si se invoca directamente desde CLI
// Comparación exacta de rutas: `endsWith('seed.ts')` también disparaba la siembra al importar
// cualquier archivo cuyo nombre terminara en "seed.ts" (y nunca con el seed.js compilado).
const esEjecucionDirecta =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (esEjecucionDirecta) {
  runDatabaseSeed().catch(() => {
    process.exit(1);
  });
}
