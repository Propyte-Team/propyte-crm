-- Ciclo de vida de usuarios: estado a 3 valores + metadatos de suspensión y contraseña.
-- Additiva: no borra ni renombra nada. Los identificadores van en camelCase
-- entrecomillado porque el schema de Prisma no usa @map en las columnas de User.

CREATE TYPE propyte_crm."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

ALTER TABLE propyte_crm.users
  ADD COLUMN "status"            propyte_crm."UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspendedAt"       timestamptz,
  ADD COLUMN "suspensionReason"  text,
  ADD COLUMN "statusChangedById" uuid,
  ADD COLUMN "statusChangedAt"   timestamptz,
  ADD COLUMN "passwordChangedAt" timestamptz;

ALTER TABLE propyte_crm.users
  ADD CONSTRAINT "users_statusChangedById_fkey"
  FOREIGN KEY ("statusChangedById") REFERENCES propyte_crm.users("id");

-- Backfill: lo que hoy está desactivado es una baja, no una suspensión.
UPDATE propyte_crm.users SET "status" = 'INACTIVE' WHERE "isActive" = false;

CREATE INDEX "users_status_idx" ON propyte_crm.users ("status");
