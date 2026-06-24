-- Migración aditiva — Lifecycle Stages del contacto (Fase 3 sub-A).
-- Aplicar vía MCP Supabase en oaijxdpevakashxshhvm SOLO con autorización explícita.
-- Paso-1: agrega enum/columna/valores y backfilea. El retiro de LEAD/PROSPECTO/CLIENTE
-- de ContactType es PASO-2 (sesión posterior), NO aquí.

-- 1) Enum nuevo LifecycleStage
DO $$ BEGIN
  CREATE TYPE propyte_crm."LifecycleStage" AS ENUM
    ('SUSCRIPTOR','LEAD','MQL','SQL','OPORTUNIDAD','CLIENTE','EMBAJADOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Columna nullable en contacts (tabla = snake plural; columnas = camelCase; enums = PascalCase)
ALTER TABLE propyte_crm."contacts"
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
UPDATE propyte_crm."contacts" SET "lifecycleStage" = 'CLIENTE'
  WHERE "contactType" = 'CLIENTE' AND "lifecycleStage" IS NULL;

UPDATE propyte_crm."contacts" SET "lifecycleStage" = 'SQL'
  WHERE "contactType" = 'PROSPECTO' AND "lifecycleStage" IS NULL;

UPDATE propyte_crm."contacts" SET "lifecycleStage" = 'LEAD'
  WHERE "contactType" = 'LEAD' AND "lifecycleStage" IS NULL;

-- Inversionistas: CLIENTE si tienen deal ganado, si no LEAD. (CASE → cast explícito al enum.)
UPDATE propyte_crm."contacts" c SET "lifecycleStage" =
  (CASE WHEN EXISTS (
    SELECT 1 FROM propyte_crm."deals" d
    WHERE d."contactId" = c.id AND d."actualCloseDate" IS NOT NULL
  ) THEN 'CLIENTE' ELSE 'LEAD' END)::propyte_crm."LifecycleStage"
  WHERE c."contactType" = 'INVERSIONISTA' AND c."lifecycleStage" IS NULL;

-- Recategorizar: LEAD/PROSPECTO/CLIENTE → COMPRADOR; REFERIDO → REFERIDOR.
UPDATE propyte_crm."contacts" SET "contactType" = 'COMPRADOR'
  WHERE "contactType" IN ('LEAD','PROSPECTO','CLIENTE');
UPDATE propyte_crm."contacts" SET "contactType" = 'REFERIDOR'
  WHERE "contactType" = 'REFERIDO';
-- BROKER_EXTERNO, EMPLEO, INVERSIONISTA se quedan igual; su lifecycle queda NULL salvo INVERSIONISTA.
