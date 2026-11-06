-- Migración 0016: qué se vende en un lote (MVP).
-- Antes el lote solo tenía código, precios y fechas: un comprador no sabía qué animales
-- incluía. Todos los campos son opcionales para no romper lotes existentes.
-- La puja sigue siendo por el PRECIO TOTAL del lote (no por kg).

ALTER TABLE lotes_subasta
  ADD COLUMN IF NOT EXISTS cantidad_animales INT CHECK (cantidad_animales IS NULL OR (cantidad_animales BETWEEN 1 AND 10000)),
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(40),
  ADD COLUMN IF NOT EXISTS raza VARCHAR(60),
  ADD COLUMN IF NOT EXISTS descripcion VARCHAR(500),
  ADD COLUMN IF NOT EXISTS establecimiento_id UUID REFERENCES establecimientos(id) ON DELETE SET NULL;

-- Catálogo público: lotes publicados ordenados por cierre.
CREATE INDEX IF NOT EXISTS idx_lotes_subasta_catalogo
  ON lotes_subasta(estado, fecha_cierre, id) WHERE estado <> 'BORRADOR';
-- "Mis lotes" del vendedor.
CREATE INDEX IF NOT EXISTS idx_lotes_subasta_vendedor ON lotes_subasta(vendedor_id, created_at DESC);
