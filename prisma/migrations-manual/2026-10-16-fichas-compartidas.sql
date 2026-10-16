-- #887 — Fichas técnicas compartibles (enlace público /f/{token} ligado al asesor que la compartió).
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código. Si se despliega sin ella, el botón «Compartir ficha» responde un
-- error claro («falta aplicar la migración») y ninguna otra pantalla lee esta tabla.
-- NO toca propyte_crm.users (el Hub la comparte): la relación vive solo en esta tabla.
--
-- Rollback:
--   DROP TABLE IF EXISTS "propyte_crm"."fichas_compartidas";
--   DROP TYPE IF EXISTS "propyte_crm"."FichaTipo";

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."FichaTipo" AS ENUM ('DESARROLLO', 'UNIDAD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."fichas_compartidas" (
  "id"               TEXT PRIMARY KEY,
  "token"            TEXT NOT NULL,
  "clave"            TEXT NOT NULL,
  "tipo"             "propyte_crm"."FichaTipo" NOT NULL,
  "hubDevelopmentId" TEXT NOT NULL,
  "hubUnitId"        TEXT,
  "createdById"      TEXT NOT NULL,
  "aperturas"        INTEGER NOT NULL DEFAULT 0,
  "ultimaApertura"   TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "fichas_compartidas_token_key"
  ON "propyte_crm"."fichas_compartidas"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "fichas_compartidas_clave_key"
  ON "propyte_crm"."fichas_compartidas"("clave");
CREATE INDEX IF NOT EXISTS "fichas_compartidas_createdById_idx"
  ON "propyte_crm"."fichas_compartidas"("createdById");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."fichas_compartidas"
    ADD CONSTRAINT "fichas_compartidas_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "propyte_crm"."users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS sin políticas + GRANT explícito (mismo patrón que 2026-10-12-user-brand-access.sql): sin
-- GRANT a anon/authenticated, PostgREST no la expone. Se lee y escribe solo desde el servidor del CRM.
ALTER TABLE "propyte_crm"."fichas_compartidas" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."fichas_compartidas" TO postgres;
GRANT SELECT ON "propyte_crm"."fichas_compartidas" TO service_role;
