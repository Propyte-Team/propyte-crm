-- Conexiones multicuenta v1 — ADITIVO. ALTER TYPE ADD VALUE fuera de transacción.
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_ADS';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'YOUTUBE';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'PINTEREST';
-- LINKEDIN ya existe en ConnectorProvider.
-- LeadSource: agregar GOOGLE_ADS solo si no existe (LINKEDIN/META_ADS ya existen).
ALTER TYPE "propyte_crm"."LeadSource" ADD VALUE IF NOT EXISTS 'GOOGLE_ADS';
