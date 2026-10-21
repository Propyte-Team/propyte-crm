-- #917 — CV de contactos: archivos subidos a la ficha (hoy solo CV; `kind` deja la puerta abierta).
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código. Si se despliega sin ella, la sección «CV» de la ficha dice
-- «falta aplicar la migración» y nada más la lee.
-- Los archivos viven en el bucket privado `crm-attachments` (creado el 2026-10-20), ruta
-- contacts/<contactId>/cv/<uuid>.<ext>. Esta tabla guarda el nombre original y quién lo subió.
-- NO toca propyte_crm.users (el Hub la comparte): la relación vive solo en esta tabla.
--
-- Rollback:
--   DROP TABLE IF EXISTS "propyte_crm"."contact_files";

CREATE TABLE IF NOT EXISTS "propyte_crm"."contact_files" (
  "id"           TEXT PRIMARY KEY,
  "contactId"    TEXT NOT NULL,
  "kind"         TEXT NOT NULL DEFAULT 'CV',
  "fileName"     TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "sizeBytes"    INTEGER NOT NULL,
  "storagePath"  TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"    TIMESTAMP(3),
  "deletedById"  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_files_storagePath_key"
  ON "propyte_crm"."contact_files"("storagePath");
CREATE INDEX IF NOT EXISTS "contact_files_contactId_kind_idx"
  ON "propyte_crm"."contact_files"("contactId", "kind");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."contact_files"
    ADD CONSTRAINT "contact_files_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."contact_files"
    ADD CONSTRAINT "contact_files_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "propyte_crm"."users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS sin políticas + GRANT explícito (mismo patrón que 2026-10-16-fichas-compartidas.sql): sin
-- GRANT a anon/authenticated, PostgREST no la expone. Se lee y escribe solo desde el servidor del CRM.
ALTER TABLE "propyte_crm"."contact_files" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."contact_files" TO postgres;
GRANT SELECT ON "propyte_crm"."contact_files" TO service_role;
