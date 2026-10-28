-- Duración exacta de llamadas: activities.duration_seconds guarda los segundos que reporta
-- Twilio (CallDuration / DialCallDuration). Hasta ahora solo se guardaba duration_minutes
-- redondeado hacia arriba, así que una llamada de 12 s aparecía como "1 min".
--
-- Aditivo e idempotente. Sin backfill: las filas viejas quedan en NULL y la ficha sigue
-- mostrando "N min" con duration_minutes, que se sigue llenando igual que antes.
--
-- Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm) ANTES de desplegar el
-- código. Es compatible con el código que hoy está en producción: ese código no nombra la
-- columna, y una columna nullable sin default no cambia ningún INSERT ni SELECT suyo.
--
-- Rollback (solo con el código viejo de vuelta; se pierden los segundos guardados):
--   ALTER TABLE propyte_crm.activities DROP COLUMN IF EXISTS "duration_seconds";

ALTER TABLE propyte_crm.activities ADD COLUMN IF NOT EXISTS "duration_seconds" INTEGER;

ALTER TABLE propyte_crm.activities DROP CONSTRAINT IF EXISTS activities_duration_seconds_check;
ALTER TABLE propyte_crm.activities
  ADD CONSTRAINT activities_duration_seconds_check CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
