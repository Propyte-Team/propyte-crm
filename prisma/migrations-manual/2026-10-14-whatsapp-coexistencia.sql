-- WhatsApp en coexistencia (PR 1 de 2): alcance de la cuenta + un número vivo por cuenta.
-- Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código: Prisma lee lead_connectors."scope" en cada consulta de cuentas,
-- y sin la columna fallarían TODAS las lecturas de conectores (mismo aviso que 2026-10-09-brands.sql).
--
-- No toca propyte_crm.users: el Hub comparte esa tabla.
--
-- Rollback:
--   DROP INDEX IF EXISTS "propyte_crm"."lead_connectors_whatsapp_phone_number_id_key";
--   ALTER TABLE "propyte_crm"."lead_connectors" DROP COLUMN IF EXISTS "scope";
--   DROP TYPE IF EXISTS "propyte_crm"."ConnectorScope";

-- 1. Alcance. Todas las cuentas de hoy son líneas de marca: el DEFAULT las deja así sin rellenar.
DO $$ BEGIN
  CREATE TYPE "propyte_crm"."ConnectorScope" AS ENUM ('BRAND', 'ADVISOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "propyte_crm"."lead_connectors"
  ADD COLUMN IF NOT EXISTS "scope" "propyte_crm"."ConnectorScope" NOT NULL DEFAULT 'BRAND';

-- 2. Un número de WhatsApp vivo = una cuenta. El alta por Embedded Signup es idempotente (mismo
-- phoneNumberId → se actualiza la cuenta), pero dos altas simultáneas podrían crear dos filas; la
-- base es el único sitio donde eso no tiene carrera. Las cuentas borradas (soft delete) no cuentan.
-- Medido el 2026-10-14: 0 cuentas WHATSAPP en producción, así que el índice no choca con nada.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_connectors_whatsapp_phone_number_id_key"
  ON "propyte_crm"."lead_connectors" (("config"->>'phoneNumberId'))
  WHERE "provider" = 'WHATSAPP' AND "deletedAt" IS NULL;
