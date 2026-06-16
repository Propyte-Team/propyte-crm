-- Shortlist "Propuesta express" v1 — additivo, idempotente. NO toca tablas existentes.
-- Aplicar SOLO con OK explícito de Luis ("aplica la migración shortlist").

DO $$ BEGIN
  CREATE TYPE propyte_crm."ShortlistStatus" AS ENUM ('DRAFT', 'SENT', 'OPENED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS propyte_crm.shortlists (
  id           text PRIMARY KEY,
  token        text NOT NULL UNIQUE,
  "contactId"  text NOT NULL REFERENCES propyte_crm.contacts(id),
  "dealId"     text REFERENCES propyte_crm.deals(id),
  "createdById" text NOT NULL REFERENCES propyte_crm.users(id),
  title        text NOT NULL DEFAULT 'Propuesta de unidades',
  status       propyte_crm."ShortlistStatus" NOT NULL DEFAULT 'DRAFT',
  "sentAt"     timestamp(3),
  "openedAt"   timestamp(3),
  "expiresAt"  timestamp(3),
  "createdAt"  timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"  timestamp(3) NOT NULL DEFAULT now(),
  "deletedAt"  timestamp(3)
);
CREATE INDEX IF NOT EXISTS "shortlists_contactId_idx" ON propyte_crm.shortlists("contactId");
CREATE INDEX IF NOT EXISTS "shortlists_dealId_idx" ON propyte_crm.shortlists("dealId");

CREATE TABLE IF NOT EXISTS propyte_crm.shortlist_items (
  id            text PRIMARY KEY,
  "shortlistId" text NOT NULL REFERENCES propyte_crm.shortlists(id) ON DELETE CASCADE,
  "hubUnitId"   text NOT NULL,
  snapshot      jsonb NOT NULL DEFAULT '{}',
  note          text,
  "sortOrder"   integer NOT NULL DEFAULT 0,
  "createdAt"   timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "shortlist_items_shortlistId_idx" ON propyte_crm.shortlist_items("shortlistId");

CREATE TABLE IF NOT EXISTS propyte_crm.shortlist_views (
  id            text PRIMARY KEY,
  "shortlistId" text NOT NULL REFERENCES propyte_crm.shortlists(id) ON DELETE CASCADE,
  "viewedAt"    timestamp(3) NOT NULL DEFAULT now(),
  "userAgent"   text
);
CREATE INDEX IF NOT EXISTS "shortlist_views_shortlistId_idx" ON propyte_crm.shortlist_views("shortlistId");
