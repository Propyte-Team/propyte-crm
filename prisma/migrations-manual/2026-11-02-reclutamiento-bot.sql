-- Bot de reclutamiento F1 (spec docs/superpowers/specs/2026-11-02-bot-reclutamiento-design.md,
-- anexo docs/superpowers/plans/2026-11-02-bot-reclutamiento-f1-integracion-926.md).
-- El bot escribe en la tabla del módulo Reclutamiento (#926): columnas nuevas, todas opcionales.
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código. Si el código se despliega antes, el bot responde sin evaluar
-- (candidato.ts trata P2022 como «sin migrar») y nada más se rompe.
--
-- Rollback:
--   ALTER TABLE "propyte_crm"."recruit_candidates"
--     DROP COLUMN IF EXISTS "contactId", DROP COLUMN IF EXISTS "botCanal",
--     DROP COLUMN IF EXISTS "botResultado", DROP COLUMN IF EXISTS "botPuntaje",
--     DROP COLUMN IF EXISTS "botMotivo", DROP COLUMN IF EXISTS "botRespuestas",
--     DROP COLUMN IF EXISTS "botFiltros", DROP COLUMN IF EXISTS "botDesglose",
--     DROP COLUMN IF EXISTS "botResumen", DROP COLUMN IF EXISTS "botEvaluadoAt",
--     DROP COLUMN IF EXISTS "horarioEntrevista";
--   Los dos UPDATE del final no tienen rollback automático: la identidad anterior del agente está en
--   2026-07-14-bot-agentes.sql y enabledChannels vuelve a '["WHATSAPP"]' desde Ajustes → Bot.

ALTER TABLE "propyte_crm"."recruit_candidates"
  ADD COLUMN IF NOT EXISTS "contactId"         TEXT,
  ADD COLUMN IF NOT EXISTS "botCanal"          TEXT,
  ADD COLUMN IF NOT EXISTS "botResultado"      TEXT,
  ADD COLUMN IF NOT EXISTS "botPuntaje"        INTEGER,
  ADD COLUMN IF NOT EXISTS "botMotivo"         TEXT,
  ADD COLUMN IF NOT EXISTS "botRespuestas"     JSONB,
  ADD COLUMN IF NOT EXISTS "botFiltros"        JSONB,
  ADD COLUMN IF NOT EXISTS "botDesglose"       JSONB,
  ADD COLUMN IF NOT EXISTS "botResumen"        TEXT,
  ADD COLUMN IF NOT EXISTS "botEvaluadoAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "horarioEntrevista" TEXT;

-- Un contacto del CRM, un candidato (los NULL no chocan entre sí).
CREATE UNIQUE INDEX IF NOT EXISTS "recruit_candidates_contactId_key"
  ON "propyte_crm"."recruit_candidates"("contactId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."recruit_candidates"
    ADD CONSTRAINT "recruit_candidates_botResultado_check"
    CHECK ("botResultado" IS NULL OR "botResultado" IN ('APTO', 'REVISAR', 'NO_APTO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Identidad del agente (spec §4). El playbook se siembra aparte con
-- scripts/seed-bot-playbooks-segmento.ts después del deploy.
UPDATE "propyte_crm"."bot_agent_profiles"
   SET "identity" = 'Atiendes a personas que quieren unirse al equipo de asesores inmobiliarios de Propyte en Playa del Carmen o Mérida. Tu misión: conocer al candidato con preguntas naturales, una o dos por mensaje, sin sonar a formulario. Eres honesto sobre el esquema: 100 % comisión, sin sueldo base, con capacitación y acompañamiento del equipo. Si pregunta por sueldo, comisiones, horario o la empresa, contesta breve con la ficha de la vacante y retoma la pregunta pendiente. No prometas contratación ni fechas. Cuando se te indique el resultado, cierra con calidez y sin listar criterios.',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "name" = 'Agente Reclutamiento'
   AND "identity" NOT LIKE 'Atiendes a personas que quieren unirse al equipo de asesores%';

-- Canales del bot (spec §9): WhatsApp ya estaba; entran Instagram y Messenger.
UPDATE "propyte_crm"."bot_config"
   SET "enabledChannels" = '["WHATSAPP","INSTAGRAM","MESSENGER"]'::jsonb
 WHERE "singleton" = true
   AND NOT ("enabledChannels" @> '["INSTAGRAM","MESSENGER"]'::jsonb);
