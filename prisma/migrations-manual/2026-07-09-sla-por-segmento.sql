-- SLA por segmento (Fase 3 sub-D). Aditivo: 2 columnas con default. Reversible.
-- Aplicar en Supabase SQL Editor (oaijxdpevakashxshhvm) — un solo envío.
ALTER TABLE "propyte_crm"."sla_policies"
  ADD COLUMN IF NOT EXISTS "conditions" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100;
