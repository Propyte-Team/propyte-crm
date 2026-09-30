-- BSUID de WhatsApp (business-scoped user id) en el contacto. Aditivo + idempotente,
-- mismo patrón que instagramId/messengerPsid en 2026-06-17-inbox-social.sql.
--
-- Meta manda `contacts[].user_id` en TODOS los webhooks entrantes de WhatsApp desde
-- abril de 2026 y hasta ahora se tiraba. El teléfono (`wa_id`) es CONDICIONAL: solo
-- viene si hubo interacción en los últimos 30 días o el usuario está en el contact
-- book, y esa ventana se evalúa POR NÚMERO DE NEGOCIO — o sea que cada número nuevo
-- que se prenda aumenta los contactos que llegan sin teléfono. El BSUID siempre está.
--
-- Nullable a propósito: los contactos que ya existen no tienen BSUID y lo irán
-- adquiriendo conforme escriban. Esta migración NO toca el emparejado de contactos
-- (que sigue yendo por teléfono) ni la nulabilidad de "phone".
--
-- El UNIQUE va como índice PARCIAL (WHERE IS NOT NULL) para que varios contactos sin
-- BSUID conviviesen sin chocar entre ellos, igual que instagramId y messengerPsid.
ALTER TABLE "propyte_crm"."contacts"
  ADD COLUMN IF NOT EXISTS "whatsappUserId" text;

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_whatsappUserId_key"
  ON "propyte_crm"."contacts" ("whatsappUserId")
  WHERE "whatsappUserId" IS NOT NULL;
