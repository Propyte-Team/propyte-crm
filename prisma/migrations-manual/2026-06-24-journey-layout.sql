-- Migración aditiva — tabla de layout del canvas de journey (Fase 3 C.2-i1).
-- Aplicar vía MCP Supabase en oaijxdpevakashxshhvm SOLO con autorización explícita.
-- Tabla nueva, no toca datos existentes.
CREATE TABLE IF NOT EXISTS propyte_crm."journey_layouts" (
  "id"        text PRIMARY KEY,
  "positions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
