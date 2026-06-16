-- Cutover readiness — preparar el CRM para recibir datos Zoho (consolidado §3.6)
-- 100% ADITIVO: 6 valores nuevos de enum + 1 columna nullable + índice único. Cero DROP, cero cambio destructivo.
-- Aplicar en Supabase (oaijxdpevakashxshhvm) tras autorización explícita de Luis.

-- 1) LeadSource: valores presentes en reports.zoho_contactos sin destino previo.
--    Nota: ADD VALUE anexa al final del enum en Postgres; el orden de etiquetas en BD es cosmético
--    (el cliente Prisma usa el orden de schema.prisma). Lo importante es que las etiquetas existan.
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'META_ADS';
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'BASE_DE_DATOS';
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'SELF_GEN';
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'REGISTRO_BROKER';
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'WEBINAR';
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'LINKEDIN';

-- 2) Deal.zohoId: trazabilidad/idempotencia de la migración por ID de Zoho (igual que Contact.zohoId).
ALTER TABLE propyte_crm.deals ADD COLUMN IF NOT EXISTS "zohoId" text;
CREATE UNIQUE INDEX IF NOT EXISTS "deals_zohoId_key" ON propyte_crm.deals ("zohoId");
