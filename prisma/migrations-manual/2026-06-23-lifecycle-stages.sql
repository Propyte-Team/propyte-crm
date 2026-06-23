-- Migración aditiva — Lifecycle Stages del contacto (Fase 3 sub-A).
-- Aplicar vía MCP Supabase en oaijxdpevakashxshhvm SOLO con autorización explícita.
-- Paso-1: agrega enum/columna/valores y backfilea. El retiro de LEAD/PROSPECTO/CLIENTE
-- de ContactType es PASO-2 (sesión posterior), NO aquí.

-- 1) Enum nuevo LifecycleStage
DO $$ BEGIN
  CREATE TYPE propyte_crm."LifecycleStage" AS ENUM
    ('SUSCRIPTOR','LEAD','MQL','SQL','OPORTUNIDAD','CLIENTE','EMBAJADOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Columna nullable en Contact
ALTER TABLE propyte_crm."Contact"
  ADD COLUMN IF NOT EXISTS "lifecycleStage" propyte_crm."LifecycleStage";

-- 3) Nuevos valores de ContactType (cada ADD VALUE en su propio statement; idempotente)
ALTER TYPE propyte_crm."ContactType" ADD VALUE IF NOT EXISTS 'COMPRADOR';
ALTER TYPE propyte_crm."ContactType" ADD VALUE IF NOT EXISTS 'REFERIDOR';

-- 4) Trigger/Action enums
ALTER TYPE propyte_crm."TriggerType" ADD VALUE IF NOT EXISTS 'LIFECYCLE_CHANGE';
ALTER TYPE propyte_crm."WorkflowActionType" ADD VALUE IF NOT EXISTS 'SET_LIFECYCLE';

-- ===== APLICAR EN SEGUNDA EJECUCIÓN (tras commitear los ADD VALUE) =====
-- Backfill idempotente: solo toca filas aún en el esquema viejo.

-- Compradores con deal ganado → CLIENTE; el resto según su contactType viejo.
UPDATE propyte_crm."Contact" c SET "lifecycleStage" = 'CLIENTE'
  WHERE c."contactType" IN ('CLIENTE')
    AND c."lifecycleStage" IS NULL;

UPDATE propyte_crm."Contact" c SET "lifecycleStage" = 'SQL'
  WHERE c."contactType" = 'PROSPECTO' AND c."lifecycleStage" IS NULL;

UPDATE propyte_crm."Contact" c SET "lifecycleStage" = 'LEAD'
  WHERE c."contactType" = 'LEAD' AND c."lifecycleStage" IS NULL;

-- Inversionistas: CLIENTE si tienen deal ganado, si no LEAD.
UPDATE propyte_crm."Contact" c SET "lifecycleStage" =
  CASE WHEN EXISTS (
    SELECT 1 FROM propyte_crm."Deal" d
    WHERE d."contactId" = c.id AND d."actualCloseDate" IS NOT NULL
  ) THEN 'CLIENTE' ELSE 'LEAD' END
  WHERE c."contactType" = 'INVERSIONISTA' AND c."lifecycleStage" IS NULL;

-- Recategorizar: LEAD/PROSPECTO/CLIENTE → COMPRADOR; REFERIDO → REFERIDOR.
UPDATE propyte_crm."Contact" SET "contactType" = 'COMPRADOR'
  WHERE "contactType" IN ('LEAD','PROSPECTO','CLIENTE');
UPDATE propyte_crm."Contact" SET "contactType" = 'REFERIDOR'
  WHERE "contactType" = 'REFERIDO';
-- BROKER_EXTERNO, EMPLEO, INVERSIONISTA se quedan igual; su lifecycle queda NULL salvo INVERSIONISTA.
