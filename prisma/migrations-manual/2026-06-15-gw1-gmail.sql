-- prisma/migrations-manual/2026-06-15-gw1-gmail.sql
-- GW-1: Gmail bidireccional. Aplicar en Supabase (schema propyte_crm).
-- Additivo y idempotente. Tras aplicar: `prisma generate` local crea el cliente.
-- El enum WorkflowActionType gana 2 valores nuevos (GW_GMAIL_LOG_INBOUND/OUTBOUND).

-- 1) Tabla de hilos Gmail (headers + snippet; cuerpo on-demand vía API).
CREATE TABLE IF NOT EXISTS propyte_crm.gmail_threads (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "contactId"     TEXT NOT NULL REFERENCES propyte_crm.contacts(id) ON DELETE CASCADE,
  "dealId"        TEXT REFERENCES propyte_crm.deals(id) ON DELETE SET NULL,
  "userId"        TEXT NOT NULL REFERENCES propyte_crm.users(id) ON DELETE CASCADE,
  "threadId"      TEXT NOT NULL,
  "messageCount"  INTEGER NOT NULL DEFAULT 1,
  subject         TEXT,
  "lastMessageAt" TIMESTAMP(3) NOT NULL,
  direction       TEXT NOT NULL,            -- INBOUND | OUTBOUND | MIXED
  snippet         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  UNIQUE("userId", "threadId")
);
CREATE INDEX IF NOT EXISTS idx_gmail_threads_contact_id ON propyte_crm.gmail_threads("contactId");

-- 2) Columnas de trazabilidad Google en Activity (tabla "activities").
ALTER TABLE propyte_crm.activities
  ADD COLUMN IF NOT EXISTS "gmailThreadId"  TEXT,
  ADD COLUMN IF NOT EXISTS "gmailMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "googleEventId"  TEXT;

-- Únicos para dedup (un Activity por messageId / por eventId de Calendar).
-- Índices únicos parciales: ignoran NULL para no chocar entre actividades sin Gmail/Calendar.
CREATE UNIQUE INDEX IF NOT EXISTS activities_gmail_message_id_key
  ON propyte_crm.activities("gmailMessageId") WHERE "gmailMessageId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activities_google_event_id_key
  ON propyte_crm.activities("googleEventId") WHERE "googleEventId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_gmail_thread_id ON propyte_crm.activities("gmailThreadId");

-- 3) Enum WorkflowActionType += valores GW Gmail (idempotente).
ALTER TYPE propyte_crm."WorkflowActionType" ADD VALUE IF NOT EXISTS 'GW_GMAIL_LOG_INBOUND';
ALTER TYPE propyte_crm."WorkflowActionType" ADD VALUE IF NOT EXISTS 'GW_GMAIL_LOG_OUTBOUND';
