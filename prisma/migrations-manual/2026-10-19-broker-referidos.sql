-- #907 — Referidos del broker + tipos de contacto Broker / Proveedor / Otro (sin Referidor).
--
-- Dos partes, en dos momentos distintos:
--
--   PARTE A — ANTES de desplegar el código. Solo agrega cosas: dos valores al enum y una
--             columna nullable con su índice. Es compatible con el código que hoy está en
--             producción: su cliente de Prisma no conoce la columna (no la selecciona ni la
--             escribe) y nunca recibe PROVEEDOR/OTRO porque nadie los puede elegir todavía.
--
--   PARTE B — DESPUÉS de desplegar el código. Retira REFERIDOR de los datos vivos: convierte
--             a Broker los contactos que lo tengan y apaga el «Agente Referidos» del bot. Va
--             después porque el código viejo todavía clasifica REFERIDOR; si el agente se
--             apagara antes, quien quisiera referir a alguien caería en el guion genérico
--             durante el hueco entre la migración y el despliegue.
--
-- Estado medido el 2026-10-19: enum ContactType = {LEAD, PROSPECTO, CLIENTE, INVERSIONISTA,
-- BROKER_EXTERNO, REFERIDO, EMPLEO, COMPRADOR, REFERIDOR}. Contactos con REFERIDOR: 0.
-- «Agente Referidos» (3c7b1ee2-…) activo, contactTypes {REFERIDOR}. «Agente Brokers»
-- (45cc8b0b-…) activo, contactTypes {BROKER_EXTERNO}; su playbook ya cubre referidores.
-- contacts.id es text, así que la columna nueva también.
--
-- REFERIDOR NO se quita del enum: Postgres no permite borrar un valor sin recrear el tipo
-- (y con él contacts."contactType" y bot_agent_profiles."contactTypes"), y la cronología
-- tiene 5 cambios viejos que lo mencionan. El código deja de ofrecerlo y de aceptarlo.
--
-- Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm). Ambas partes son
-- idempotentes: re-ejecutarlas no hace nada.

-- ───────────────────────────── PARTE A (antes del deploy) ─────────────────────────────

-- ALTER TYPE … ADD VALUE no puede usarse en la misma transacción que lo agrega; aquí no se
-- usa, solo se agrega.
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'PROVEEDOR';
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'OTRO';

ALTER TABLE "propyte_crm"."contacts" ADD COLUMN IF NOT EXISTS "referredById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_referredById_fkey'
      AND conrelid = '"propyte_crm"."contacts"'::regclass
  ) THEN
    ALTER TABLE "propyte_crm"."contacts"
      ADD CONSTRAINT "contacts_referredById_fkey"
      FOREIGN KEY ("referredById") REFERENCES "propyte_crm"."contacts"("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contacts_referredById_idx"
  ON "propyte_crm"."contacts" ("referredById");

-- Comprobación de la parte A (debe dar PROVEEDOR y OTRO al final, y la columna):
--   SELECT enum_range(NULL::"propyte_crm"."ContactType");
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'propyte_crm' AND table_name = 'contacts' AND column_name = 'referredById';

-- ───────────────────────────── PARTE B (después del deploy) ───────────────────────────
-- Descomentar y correr cuando hPanel diga «Se ha completado / Actual» con el commit del #907.
--
-- UPDATE "propyte_crm"."contacts"
--    SET "contactType" = 'BROKER_EXTERNO'
--  WHERE "contactType" = 'REFERIDOR';
--
-- UPDATE "propyte_crm"."bot_agent_profiles"
--    SET "isActive" = false
--  WHERE "deletedAt" IS NULL
--    AND "isActive" = true
--    AND "contactTypes" = ARRAY['REFERIDOR']::"propyte_crm"."ContactType"[];
--
-- Comprobación de la parte B (las dos deben dar 0):
--   SELECT count(*) FROM "propyte_crm"."contacts" WHERE "contactType" = 'REFERIDOR';
--   SELECT count(*) FROM "propyte_crm"."bot_agent_profiles"
--    WHERE "deletedAt" IS NULL AND "isActive" AND 'REFERIDOR' = ANY("contactTypes");

-- Rollback (solo con el código viejo de vuelta):
--   Parte B: UPDATE "propyte_crm"."bot_agent_profiles" SET "isActive" = true
--             WHERE id = '3c7b1ee2-4c0d-4bcd-acf4-ee1703c23391';
--   Parte A: ALTER TABLE "propyte_crm"."contacts" DROP COLUMN IF EXISTS "referredById";
--            (PROVEEDOR/OTRO se pueden quedar en el enum: el código viejo nunca los escribe,
--            pero si algún contacto ya los tiene hay que pasarlo a NULL antes del rollback.)
