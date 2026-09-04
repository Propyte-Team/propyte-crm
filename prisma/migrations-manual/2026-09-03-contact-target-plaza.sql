-- Plaza objetivo del contacto, para el reparto por plaza.
-- Se deriva de la campaña/conector (ver src/lib/intake/campaign-plaza.ts):
--   Nativa/Tulum -> TULUM · Yaxnah/Mérida -> MERIDA · resto -> PDC.
-- Nullable: un lead sin señal se queda sin plaza y cae al Pond en vez de forzarse.
ALTER TABLE "propyte_crm"."contacts"
  ADD COLUMN IF NOT EXISTS "targetPlaza" "propyte_crm"."Plaza";

-- Índice para el reparto/ruteo por plaza (solo contactos vivos).
CREATE INDEX IF NOT EXISTS "contacts_targetPlaza_idx"
  ON "propyte_crm"."contacts" ("targetPlaza")
  WHERE "deletedAt" IS NULL;
