-- #973 — Temperatura calculada (Copilot, fase 1).
--
-- Qué hace:
--   1. Crea propyte_crm.contact_temperaturas: una fila por contacto con la temperatura, el grupo
--      (A/B dentro de Tibio), el orden para «Mi día», el motivo, la última respuesta del lead y la
--      última señal de compra. La llena y la reescribe el cron de workflows (etapa «temperatura»).
--   2. contacts.temperature acepta NULL («no aplica»: Registrado por broker y Derivado a RH). El
--      valor por defecto sigue en COLD hasta que el cron calcula el contacto (menos de un minuto).
--
-- Solo agrega: el código de hoy sigue funcionando igual (nunca escribe NULL). Idempotente.
-- Aplicar en Supabase → SQL Editor (oaijxdpevakashxshhvm) ANTES de desplegar el código: el código
-- nuevo escribe en contact_temperaturas (sin la tabla, la etapa del cron falla con guarda y avisa).
--
-- Comprobación (después de desplegar y de unos minutos de cron):
--   SELECT coalesce(temperatura::text,'NO_APLICA') t, grupo, count(*) FROM propyte_crm.contact_temperaturas GROUP BY 1,2 ORDER BY 1,2;
--
-- Rollback:
--   DROP TABLE IF EXISTS propyte_crm.contact_temperaturas;
--   UPDATE propyte_crm.contacts SET temperature = 'COLD' WHERE temperature IS NULL;
--   ALTER TABLE propyte_crm.contacts ALTER COLUMN temperature SET NOT NULL;

BEGIN;

CREATE TABLE IF NOT EXISTS propyte_crm.contact_temperaturas (
  "contactId"         TEXT PRIMARY KEY,
  "temperatura"       propyte_crm."LeadTemperature",
  "grupo"             TEXT CHECK ("grupo" IS NULL OR "grupo" IN ('A', 'B')),
  "orden"             INTEGER NOT NULL,
  "motivo"            TEXT NOT NULL,
  "ultimaRespuestaAt" TIMESTAMP(3),
  "senalCompraAt"     TIMESTAMP(3),
  "calculadoAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "contact_temperaturas_calculadoAt_idx" ON propyte_crm.contact_temperaturas ("calculadoAt");
-- Sin políticas: solo la lee y escribe el CRM con su rol de servidor (igual que contact_scores).
ALTER TABLE propyte_crm.contact_temperaturas ENABLE ROW LEVEL SECURITY;

ALTER TABLE propyte_crm.contacts ALTER COLUMN temperature DROP NOT NULL;

COMMIT;
