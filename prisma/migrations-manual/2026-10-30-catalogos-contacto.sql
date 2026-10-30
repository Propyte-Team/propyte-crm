-- #936 + #937 — Catálogos del contacto: etiquetas y «Detalle de la fuente» (campañas y eventos).
--
-- UNA sola parte, y va ANTES de desplegar el código. Solo agrega: dos tablas nuevas, una columna
-- NULLABLE en contacts con su llave foránea e índice, y la siembra del catálogo de etiquetas.
-- Es compatible con el código que hoy está en producción: su cliente de Prisma no conoce las
-- tablas ni la columna.
--
-- Al revés se rompe: el código nuevo lee el catálogo al guardar un contacto con etiquetas y pide
-- `campaignId` en la ficha.
--
-- Decisiones de sistemas@ (30-oct):
--   · La etiqueta «Pendienta Reasignar» (1 contacto) se corrige a «Pendiente Reasignar».
--   · Los valores viejos de «Detalle de la fuente» (Facebook Ads, Instagram Ads, Self-Gen,
--     comentario:<id>…) NO se convierten en campañas: se quedan en leadSourceDetail como dato
--     histórico/técnico. El catálogo de campañas arranca vacío.
--
-- Estado medido el 2026-10-30: 11 etiquetas distintas en los contactos vivos; ninguna campaña.
--
-- `nameKey` se calcula con la MISMA regla que src/lib/catalogos/clave.ts (claveCatalogo):
-- espacios colapsados, sin acentos (á é í ó ú ü ñ, también en mayúscula), en minúsculas.
--
-- Aplicar vía SQL Editor / execute_sql a oaijxdpevakashxshhvm (schema propyte_crm). Va en una
-- transacción y es idempotente: re-ejecutarla no hace nada.
--
-- Rollback (antes de que el código nuevo esté en producción):
--   ALTER TABLE "propyte_crm"."contacts" DROP COLUMN IF EXISTS "campaignId";
--   DROP TABLE IF EXISTS "propyte_crm"."lead_campaigns";
--   DROP TABLE IF EXISTS "propyte_crm"."contact_tags";

BEGIN;

-- ───────────────────────────── contact_tags (#936) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "propyte_crm"."contact_tags" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "nameKey"     TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt"  TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "contact_tags_nameKey_key"
  ON "propyte_crm"."contact_tags" ("nameKey");

-- El typo, antes de sembrar (para que el catálogo nazca con el nombre bueno).
UPDATE "propyte_crm"."contacts"
SET "tags" = array_replace("tags", 'Pendienta Reasignar', 'Pendiente Reasignar')
WHERE 'Pendienta Reasignar' = ANY("tags");

-- Siembra: las etiquetas que ya usan los contactos vivos. Si dos variantes dan la misma clave,
-- entra la más usada (ON CONFLICT descarta las demás; el ORDER BY decide cuál llega primero).
INSERT INTO "propyte_crm"."contact_tags" ("id", "name", "nameKey")
SELECT gen_random_uuid()::text, t.name, t.k
FROM (
  SELECT
    regexp_replace(btrim(tag), '\s+', ' ', 'g') AS name,
    lower(translate(regexp_replace(btrim(tag), '\s+', ' ', 'g'),
                    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS k,
    count(*) AS n
  FROM "propyte_crm"."contacts" c, unnest(c."tags") AS tag
  WHERE c."deletedAt" IS NULL AND btrim(tag) <> ''
  GROUP BY 1, 2
  ORDER BY n DESC, 1
) t
ON CONFLICT ("nameKey") DO NOTHING;

-- ───────────────────────────── lead_campaigns (#937) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "propyte_crm"."lead_campaigns" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "nameKey"     TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt"  TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_campaigns_nameKey_key"
  ON "propyte_crm"."lead_campaigns" ("nameKey");
CREATE INDEX IF NOT EXISTS "lead_campaigns_kind_idx"
  ON "propyte_crm"."lead_campaigns" ("kind");

-- ───────────────────────────── contacts.campaignId (#937) ─────────────────────────────
ALTER TABLE "propyte_crm"."contacts" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_campaignId_fkey'
      AND conrelid = '"propyte_crm"."contacts"'::regclass
  ) THEN
    ALTER TABLE "propyte_crm"."contacts"
      ADD CONSTRAINT "contacts_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "propyte_crm"."lead_campaigns"("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contacts_campaignId_idx"
  ON "propyte_crm"."contacts" ("campaignId");

COMMIT;

-- Igual que las demás tablas de propyte_crm: sin GRANT a anon/authenticated, así que PostgREST
-- no las expone. Se leen y escriben solo desde el servidor del CRM (Prisma, rol de servicio).
--
-- La cronología del contacto registra los cambios sola (trg_contacts_field_changes compara la
-- fila completa): el typo corregido deja un renglón «Etiquetas» en ese contacto, y campaignId
-- entra sin tocar el disparador. La ruta de la cronología traduce el id al nombre de la campaña.

-- Comprobación (11 etiquetas, ninguna con «Pendienta», 0 campañas, columna y llave presentes):
--   SELECT count(*) FROM "propyte_crm"."contact_tags";
--   SELECT count(*) FROM "propyte_crm"."contacts" WHERE 'Pendienta Reasignar' = ANY("tags");
--   SELECT count(*) FROM "propyte_crm"."lead_campaigns";
--   SELECT conname FROM pg_constraint WHERE conname = 'contacts_campaignId_fkey';
