-- WhatsApp en coexistencia (PR 2 de 2): el número propio de cada asesor + «posibles prospectos».
-- Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §4 y §7
-- Requiere la del PR 1 (2026-10-14-whatsapp-coexistencia.sql: enum ConnectorScope + columna scope).
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código: Prisma lee lead_connectors."ownerUserId" en cada consulta de
-- cuentas, y sin la columna fallarían TODAS las lecturas de conectores.
--
-- No toca propyte_crm.users: el Hub comparte esa tabla. Las FK hacia users viven en ESTAS tablas,
-- igual que brands."marketingOwnerUserId" y user_brand_access.
--
-- Rollback:
--   DROP TABLE IF EXISTS "propyte_crm"."whatsapp_pending_prospects";
--   DROP TYPE IF EXISTS "propyte_crm"."PendingProspectStatus";
--   ALTER TABLE "propyte_crm"."lead_connectors" DROP COLUMN IF EXISTS "ownerUserId";

-- 1. Dueño del número (solo cuentas scope = ADVISOR). Si el usuario se borra, la cuenta queda sin
-- dueño (y el número se sigue tratando como de asesor: ver lib/whatsapp/coex/asesor.ts).
ALTER TABLE "propyte_crm"."lead_connectors" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

CREATE INDEX IF NOT EXISTS "lead_connectors_ownerUserId_idx"
  ON "propyte_crm"."lead_connectors"("ownerUserId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."lead_connectors"
    ADD CONSTRAINT "lead_connectors_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "propyte_crm"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Posibles prospectos. SIN columna de texto ni de media a propósito (decisión 1 del dueño): de
-- un remitente desconocido solo se guarda quién es y cuántas veces escribió.
DO $$ BEGIN
  CREATE TYPE "propyte_crm"."PendingProspectStatus" AS ENUM ('PENDING', 'PROMOTED', 'IGNORED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."whatsapp_pending_prospects" (
  "id"           TEXT PRIMARY KEY,
  "connectorId"  TEXT NOT NULL,
  "ownerUserId"  TEXT,
  "senderKey"    TEXT NOT NULL,
  "phone"        TEXT,
  "waUserId"     TEXT,
  "profileName"  TEXT,
  "contactName"  TEXT,
  "firstSeenAt"  TIMESTAMP(3) NOT NULL,
  "lastSeenAt"   TIMESTAMP(3) NOT NULL,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "status"       "propyte_crm"."PendingProspectStatus" NOT NULL DEFAULT 'PENDING',
  "contactId"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_pending_prospects_connectorId_senderKey_key"
  ON "propyte_crm"."whatsapp_pending_prospects"("connectorId", "senderKey");
CREATE INDEX IF NOT EXISTS "whatsapp_pending_prospects_ownerUserId_status_lastSeenAt_idx"
  ON "propyte_crm"."whatsapp_pending_prospects"("ownerUserId", "status", "lastSeenAt");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."whatsapp_pending_prospects"
    ADD CONSTRAINT "whatsapp_pending_prospects_connectorId_fkey"
    FOREIGN KEY ("connectorId") REFERENCES "propyte_crm"."lead_connectors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."whatsapp_pending_prospects"
    ADD CONSTRAINT "whatsapp_pending_prospects_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "propyte_crm"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS sin políticas + GRANT explícito (mismo patrón que 2026-10-09-brands.sql y user_brand_access).
ALTER TABLE "propyte_crm"."whatsapp_pending_prospects" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."whatsapp_pending_prospects" TO postgres;
GRANT SELECT ON "propyte_crm"."whatsapp_pending_prospects" TO service_role;
