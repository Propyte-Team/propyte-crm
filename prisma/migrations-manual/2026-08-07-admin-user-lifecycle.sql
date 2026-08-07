-- Ciclo de vida de usuarios: estado a 3 valores + metadatos de suspensión y contraseña.
-- Additiva: no borra ni renombra nada.
--
-- Tipos verificados por introspección contra la base real (2026-08-07), NO
-- inferidos del schema de Prisma:
--   * Identificadores en camelCase entrecomillado ("isActive", "deletedAt") —
--     el modelo User no usa @map en sus columnas.
--   * `users.id` es **text**, no uuid: Prisma mapea `String @id @default(uuid())`
--     a text. Declarar la FK como uuid falla con "incompatible types".
--   * Las fechas son **timestamp(3) without time zone**, que es a lo que Prisma
--     mapea `DateTime?`. Usar timestamptz dejaría el schema en drift y el
--     próximo `prisma db push` querría alterar la columna.
--   * ON UPDATE CASCADE / ON DELETE SET NULL copiado de users_teamLeaderId_fkey,
--     que es lo que Prisma genera para una relación opcional.

CREATE TYPE propyte_crm."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

ALTER TABLE propyte_crm.users
  ADD COLUMN "status"            propyte_crm."UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspendedAt"       timestamp(3),
  ADD COLUMN "suspensionReason"  text,
  ADD COLUMN "statusChangedById" text,
  ADD COLUMN "statusChangedAt"   timestamp(3),
  ADD COLUMN "passwordChangedAt" timestamp(3);

ALTER TABLE propyte_crm.users
  ADD CONSTRAINT "users_statusChangedById_fkey"
  FOREIGN KEY ("statusChangedById") REFERENCES propyte_crm.users("id")
  ON UPDATE CASCADE ON DELETE SET NULL;

-- Backfill: lo que hoy está desactivado es una baja, no una suspensión.
UPDATE propyte_crm.users SET "status" = 'INACTIVE' WHERE "isActive" = false;

CREATE INDEX "users_status_idx" ON propyte_crm.users ("status");
