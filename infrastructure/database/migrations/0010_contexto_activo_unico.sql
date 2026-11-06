-- Migración 0010: un único contexto activo por usuario (RBAC dual).
-- Si existieran varios contextos activos para un mismo usuario, se conserva el más reciente
-- y el resto pasa a inactivo (solo cambia la bandera; no se borran membresías).
WITH ranked AS (
  SELECT user_id, organizacion_id, rol,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, organizacion_id, rol) AS rn
  FROM user_organizaciones_roles
  WHERE is_active_context
)
UPDATE user_organizaciones_roles u
SET is_active_context = FALSE
FROM ranked r
WHERE u.user_id = r.user_id AND u.organizacion_id = r.organizacion_id AND u.rol = r.rol AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_contexto_activo
  ON user_organizaciones_roles (user_id)
  WHERE is_active_context;
