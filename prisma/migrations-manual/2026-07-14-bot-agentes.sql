-- Frente 4: agentes del bot por tipo de conversación (aditiva e idempotente)
-- Autorizada por Luis 2026-07-14 ("Aplica la migración de agentes del bot a la Supabase de prod")
-- Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)

CREATE TABLE IF NOT EXISTS "propyte_crm"."bot_agent_profiles" (
  "id"           TEXT PRIMARY KEY,
  "name"         TEXT NOT NULL,
  "contactTypes" "propyte_crm"."ContactType"[] NOT NULL DEFAULT ARRAY[]::"propyte_crm"."ContactType"[],
  "identity"     TEXT NOT NULL,
  "playbookId"   TEXT,
  "tonePreset"   "propyte_crm"."BotTonePreset",
  "isActive"     BOOLEAN NOT NULL DEFAULT false,
  "priority"     INTEGER NOT NULL DEFAULT 100,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"    TIMESTAMP(3)
);

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."bot_agent_profiles"
    ADD CONSTRAINT "bot_agent_profiles_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "propyte_crm"."bot_playbooks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "bot_agent_profiles_isActive_deletedAt_idx"
  ON "propyte_crm"."bot_agent_profiles"("isActive", "deletedAt");

ALTER TABLE "propyte_crm"."bot_config"
  ADD COLUMN IF NOT EXISTS "classifyContacts" BOOLEAN NOT NULL DEFAULT true;

-- Seeds: 3 perfiles INACTIVOS (Luis los activa desde la UI)
INSERT INTO "propyte_crm"."bot_agent_profiles" ("id","name","contactTypes","identity","priority")
SELECT gen_random_uuid()::text, 'Agente Clientes',
  ARRAY['LEAD','PROSPECTO','COMPRADOR','CLIENTE','INVERSIONISTA']::"propyte_crm"."ContactType"[],
  'Atiendes a clientes compradores e inversionistas. Tu misión: entender qué buscan (tipo de propiedad, zona, presupuesto, plazo de compra), resolver sus dudas solo con datos del catálogo y avanzar hacia agendar una llamada o visita con un asesor.',
  10
WHERE NOT EXISTS (SELECT 1 FROM "propyte_crm"."bot_agent_profiles" WHERE "name" = 'Agente Clientes');

INSERT INTO "propyte_crm"."bot_agent_profiles" ("id","name","contactTypes","identity","priority")
SELECT gen_random_uuid()::text, 'Agente Brokers',
  ARRAY['BROKER_EXTERNO','REFERIDOR']::"propyte_crm"."ContactType"[],
  'Atiendes a brokers externos y aliados comerciales. Tu misión: identificar su inmobiliaria, qué traen (cliente o propiedad) y qué esquema de colaboración buscan (comisión compartida). Recaba nombre, empresa y teléfono/correo, y canaliza a alianzas con un asesor senior.',
  20
WHERE NOT EXISTS (SELECT 1 FROM "propyte_crm"."bot_agent_profiles" WHERE "name" = 'Agente Brokers');

INSERT INTO "propyte_crm"."bot_agent_profiles" ("id","name","contactTypes","identity","priority")
SELECT gen_random_uuid()::text, 'Agente Reclutamiento',
  ARRAY['EMPLEO']::"propyte_crm"."ContactType"[],
  'Atiendes a personas que buscan trabajo o quieren unirse al equipo. Tu misión: recabar nombre completo, puesto de interés y experiencia en bienes raíces. Explica que el equipo de reclutamiento revisará su perfil; no prometas vacantes ni sueldos.',
  30
WHERE NOT EXISTS (SELECT 1 FROM "propyte_crm"."bot_agent_profiles" WHERE "name" = 'Agente Reclutamiento');
