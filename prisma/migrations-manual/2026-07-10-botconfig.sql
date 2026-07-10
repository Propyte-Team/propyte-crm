-- Aditiva e idempotente. Aplicar en Supabase (DB compartida). Verificar el nombre real de la tabla
-- de usuarios (@@map de User; en este repo es "users").
DO $$ BEGIN
  CREATE TYPE "propyte_crm"."BotTonePreset" AS ENUM (
    'PROFESIONAL_CALIDO', 'CALIDO_CERCANO_MX', 'EJECUTIVO_SOBRIO', 'NEUTRO_DIRECTO'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."bot_config" (
  "id"                 TEXT PRIMARY KEY,
  "singleton"          BOOLEAN NOT NULL DEFAULT true,
  "botEnabled"         BOOLEAN NOT NULL DEFAULT true,
  "tonePreset"         "propyte_crm"."BotTonePreset" NOT NULL DEFAULT 'PROFESIONAL_CALIDO',
  "autonomyLevel"      "propyte_crm"."AutonomyLevel" NOT NULL DEFAULT 'L2',
  "model"              TEXT NOT NULL DEFAULT 'claude-sonnet-5',
  "openerStyle"        TEXT NOT NULL DEFAULT 'WARM_NAME',
  "maxLines"           INTEGER NOT NULL DEFAULT 4,
  "dataGateStrict"     BOOLEAN NOT NULL DEFAULT true,
  "escalationTriggers" JSONB NOT NULL DEFAULT '["apartar","queja","legal_fiscal","negociacion"]',
  "enabledChannels"    JSONB NOT NULL DEFAULT '["WHATSAPP"]',
  "updatedByUserId"    TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "bot_config_singleton_key" ON "propyte_crm"."bot_config"("singleton");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."bot_config"
    ADD CONSTRAINT "bot_config_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "propyte_crm"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fila default (seed) — no duplica en re-run (singleton es UNIQUE)
INSERT INTO "propyte_crm"."bot_config" ("id", "updatedAt")
VALUES (gen_random_uuid()::text, CURRENT_TIMESTAMP)
ON CONFLICT ("singleton") DO NOTHING;
