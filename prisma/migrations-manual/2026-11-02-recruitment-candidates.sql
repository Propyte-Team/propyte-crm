-- Bot de reclutamiento F1 (spec docs/superpowers/specs/2026-11-02-bot-reclutamiento-design.md).
-- Solo AGREGA. Idempotente. Correr ANTES del merge, vía execute_sql al proyecto del CRM
-- (schema propyte_crm). Mientras no se corra, el hook de reclutamiento falla con guarda
-- (console.error) y el bot sigue contestando con el playbook.

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."RecruitmentStage" AS ENUM
    ('NUEVO','PERFILANDO','CV_PENDIENTE','APTO','REVISAR','NO_APTO','ENTREVISTA','CONTRATADO','DESCARTADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."RecruitmentVerdict" AS ENUM ('APTO','REVISAR','NO_APTO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."recruitment_candidates" (
  "id"                TEXT PRIMARY KEY,
  "contactId"         TEXT NOT NULL UNIQUE,
  "etapa"             "propyte_crm"."RecruitmentStage" NOT NULL DEFAULT 'NUEVO',
  "plaza"             "propyte_crm"."Plaza",
  "canal"             "propyte_crm"."ConversationChannel" NOT NULL,
  "respuestas"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "filtros"           JSONB NOT NULL DEFAULT '{}'::jsonb,
  "puntaje"           INTEGER,
  "desglose"          JSONB,
  "resultado"         "propyte_crm"."RecruitmentVerdict",
  "motivo"            TEXT,
  "cvUrl"             TEXT,
  "cvMime"            TEXT,
  "cvFilename"        TEXT,
  "cvMessageId"       TEXT,
  "horarioEntrevista" TEXT,
  "entrevistaAt"      TIMESTAMP(3),
  "responsableId"     TEXT,
  "resumenIA"         TEXT,
  "evaluadoAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "recruitment_candidates_etapa_idx"
  ON "propyte_crm"."recruitment_candidates" ("etapa");
CREATE INDEX IF NOT EXISTS "recruitment_candidates_plaza_etapa_idx"
  ON "propyte_crm"."recruitment_candidates" ("plaza", "etapa");

-- Identidad del Agente Reclutamiento alineada al guion nuevo (spec §4).
UPDATE "propyte_crm"."bot_agent_profiles"
   SET "identity" = 'Atiendes a personas que quieren unirse al equipo de asesores inmobiliarios de Propyte en Playa del Carmen o Mérida. Tu misión: conocer al candidato con preguntas naturales, una o dos por mensaje, sin sonar a formulario. Eres honesto sobre el esquema: 100 % comisión, sin sueldo base, con capacitación y acompañamiento del equipo. Si pregunta por sueldo, comisiones, horario o la empresa, contesta breve con la ficha de la vacante y retoma la pregunta pendiente. No prometas contratación ni fechas. Cuando se te indique el resultado, cierra con calidez y sin listar criterios.',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "name" = 'Agente Reclutamiento';

-- Canales del bot (spec §9): WhatsApp ya estaba; entran Instagram y Messenger.
UPDATE "propyte_crm"."bot_config"
   SET "enabledChannels" = '["WHATSAPP","INSTAGRAM","MESSENGER"]'::jsonb;
