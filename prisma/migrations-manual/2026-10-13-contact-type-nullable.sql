-- #863 — Contactos nuevos nacen sin tipo: contacts."contactType" admite NULL y pierde su
-- DEFAULT. Los contactos que YA tienen tipo no se tocan (no hay UPDATE).
--
-- Estado medido el 2026-10-13: NOT NULL, DEFAULT 'LEAD' en la base — distinto del
-- @default(COMPRADOR) que declaraba schema.prisma (deriva de esquema, misma familia que
-- la #720). No importaba porque ningún create dependía del default de la base. Vivos por
-- tipo: COMPRADOR 126, INVERSIONISTA 1, BROKER_EXTERNO 1, LEAD 1.
--
-- Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm) ANTES de desplegar el
-- código. Es compatible con el código que hoy está en producción: todos sus contact.create
-- mandan contactType explícito (intake ?? COMPRADOR, API ?? COMPRADOR, walk-ins/CSV/Zapier
-- LEAD), así que con el DEFAULT fuera no se inserta ningún NULL hasta que entre el código
-- nuevo — y el código viejo nunca lee un NULL que su cliente de Prisma no espera.
-- Idempotente: re-ejecutarlo no hace nada.
--
-- Rollback (solo con el código viejo de vuelta; los NULL que haya se vuelven COMPRADOR):
--   UPDATE "propyte_crm"."contacts" SET "contactType" = 'COMPRADOR' WHERE "contactType" IS NULL;
--   ALTER TABLE "propyte_crm"."contacts" ALTER COLUMN "contactType" SET DEFAULT 'LEAD';
--   ALTER TABLE "propyte_crm"."contacts" ALTER COLUMN "contactType" SET NOT NULL;

ALTER TABLE "propyte_crm"."contacts" ALTER COLUMN "contactType" DROP DEFAULT;
ALTER TABLE "propyte_crm"."contacts" ALTER COLUMN "contactType" DROP NOT NULL;
