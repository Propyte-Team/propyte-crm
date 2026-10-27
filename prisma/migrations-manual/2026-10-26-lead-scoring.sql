-- Lead scoring en modo sombra (spec docs/superpowers/specs/2026-10-26-lead-scoring-design.md).
--
-- Solo AGREGA: una tabla nueva y un índice. No toca columnas de contacts ni de activities.
-- Compatible con el código de antes y el de después; correr ANTES del merge. Idempotente.
--
-- Mientras no se corra, el código desplegado sigue funcionando: la etapa `leadScoring` del cron
-- falla con guarda (se ve en el log) y la ficha del contacto simplemente no muestra el desglose.
--
-- Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm).
-- El índice va en una sentencia aparte con CONCURRENTLY para no bloquear escrituras en
-- activities; CONCURRENTLY no puede ir dentro de una transacción.

CREATE TABLE IF NOT EXISTS "propyte_crm"."contact_scores" (
  "contactId"     TEXT        PRIMARY KEY,
  "score"         INTEGER,
  "desglose"      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "motivo"        TEXT,
  "modeloVersion" INTEGER     NOT NULL,
  "calculadoAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "contact_scores_calculadoAt_idx"
  ON "propyte_crm"."contact_scores" ("calculadoAt");

-- Sin GRANT a anon/authenticated: la tabla solo la lee y escribe el CRM con su rol de servidor.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_contactId_createdAt_idx"
  ON "propyte_crm"."activities" ("contactId", "createdAt");
