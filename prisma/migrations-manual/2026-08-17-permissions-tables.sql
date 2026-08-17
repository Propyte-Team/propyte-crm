-- 2026-08-17 — role_permissions y user_permission_overrides
-- Moderador de permisos — fase 0. Ver
-- docs/superpowers/specs/2026-08-17-moderador-permisos-design.md
-- Este repo aplica el DDL a mano (via MCP de Supabase), no con prisma migrate:
-- solo existe una migración de Prisma, la inicial de marzo.
-- Idempotente a propósito: se puede reejecutar sin romper nada.

-- "id" es text SIN default: el uuid lo genera Prisma en el cliente
-- (@default(uuid())), no Postgres. Quien inserte por SQL directo debe
-- pasar el id a mano.
CREATE TABLE IF NOT EXISTS propyte_crm.role_permissions (
  "id"         text NOT NULL,
  -- El enum se creó en Postgres con mayúsculas ("UserRole"): hay que
  -- citarlo entre comillas dobles o Postgres lo busca en minúsculas.
  "role"       propyte_crm."UserRole" NOT NULL,
  "permission" text NOT NULL,
  "createdAt"  timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT role_permissions_pkey PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_permission_key"
  ON propyte_crm.role_permissions USING btree ("role", "permission");

-- "id" es text SIN default, mismo motivo que en role_permissions arriba.
CREATE TABLE IF NOT EXISTS propyte_crm.user_permission_overrides (
  "id"         text NOT NULL,
  "userId"     text NOT NULL,
  "permission" text NOT NULL,
  "granted"    boolean NOT NULL,
  "reason"     text,
  "createdAt"  timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_permission_overrides_pkey PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_permission_overrides_userId_permission_key"
  ON propyte_crm.user_permission_overrides USING btree ("userId", "permission");

-- Postgres no admite IF NOT EXISTS en ADD CONSTRAINT, así que el bloque
-- traga el duplicado: sin esto, reejecutar el archivo entero (p. ej. tras
-- un fallo a media aplicación) revienta aquí con 42710.
DO $$
BEGIN
  ALTER TABLE propyte_crm.user_permission_overrides
    ADD CONSTRAINT "user_permission_overrides_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES propyte_crm.users("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- RLS: ambas tablas se leen y escriben solo desde el servidor. Se activa
-- sin políticas; postgres (Prisma) y service_role tienen bypassrls=true y
-- la saltan igual (mismo criterio que 2026-06-12-enable-rls.sql y
-- 2026-08-05-blocked-senders.sql).
ALTER TABLE propyte_crm.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE propyte_crm.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- GRANT explícito: activar RLS sin políticas no sustituye al GRANT de
-- Postgres, y esto ya mordió al proyecto — las tablas de intake devolvían
-- 500→403 en producción porque a service_role le faltaban
-- INSERT/UPDATE/DELETE (solo tenía SELECT). Aquí ninguna escritura pasa
-- por service_role (todo el CRUD de permisos va por Prisma, rol postgres),
-- así que se espeja el mismo patrón que blocked_senders: postgres con el
-- CRUD completo, service_role solo con lectura.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON propyte_crm.role_permissions TO postgres;
GRANT SELECT ON propyte_crm.role_permissions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON propyte_crm.user_permission_overrides TO postgres;
GRANT SELECT ON propyte_crm.user_permission_overrides TO service_role;
