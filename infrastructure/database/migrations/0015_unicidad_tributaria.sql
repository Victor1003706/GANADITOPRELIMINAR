-- Migración 0015: un comprobante vigente por orden y tipo, y un factoring vigente por
-- comprobante. Antes se podían emitir varias liquidaciones de compra por la misma orden
-- y ceder la misma factura varias veces (doble factoring).
--
-- Si ya existieran duplicados, crear los índices únicos abortaría la migración. Por eso
-- primero se conserva el MÁS ANTIGUO de cada grupo y los posteriores se marcan para
-- revisión manual (EN_DISPUTA / REQUIERE_CONCILIACION). No se borra ningún registro.

UPDATE comprobantes_tributarios c
SET estado_sunat = 'EN_DISPUTA'
WHERE c.estado_sunat NOT IN ('RECHAZADO', 'EN_DISPUTA')
  AND EXISTS (
    SELECT 1 FROM comprobantes_tributarios o
    WHERE o.orden_id = c.orden_id
      AND o.tipo_comprobante = c.tipo_comprobante
      AND o.estado_sunat NOT IN ('RECHAZADO', 'EN_DISPUTA')
      AND (o.created_at, o.id) < (c.created_at, c.id)
  );

UPDATE factoring_cavali_solicitudes f
SET estado = 'REQUIERE_CONCILIACION'
WHERE f.estado NOT IN ('RECHAZADO', 'REQUIERE_CONCILIACION')
  AND EXISTS (
    SELECT 1 FROM factoring_cavali_solicitudes o
    WHERE o.comprobante_id = f.comprobante_id
      AND o.estado NOT IN ('RECHAZADO', 'REQUIERE_CONCILIACION')
      AND (o.created_at, o.id) < (f.created_at, f.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_vigente_por_orden
  ON comprobantes_tributarios(orden_id, tipo_comprobante)
  WHERE estado_sunat NOT IN ('RECHAZADO', 'EN_DISPUTA');

CREATE UNIQUE INDEX IF NOT EXISTS uq_factoring_vigente_por_comprobante
  ON factoring_cavali_solicitudes(comprobante_id)
  WHERE estado NOT IN ('RECHAZADO', 'REQUIERE_CONCILIACION');
