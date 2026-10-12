-- Visibilidad por marca (entrega 2 de 3): qué marcas ve cada usuario.
-- Spec: docs/superpowers/specs/2026-10-12-marcas-visibilidad-design.md
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código. Sin la tabla el código no se cae (trata a todos como "sin filas"
-- = solo la predeterminada), pero un admin no podría prenderle Yaxnáh ni Avica a nadie: el
-- guardado de los interruptores respondería 503.
--
-- No toca propyte_crm.users: el Hub comparte esa tabla (.claude/AI_TASKS.md). La FK hacia users
-- vive en ESTA tabla, igual que brands."marketingOwnerUserId".
--
-- No se rellena nada a propósito: un usuario SIN filas ve solo la marca predeterminada (Propyte),
-- que es exactamente la decisión 3 para los usuarios existentes. ADMIN ve todas sin filas.
--
-- Rollback:
--   DROP TABLE IF EXISTS "propyte_crm"."user_brand_access";

CREATE TABLE IF NOT EXISTS "propyte_crm"."user_brand_access" (
  "userId"    TEXT NOT NULL,
  "brandId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_brand_access_pkey" PRIMARY KEY ("userId", "brandId")
);

CREATE INDEX IF NOT EXISTS "user_brand_access_brandId_idx"
  ON "propyte_crm"."user_brand_access"("brandId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."user_brand_access"
    ADD CONSTRAINT "user_brand_access_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "propyte_crm"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."user_brand_access"
    ADD CONSTRAINT "user_brand_access_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "propyte_crm"."brands"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS sin políticas + GRANT explícito (mismo patrón que 2026-10-09-brands.sql).
ALTER TABLE "propyte_crm"."user_brand_access" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."user_brand_access" TO postgres;
GRANT SELECT ON "propyte_crm"."user_brand_access" TO service_role;
