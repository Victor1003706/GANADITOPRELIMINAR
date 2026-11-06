/**
 * @ganadito/contracts
 *
 * Contratos, tipos compartidos y esquemas de dominio de Ganadito.
 * Fuente única de verdad tipada para frontend (apps/web), backend (apps/api)
 * y servicios auxiliares.
 */

// 1. Tipos geoespaciales y PostGIS
export * from './geo.js';

// 2. Identidad, Contexto Organizacional y Establecimientos (RBAC dual)
export * from './identity.js';

// 3. Motor de Subastas (Core)
export * from './auctions.js';

// 4. Pizarra Spot y Mapa
export * from './spot.js';

// 5. Órdenes de Compra Comercial y Liquidación de Subastas
export * from './orders.js';

// 6. Pagos y Webhooks de Pasarelas
export * from './payments.js';

// 7. Trazabilidad Bovina y Pasaporte Digital
export * from './traceability.js';

// 8. Motor de Compras Mayoristas, Demand Pooling y Ofertas Flash
export * from './wholesale.js';

// 9. Bolsa de Valores Cárnica (GMX) y Motor de Escandallo Anatómico (NTP 201.055)
export * from './gmx.js';

// 10. Pasarela Logística Integrada (Ganadito Cargo & Express API)
export * from './logistics.js';

// 11. Servicio Satélite de Inteligencia Artificial (ExpoGanadito & Dr. Ganadito)
export * from './ai.js';

// 12. Integraciones Tributarias y Financieras (SEE-SUNAT & CAVALI Factoring)
export * from './tax.js';

// 12b. Estimación orientativa de peso vivo (zoometría) y pesajes de balanza
export * from './weight.js';

// 13. Utilidades generales de contratos
export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  version: string;
  environment: string;
}
