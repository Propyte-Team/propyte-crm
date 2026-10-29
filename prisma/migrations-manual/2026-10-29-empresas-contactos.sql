-- #949 — «Desarrolladores» pasa a «Empresas»: tipo de empresa y empresa del contacto.
--
-- UNA sola parte, y va ANTES de desplegar el código (lección de la #907 y la #914). Solo agrega
-- cosas: dos columnas NULLABLE, una llave foránea y dos índices, más el tipo de las empresas que
-- ya existen. Es compatible con el código que hoy está en producción: su cliente de Prisma no
-- conoce las columnas (no las selecciona ni las escribe).
--
-- Al revés se rompe: el código nuevo pide `type` en cada consulta de empresas y
-- `developerPartnerId` en la ficha del contacto.
--
-- Estado medido el 2026-10-29: 1 empresa viva (Ekasa), sin tipo. 776 contactos vivos; ninguno
-- ligado a una empresa. `contacts.company` (texto libre de Zoho, #914) NO se toca: convertirlo
-- en empresas quedó pendiente por decisión de sistemas@.
--
-- `type` es TEXT y no un enum de Postgres: habrá más tipos y un valor de enum no se puede quitar
-- sin recrear el tipo (ver #907). La lista válida vive en src/lib/developer-partners/shared.ts.
--
-- Aplicar vía SQL Editor / execute_sql a oaijxdpevakashxshhvm (schema propyte_crm). Va en una
-- transacción y es idempotente: re-ejecutarla no hace nada.

BEGIN;

-- ───────────────────────────── developer_partners.type ─────────────────────────────
ALTER TABLE "propyte_crm"."developer_partners" ADD COLUMN IF NOT EXISTS "type" TEXT;

-- Las que ya existen se dieron de alta en el módulo «Desarrolladores»: son desarrolladoras.
UPDATE "propyte_crm"."developer_partners" SET "type" = 'DESARROLLADORA' WHERE "type" IS NULL;

CREATE INDEX IF NOT EXISTS "developer_partners_type_idx"
  ON "propyte_crm"."developer_partners" ("type");

-- ───────────────────────────── contacts.developerPartnerId ─────────────────────────────
-- developer_partners.id es text, así que la columna también.
ALTER TABLE "propyte_crm"."contacts" ADD COLUMN IF NOT EXISTS "developerPartnerId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_developerPartnerId_fkey'
      AND conrelid = '"propyte_crm"."contacts"'::regclass
  ) THEN
    ALTER TABLE "propyte_crm"."contacts"
      ADD CONSTRAINT "contacts_developerPartnerId_fkey"
      FOREIGN KEY ("developerPartnerId") REFERENCES "propyte_crm"."developer_partners"("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contacts_developerPartnerId_idx"
  ON "propyte_crm"."contacts" ("developerPartnerId");

COMMIT;

-- La cronología del contacto registra el cambio sola: el disparador trg_contacts_field_changes
-- compara la fila completa (to_jsonb), así que la columna nueva entra sin tocarlo. La ruta de la
-- cronología traduce el id al nombre de la empresa.

-- Comprobación (debe dar «DESARROLLADORA | 1», 2 columnas y la llave):
--   SELECT "type", count(*) FROM "propyte_crm"."developer_partners" WHERE "deletedAt" IS NULL GROUP BY 1;
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema = 'propyte_crm'
--      AND ((table_name = 'developer_partners' AND column_name = 'type')
--        OR (table_name = 'contacts' AND column_name = 'developerPartnerId'));
--   SELECT conname FROM pg_constraint WHERE conname = 'contacts_developerPartnerId_fkey';

-- Reversa (solo con el código viejo de vuelta):
--   ALTER TABLE "propyte_crm"."contacts" DROP CONSTRAINT IF EXISTS "contacts_developerPartnerId_fkey";
--   DROP INDEX IF EXISTS "propyte_crm"."contacts_developerPartnerId_idx";
--   ALTER TABLE "propyte_crm"."contacts" DROP COLUMN IF EXISTS "developerPartnerId";
--   DROP INDEX IF EXISTS "propyte_crm"."developer_partners_type_idx";
--   ALTER TABLE "propyte_crm"."developer_partners" DROP COLUMN IF EXISTS "type";
