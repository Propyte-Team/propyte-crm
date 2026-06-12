-- Migración ADITIVA — Vistas guardadas (Fase 5, T5.4). Solo crea tabla nueva.
-- RLS habilitado de entrada (consistente con la política de seguridad; el CRM accede
-- por rol postgres/service_role que saltan RLS).

CREATE TABLE IF NOT EXISTS "propyte_crm"."saved_views" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "module"    TEXT NOT NULL,
    "ownerId"   TEXT NOT NULL,
    "filters"   JSONB NOT NULL DEFAULT '{}',
    "scope"     TEXT NOT NULL DEFAULT 'personal',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "saved_views_module_ownerId_idx"
    ON "propyte_crm"."saved_views" ("module", "ownerId");

ALTER TABLE "propyte_crm"."saved_views" ENABLE ROW LEVEL SECURITY;
