-- Click-to-call Twilio Voice (§5.11.5). Aditivo + idempotente.
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'LLAMADA_ENTRANTE';

ALTER TABLE propyte_crm.activities ADD COLUMN IF NOT EXISTS "callSid" text;
ALTER TABLE propyte_crm.activities ADD COLUMN IF NOT EXISTS "recordingUrl" text;
CREATE UNIQUE INDEX IF NOT EXISTS "activities_callSid_key" ON propyte_crm.activities ("callSid") WHERE "callSid" IS NOT NULL;
