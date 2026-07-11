-- Aditiva e idempotente. Aplicar en Supabase (DB compartida). Depende de
-- 2026-07-10-botconfig.sql (tablas "bot_config", tipo "AutonomyLevel") y de
-- "propyte_crm"."conversations" (ya existente).

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."CaptureType" AS ENUM (
    'TEXT', 'FULL_NAME', 'EMAIL', 'PHONE', 'MONEY', 'BUDGET_RANGE', 'ENUM', 'ZONE', 'BOOLEAN', 'NUMBER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."PlaybookRunStatus" AS ENUM (
    'IN_PROGRESS', 'COMPLETED', 'ESCALATED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."bot_playbooks" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"   TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS "propyte_crm"."bot_tasks" (
  "id"             TEXT PRIMARY KEY,
  "playbookId"     TEXT NOT NULL,
  "order"          INTEGER NOT NULL,
  "key"            TEXT NOT NULL,
  "objective"      TEXT NOT NULL,
  "targetField"    TEXT NOT NULL,
  "captureType"    "propyte_crm"."CaptureType" NOT NULL DEFAULT 'TEXT',
  "enumOptions"    JSONB NOT NULL DEFAULT '[]',
  "extractionHint" TEXT,
  "required"       BOOLEAN NOT NULL DEFAULT true,
  "skipIfFilled"   BOOLEAN NOT NULL DEFAULT true,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "propyte_crm"."conversation_playbook_state" (
  "id"                TEXT PRIMARY KEY,
  "conversationId"    TEXT NOT NULL,
  "playbookId"        TEXT NOT NULL,
  "status"            "propyte_crm"."PlaybookRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "currentTaskKey"    TEXT,
  "completedTaskKeys" JSONB NOT NULL DEFAULT '[]',
  "startedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"       TIMESTAMP(3),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "bot_tasks_playbookId_order_key" ON "propyte_crm"."bot_tasks"("playbookId", "order");
CREATE UNIQUE INDEX IF NOT EXISTS "bot_tasks_playbookId_key_key" ON "propyte_crm"."bot_tasks"("playbookId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_playbook_state_conversationId_key" ON "propyte_crm"."conversation_playbook_state"("conversationId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."bot_tasks"
    ADD CONSTRAINT "bot_tasks_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "propyte_crm"."bot_playbooks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."conversation_playbook_state"
    ADD CONSTRAINT "conversation_playbook_state_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "propyte_crm"."conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Referencia al playbook activo desde bot_config (singleton)
ALTER TABLE "propyte_crm"."bot_config" ADD COLUMN IF NOT EXISTS "activePlaybookId" TEXT;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."bot_config"
    ADD CONSTRAINT "bot_config_activePlaybookId_fkey"
    FOREIGN KEY ("activePlaybookId") REFERENCES "propyte_crm"."bot_playbooks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
