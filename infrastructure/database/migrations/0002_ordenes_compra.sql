-- Migración 0002: Tabla de Órdenes de Compra Comercial (Adjudicación y Liquidación de Subastas)

CREATE TABLE IF NOT EXISTS ordenes_compra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL UNIQUE REFERENCES lotes_subasta(id) ON DELETE RESTRICT,
  comprador_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organizacion_compradora_id UUID REFERENCES organizaciones(id) ON DELETE RESTRICT,
  vendedor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  organizacion_vendedora_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE RESTRICT,
  monto_adjudicado NUMERIC(12, 2) NOT NULL,
  comision_plataforma NUMERIC(12, 2) NOT NULL,
  total_a_pagar NUMERIC(12, 2) NOT NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE_PAGO'
    CHECK (estado IN ('PENDIENTE_PAGO', 'PAGADO', 'EN_CUSTODIA', 'ENTREGADO', 'LIQUIDADO', 'CANCELADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_comprador ON ordenes_compra(comprador_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_org_compradora ON ordenes_compra(organizacion_compradora_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_org_vendedora ON ordenes_compra(organizacion_vendedora_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_estado ON ordenes_compra(estado);
