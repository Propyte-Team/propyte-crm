-- WhatsApp multicuenta (Fase A). Aditivo + reescritura de la unicidad de Conversation.
--
-- APLICAR EN 2 ENVÍOS (ADD VALUE no puede correr dentro de un bloque de transacción):
--   ENVÍO 1  = solo el paso 1 (ALTER TYPE ... ADD VALUE), commit.
--   ENVÍO 2  = pasos 2 a 4.

-- ============================ ENVÍO 1 ============================
-- 1) Nuevo valor de enum (ADD VALUE fuera de transacción).
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'WHATSAPP';

-- ============================ ENVÍO 2 ============================
-- 2) Columna connectorId (nullable) + FK (guardada para re-ejecución segura).
ALTER TABLE "propyte_crm"."conversations"
  ADD COLUMN IF NOT EXISTS "connectorId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_connectorId_fkey'
  ) THEN
    ALTER TABLE "propyte_crm"."conversations"
      ADD CONSTRAINT "conversations_connectorId_fkey"
      FOREIGN KEY ("connectorId") REFERENCES "propyte_crm"."lead_connectors"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Reemplazar la unicidad: de (contactId, channel) a (contactId, channel, connectorId).
DROP INDEX IF EXISTS "propyte_crm"."conversations_contactId_channel_key";
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_contactId_channel_connectorId_key"
  ON "propyte_crm"."conversations" ("contactId", "channel", "connectorId");

-- 4) Índice único parcial para hilos sin connector (WEB/SMS/legacy): 1 por (contacto, canal).
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_contactId_channel_nullconn_key"
  ON "propyte_crm"."conversations" ("contactId", "channel")
  WHERE "connectorId" IS NULL;
