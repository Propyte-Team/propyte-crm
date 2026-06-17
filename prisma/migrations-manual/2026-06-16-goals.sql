-- Metas/Scorecard (§5.14) — additivo, idempotente. NO toca tablas existentes.
-- Aplicar SOLO con OK explícito ("aplica la migración goals").

DO $$ BEGIN
  CREATE TYPE propyte_crm."GoalScope" AS ENUM ('USER', 'TEAM', 'COMPANY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE propyte_crm."GoalMetric" AS ENUM (
    'CAPTACIONES','NEGOCIOS_CREADOS','COTIZACIONES_ENVIADAS',
    'ACTIVIDADES_COMPLETADAS','NEGOCIOS_GANADOS','MONTO_VENTA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS propyte_crm.goals (
  id           text PRIMARY KEY,
  scope        propyte_crm."GoalScope" NOT NULL,
  "userId"     text REFERENCES propyte_crm.users(id),
  "teamId"     text REFERENCES propyte_crm.teams(id),
  period       timestamp(3) NOT NULL,
  metric       propyte_crm."GoalMetric" NOT NULL,
  target       numeric(14,2) NOT NULL,
  currency     propyte_crm."Currency",
  "createdById" text NOT NULL REFERENCES propyte_crm.users(id),
  "createdAt"  timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"  timestamp(3) NOT NULL DEFAULT now(),
  "deletedAt"  timestamp(3)
);
CREATE INDEX IF NOT EXISTS "goals_period_idx" ON propyte_crm.goals(period);
CREATE INDEX IF NOT EXISTS "goals_userId_idx" ON propyte_crm.goals("userId");
CREATE INDEX IF NOT EXISTS "goals_teamId_idx" ON propyte_crm.goals("teamId");
