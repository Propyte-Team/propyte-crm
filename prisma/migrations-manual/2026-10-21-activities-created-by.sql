-- #915 — Tareas asignables: activities."createdById" guarda quién asignó la tarea cuando no es
-- su dueño (un TEAM_LEADER, GERENTE, DIRECTOR o ADMIN que le deja una tarea a un asesor).
-- `userId` sigue siendo el dueño = el asignado, que es de quien aparece en la Agenda.
--
-- Aditivo e idempotente. NO toca propyte_crm.users (la comparte el Hub): solo agrega una FK
-- que apunta a ella, igual que activities_completedById_fkey y activities_archivedById_fkey.
-- Sin backfill: las filas viejas quedan en NULL, que el código lee como «la creó su dueño».
--
-- Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm) ANTES de desplegar el
-- código. Es compatible con el código que hoy está en producción: ese código no nombra la
-- columna, y una columna nullable sin default no cambia ningún INSERT ni SELECT suyo.
--
-- Rollback (solo con el código viejo de vuelta; se pierde quién asignó cada tarea):
--   ALTER TABLE propyte_crm.activities DROP CONSTRAINT IF EXISTS "activities_createdById_fkey";
--   ALTER TABLE propyte_crm.activities DROP COLUMN IF EXISTS "createdById";

ALTER TABLE propyte_crm.activities ADD COLUMN IF NOT EXISTS "createdById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_createdById_fkey'
      AND conrelid = 'propyte_crm.activities'::regclass
  ) THEN
    ALTER TABLE propyte_crm.activities
      ADD CONSTRAINT "activities_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES propyte_crm.users(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- «Tareas que asignaste» en la Agenda lee por creador.
CREATE INDEX IF NOT EXISTS activities_created_by_idx
  ON propyte_crm.activities ("createdById")
  WHERE "createdById" IS NOT NULL;
