-- Migración 0009: Integraciones Tributarias (SEE-SUNAT) y Financieras (CAVALI Factoring)

CREATE TABLE IF NOT EXISTS comprobantes_tributarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id UUID NOT NULL REFERENCES ordenes_compra(id),
  tipo_comprobante VARCHAR(40) NOT NULL CHECK (tipo_comprobante IN ('LIQUIDACION_COMPRA_ELECTRONICA', 'FACTURA_ELECTRONICA', 'BOLETA_ELECTRONICA')),
  serie CHAR(4) NOT NULL,
  correlativo INT NOT NULL,
  emisor_ruc CHAR(11) NOT NULL,
  receptor_num_doc VARCHAR(20) NOT NULL,
  receptor_tipo_doc VARCHAR(5) NOT NULL CHECK (receptor_tipo_doc IN ('DNI', 'RUC')),
  monto_subtotal NUMERIC(12,2) NOT NULL,
  monto_igv NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  monto_total NUMERIC(12,2) NOT NULL,
  estado_sunat VARCHAR(30) NOT NULL DEFAULT 'CREADO' CHECK (estado_sunat IN ('CREADO', 'ENVIADO_PENDIENTE', 'CONFIRMADO', 'RECHAZADO', 'EN_DISPUTA', 'REQUIERE_CONCILIACION')),
  external_correlation_id VARCHAR(100) UNIQUE NOT NULL,
  xml_payload_resumen JSONB NOT NULL,
  cdr_sunat_codigo VARCHAR(20) NULL,
  cdr_sunat_mensaje TEXT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_comprobante_serie_correlativo UNIQUE (tipo_comprobante, serie, correlativo)
);

CREATE INDEX IF NOT EXISTS idx_comprobantes_orden ON comprobantes_tributarios(orden_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_estado ON comprobantes_tributarios(estado_sunat);
CREATE INDEX IF NOT EXISTS idx_comprobantes_serie_correlativo ON comprobantes_tributarios(serie, correlativo);

CREATE TABLE IF NOT EXISTS factoring_cavali_solicitudes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id UUID NOT NULL REFERENCES ordenes_compra(id),
  comprobante_id UUID NOT NULL REFERENCES comprobantes_tributarios(id),
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id),
  monto_factura NUMERIC(12,2) NOT NULL,
  porcentaje_adelanto NUMERIC(5,2) NOT NULL DEFAULT 80.00,
  tasa_descuento_mensual NUMERIC(5,2) NOT NULL DEFAULT 1.20,
  estado VARCHAR(30) NOT NULL DEFAULT 'CREADO' CHECK (estado IN ('CREADO', 'ENVIADO_PENDIENTE', 'CONFIRMADO', 'RECHAZADO', 'REQUIERE_CONCILIACION')),
  cavali_tracking_id VARCHAR(100) UNIQUE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cavali_orden ON factoring_cavali_solicitudes(orden_id);
CREATE INDEX IF NOT EXISTS idx_cavali_comprobante ON factoring_cavali_solicitudes(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_cavali_estado ON factoring_cavali_solicitudes(estado);
