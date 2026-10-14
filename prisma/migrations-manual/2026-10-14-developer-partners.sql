-- #872 — Módulo «Desarrolladores» (empresas inmobiliarias y otros aliados).
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código. Si se despliega sin ella, /desarrolladores muestra la tabla
-- vacía (la API traduce P2021 a lista vacía) y dar de alta responde un error claro; ninguna
-- otra pantalla lee esta tabla.
--
-- Rollback:
--   DROP TABLE IF EXISTS "propyte_crm"."developer_partners";

CREATE TABLE IF NOT EXISTS "propyte_crm"."developer_partners" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "website"     TEXT,
  "email"       TEXT,
  "phone"       TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"   TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "developer_partners_name_idx"
  ON "propyte_crm"."developer_partners"("name");

-- Igual que las demás tablas de propyte_crm: sin GRANT a anon/authenticated, así que PostgREST
-- no la expone. Se lee y escribe solo desde el servidor del CRM (Prisma, rol de servicio).
