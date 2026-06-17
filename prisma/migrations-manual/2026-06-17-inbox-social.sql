-- Inbox social IG/Messenger (§5.10.1). Aditivo + idempotente.
-- Los ALTER TYPE ADD VALUE van en statements sueltos (no usar el valor nuevo en la misma tx).

ALTER TYPE propyte_crm."ConversationChannel" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE propyte_crm."ConversationChannel" ADD VALUE IF NOT EXISTS 'MESSENGER';
ALTER TYPE propyte_crm."MessageChannel" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE propyte_crm."MessageChannel" ADD VALUE IF NOT EXISTS 'MESSENGER';
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'INSTAGRAM_IN';
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'INSTAGRAM_OUT';
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'MESSENGER_IN';
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'MESSENGER_OUT';
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'MESSENGER';
ALTER TYPE propyte_crm."ConnectorProvider" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE propyte_crm."ConnectorProvider" ADD VALUE IF NOT EXISTS 'MESSENGER';

ALTER TABLE propyte_crm.contacts ADD COLUMN IF NOT EXISTS "instagramId" text;
ALTER TABLE propyte_crm.contacts ADD COLUMN IF NOT EXISTS "messengerPsid" text;
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_instagramId_key"   ON propyte_crm.contacts ("instagramId")   WHERE "instagramId"   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_messengerPsid_key" ON propyte_crm.contacts ("messengerPsid") WHERE "messengerPsid" IS NOT NULL;

ALTER TABLE propyte_crm.messages ADD COLUMN IF NOT EXISTS "externalMessageId" text;
CREATE UNIQUE INDEX IF NOT EXISTS "messages_externalMessageId_key" ON propyte_crm.messages ("externalMessageId") WHERE "externalMessageId" IS NOT NULL;
ALTER TABLE propyte_crm.messages ALTER COLUMN "externalPhone" DROP NOT NULL;
