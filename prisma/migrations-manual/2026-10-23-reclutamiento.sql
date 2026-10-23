-- #926 — Reclutamiento (Desempeño): candidatos en proceso de contratación y sus CV.
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código. Si se despliega sin ella, /reclutamiento muestra la tabla vacía
-- con el aviso «falta aplicar la migración» y nada más.
-- Los CV viven en el bucket privado `crm-attachments` (el mismo de la #917), ruta
-- candidates/<candidateId>/cv/<uuid>.<ext>. El nombre original solo vive en esta tabla.
-- NO toca propyte_crm.users (el Hub la comparte): createdById/uploadedById son texto sin FK,
-- igual que developer_partners.createdById.
--
-- Camino para los CV que lleguen por los chats (futuro, no se conecta aquí):
--   recruit_candidates.source / sourceRef      → 'CHAT' + id de la conversación que lo originó.
--   recruit_candidate_files.source / sourceRef → 'CHAT' + id del mensaje con el adjunto.
--   El índice único parcial sobre sourceRef hace idempotente la ingesta automática: el mismo
--   mensaje no puede registrar dos veces el mismo CV.
--
-- Rollback:
--   DROP TABLE IF EXISTS "propyte_crm"."recruit_candidate_files";
--   DROP TABLE IF EXISTS "propyte_crm"."recruit_candidates";

CREATE TABLE IF NOT EXISTS "propyte_crm"."recruit_candidates" (
  "id"             TEXT PRIMARY KEY,
  "fullName"       TEXT NOT NULL,
  "age"            INTEGER,
  "email"          TEXT,
  "phone"          TEXT,
  "area"           TEXT,
  "plaza"          "propyte_crm"."Plaza",
  "portfolioUrl"   TEXT,
  "notes"          TEXT,
  "stage"          TEXT NOT NULL DEFAULT 'RECIBIDO',
  "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source"         TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceRef"      TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3),
  "deletedById"    TEXT,
  CONSTRAINT "recruit_candidates_age_check" CHECK ("age" IS NULL OR ("age" BETWEEN 14 AND 99))
);

CREATE INDEX IF NOT EXISTS "recruit_candidates_stage_idx"
  ON "propyte_crm"."recruit_candidates"("stage");
CREATE INDEX IF NOT EXISTS "recruit_candidates_createdAt_idx"
  ON "propyte_crm"."recruit_candidates"("createdAt");

CREATE TABLE IF NOT EXISTS "propyte_crm"."recruit_candidate_files" (
  "id"           TEXT PRIMARY KEY,
  "candidateId"  TEXT NOT NULL,
  "kind"         TEXT NOT NULL DEFAULT 'CV',
  "fileName"     TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "sizeBytes"    INTEGER NOT NULL,
  "storagePath"  TEXT NOT NULL,
  "source"       TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceRef"    TEXT,
  "uploadedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"    TIMESTAMP(3),
  "deletedById"  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "recruit_candidate_files_storagePath_key"
  ON "propyte_crm"."recruit_candidate_files"("storagePath");
CREATE INDEX IF NOT EXISTS "recruit_candidate_files_candidateId_kind_idx"
  ON "propyte_crm"."recruit_candidate_files"("candidateId", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "recruit_candidate_files_source_sourceRef_key"
  ON "propyte_crm"."recruit_candidate_files"("source", "sourceRef")
  WHERE "sourceRef" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."recruit_candidate_files"
    ADD CONSTRAINT "recruit_candidate_files_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "propyte_crm"."recruit_candidates"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS sin políticas + GRANT explícito (mismo patrón que 2026-10-21-contact-files.sql): sin GRANT a
-- anon/authenticated, PostgREST no las expone. Datos personales (LFPDPPP): solo el servidor del CRM.
ALTER TABLE "propyte_crm"."recruit_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."recruit_candidate_files" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."recruit_candidates" TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."recruit_candidate_files" TO postgres;
GRANT SELECT ON "propyte_crm"."recruit_candidates" TO service_role;
GRANT SELECT ON "propyte_crm"."recruit_candidate_files" TO service_role;
