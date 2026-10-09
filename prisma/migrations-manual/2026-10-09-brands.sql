-- Marcas del agente (entrega 1 de 3).
-- Spec: docs/superpowers/specs/2026-10-09-marcas-agente-design.md
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código: Prisma lee lead_connectors."brandId" en cada consulta de
-- cuentas, y sin la columna fallarían TODAS las lecturas de conectores.
--
-- Rollback:
--   ALTER TABLE "propyte_crm"."lead_connectors" DROP COLUMN IF EXISTS "brandId";
--   DROP TABLE IF EXISTS "propyte_crm"."contact_brands";
--   DROP TABLE IF EXISTS "propyte_crm"."brands";

CREATE TABLE IF NOT EXISTS "propyte_crm"."brands" (
  "id"                   TEXT PRIMARY KEY,
  "name"                 TEXT NOT NULL,
  "slug"                 TEXT NOT NULL,
  "isDefault"            BOOLEAN NOT NULL DEFAULT false,
  "persona"              TEXT,
  "knowledge"            TEXT,
  "developmentIds"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "defaultPlaza"         "propyte_crm"."Plaza",
  "enabledChannels"      JSONB,
  "tonePreset"           "propyte_crm"."BotTonePreset",
  "playbookId"           TEXT,
  "marketingOwnerUserId" TEXT,
  "botEnabled"           BOOLEAN NOT NULL DEFAULT false,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"            TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "brands_name_key" ON "propyte_crm"."brands"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "brands_slug_key" ON "propyte_crm"."brands"("slug");
-- Exactamente una predeterminada (entre las no borradas).
CREATE UNIQUE INDEX IF NOT EXISTS "brands_single_default_key"
  ON "propyte_crm"."brands"("isDefault") WHERE "isDefault" AND "deletedAt" IS NULL;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."brands"
    ADD CONSTRAINT "brands_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "propyte_crm"."bot_playbooks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."brands"
    ADD CONSTRAINT "brands_marketingOwnerUserId_fkey"
    FOREIGN KEY ("marketingOwnerUserId") REFERENCES "propyte_crm"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."contact_brands" (
  "id"               TEXT PRIMARY KEY,
  "contactId"        TEXT NOT NULL,
  "brandId"          TEXT NOT NULL,
  "firstConnectorId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_brands_contactId_brandId_key"
  ON "propyte_crm"."contact_brands"("contactId", "brandId");
CREATE INDEX IF NOT EXISTS "contact_brands_brandId_idx"
  ON "propyte_crm"."contact_brands"("brandId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."contact_brands"
    ADD CONSTRAINT "contact_brands_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."contact_brands"
    ADD CONSTRAINT "contact_brands_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "propyte_crm"."brands"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "propyte_crm"."lead_connectors" ADD COLUMN IF NOT EXISTS "brandId" TEXT;
CREATE INDEX IF NOT EXISTS "lead_connectors_brandId_idx" ON "propyte_crm"."lead_connectors"("brandId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."lead_connectors"
    ADD CONSTRAINT "lead_connectors_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "propyte_crm"."brands"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Marca predeterminada. El agente de la predeterminada usa la configuración global de
-- siempre: sus campos de agente se ignoran (ver src/lib/brands/resolve.ts).
INSERT INTO "propyte_crm"."brands" ("id", "name", "slug", "isDefault", "botEnabled")
VALUES ('00000000-0000-4000-8000-000000000001', 'Propyte', 'propyte', true, true)
ON CONFLICT DO NOTHING;

-- RLS sin políticas + GRANT explícito (mismo patrón que 2026-08-17-permissions-tables.sql).
ALTER TABLE "propyte_crm"."brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."contact_brands" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."brands" TO postgres;
GRANT SELECT ON "propyte_crm"."brands" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."contact_brands" TO postgres;
GRANT SELECT ON "propyte_crm"."contact_brands" TO service_role;
