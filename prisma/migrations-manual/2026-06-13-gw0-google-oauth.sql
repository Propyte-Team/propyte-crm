-- prisma/migrations-manual/2026-06-13-gw0-google-oauth.sql
-- GW-0: tokens OAuth de Google por asesor. Aplicar en Supabase (schema propyte_crm).
CREATE TABLE IF NOT EXISTS propyte_crm.google_oauth_tokens (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"         TEXT NOT NULL UNIQUE REFERENCES propyte_crm.users(id) ON DELETE CASCADE,
  "accessToken"    TEXT NOT NULL,
  "refreshToken"   TEXT NOT NULL,
  "tokenExpiry"    TIMESTAMP(3) NOT NULL,
  scope            TEXT NOT NULL,
  "googleEmail"    TEXT NOT NULL,
  "gmailHistoryId" TEXT,
  "isValid"        BOOLEAN NOT NULL DEFAULT true,
  "connectedAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "lastUsedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_google_oauth_tokens_user_id ON propyte_crm.google_oauth_tokens("userId");
