-- #929 — Sin tipo «Referido» ni fuente «Referido de Broker»; ligado a un broker = «Registro de Broker».
--
-- Solo DATOS: no cambia el esquema. REFERIDO (ContactType) y REFERIDO_BROKER (LeadSource) se
-- quedan en sus enums porque Postgres no deja quitar un valor sin recrear el tipo; el código
-- deja de ofrecerlos y de aceptarlos (ver CONTACT_TYPE_RETIRADOS y LEAD_SOURCE_RETIRADAS).
--
-- Compatible con el código de antes y el de después: REGISTRO_BROKER y «sin tipo» (NULL) ya son
-- valores válidos para los dos. Por eso se puede correr ANTES del merge — y conviene volver a
-- correrlo DESPUÉS del despliegue, por si alguien eligió «Referido» en el hueco (idempotente).
--
-- Medido el 2026-10-26 (contactos vivos):
--   · tipo REFERIDO: 1 (Daniel AG). Decisión de sistemas@: su tipo sale de la conversación
--     (Cliente / Inversionista / Comprador / Otro) → queda SIN TIPO para que lo elija el asesor;
--     el clasificador del bot también puede tomarlo, porque un contacto sin tipo es pisable.
--   · fuente REFERIDO_BROKER: 3 (Andres Perez Salgado, Mike Brian Blanco, shawm bennet).
--   · ligados a un broker con fuente distinta de REGISTRO_BROKER: 2 (Ivan Ortiz, Daniel AG; ambos MESSENGER).
--
-- Cada UPDATE queda en record_field_changes por el disparador de cronología (se ve en la ficha).
-- Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm).

UPDATE "propyte_crm"."contacts"
   SET "contactType" = NULL
 WHERE "contactType" = 'REFERIDO';

UPDATE "propyte_crm"."contacts"
   SET "leadSource" = 'REGISTRO_BROKER'
 WHERE "leadSource" = 'REFERIDO_BROKER';

UPDATE "propyte_crm"."contacts"
   SET "leadSource" = 'REGISTRO_BROKER'
 WHERE "referredById" IS NOT NULL
   AND "leadSource" <> 'REGISTRO_BROKER';

-- Comprobación (las tres en 0):
--   SELECT
--     (SELECT count(*) FROM "propyte_crm"."contacts" WHERE "contactType" = 'REFERIDO') AS tipo_referido,
--     (SELECT count(*) FROM "propyte_crm"."contacts" WHERE "leadSource" = 'REFERIDO_BROKER') AS fuente_referido_broker,
--     (SELECT count(*) FROM "propyte_crm"."contacts"
--       WHERE "referredById" IS NOT NULL AND "leadSource" <> 'REGISTRO_BROKER') AS ligados_sin_registro;
--
-- Sin rollback automático: los valores anteriores quedan en record_field_changes (cronología)
-- de cada contacto. Son 6 filas medidas el 26-oct.
