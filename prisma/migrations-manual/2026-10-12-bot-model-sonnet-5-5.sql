-- Modelo del bot: Sonnet 5 -> Sonnet 5.5 (claude-sonnet-5-5).
-- Idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- DESPUÉS de desplegar el código: el allowlist de src/lib/bot/model.ts es quien reconoce
-- `claude-sonnet-5-5`; con el código viejo, un valor que no conoce se descarta y el bot
-- cae al default anterior (no se rompe, pero tampoco usaría el modelo nuevo).
--
-- Solo se toca la fila que seguía en Sonnet 5; si alguien eligió a propósito Sonnet 4.6 o
-- Haiku 4.5 en el admin, se respeta.
--
-- Rollback:
--   ALTER TABLE "propyte_crm"."bot_config" ALTER COLUMN "model" SET DEFAULT 'claude-sonnet-5';
--   UPDATE "propyte_crm"."bot_config" SET "model" = 'claude-sonnet-5' WHERE "model" = 'claude-sonnet-5-5';

ALTER TABLE "propyte_crm"."bot_config" ALTER COLUMN "model" SET DEFAULT 'claude-sonnet-5-5';
UPDATE "propyte_crm"."bot_config" SET "model" = 'claude-sonnet-5-5' WHERE "model" = 'claude-sonnet-5';
