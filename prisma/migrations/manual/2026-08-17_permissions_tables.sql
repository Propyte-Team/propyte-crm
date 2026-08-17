-- Moderador de permisos — fase 0.
-- Este repo aplica el DDL a mano (via MCP de Supabase), no con prisma migrate:
-- solo existe una migración de Prisma, la inicial de marzo.
-- Idempotente a propósito: se puede reejecutar sin romper nada.

CREATE TABLE IF NOT EXISTS propyte_crm.role_permissions (
  id          text PRIMARY KEY,
  role        propyte_crm."UserRole" NOT NULL,
  permission  text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_role_permission_key
  ON propyte_crm.role_permissions (role, permission);

CREATE TABLE IF NOT EXISTS propyte_crm.user_permission_overrides (
  id          text PRIMARY KEY,
  "userId"    text NOT NULL
              REFERENCES propyte_crm.users(id) ON DELETE CASCADE,
  permission  text NOT NULL,
  granted     boolean NOT NULL,
  reason      text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS user_permission_overrides_user_permission_key
  ON propyte_crm.user_permission_overrides ("userId", permission);

-- RLS: ambas tablas se leen solo desde el servidor con la conexión de Prisma.
-- Se activa sin políticas; service_role la salta. Mismo patrón que las tablas
-- de intake. Ver feedback_supabase_view_security_invoker_bypassa_rls.
ALTER TABLE propyte_crm.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE propyte_crm.user_permission_overrides ENABLE ROW LEVEL SECURITY;
