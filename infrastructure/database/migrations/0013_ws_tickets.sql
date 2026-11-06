-- Migración 0013: tickets efímeros de un solo uso para abrir el WebSocket de subastas.
--
-- Los navegadores no pueden enviar Authorization en el upgrade del WebSocket y antes se
-- pasaba el JWT de 15 min en ?access_token= (queda en historiales, proxies y logs).
-- Ahora el cliente pide un ticket con su JWT (POST, cabecera) y abre el WS con
-- ?ticket=. El ticket:
--   - vale 30 s y para UN solo lote;
--   - se consume una sola vez (UPDATE ... WHERE usado_en IS NULL, atómico);
--   - se guarda solo su SHA-256: un volcado de la tabla no permite conectarse.
-- Es estado de autenticación efímero; vive en PostgreSQL (fuente de verdad) y no en
-- Redis para que el consumo único sea transaccional.

CREATE TABLE IF NOT EXISTS ws_tickets (
  hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Contexto con el que se emitió: al consumir se revalida que la membresía siga activa.
  organizacion_id UUID NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
  rol VARCHAR(50) NOT NULL,
  lote_id UUID NOT NULL REFERENCES lotes_subasta(id) ON DELETE CASCADE,
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ws_tickets_expira ON ws_tickets(expira_en);
CREATE INDEX IF NOT EXISTS idx_ws_tickets_usuario_vigentes ON ws_tickets(user_id, expira_en) WHERE usado_en IS NULL;
