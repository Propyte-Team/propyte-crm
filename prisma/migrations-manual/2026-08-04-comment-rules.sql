-- Reglas de comentarios sociales (Instagram + Facebook)
-- Spec: docs/superpowers/specs/2026-08-04-reglas-comentarios-sociales-design.md
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm).
--
-- Rollback:
--   DROP TABLE IF EXISTS "propyte_crm"."comment_rule_logs";
--   DROP TABLE IF EXISTS "propyte_crm"."comment_rules";
--   DROP TYPE  IF EXISTS "propyte_crm"."CommentActionStatus";
--   DROP TYPE  IF EXISTS "propyte_crm"."CommentPlatform";

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."CommentPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."CommentActionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."comment_rules" (
  "id"            TEXT PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "connectorId"   TEXT NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT false,
  "priority"      INTEGER NOT NULL DEFAULT 100,
  "phrases"       TEXT[] NOT NULL,
  "publicReplies" TEXT[] NOT NULL,
  "dmTemplate"    TEXT NOT NULL,
  "postFilter"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"     TIMESTAMP(3)
);

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."comment_rules"
    ADD CONSTRAINT "comment_rules_connectorId_fkey"
    FOREIGN KEY ("connectorId") REFERENCES "propyte_crm"."lead_connectors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "comment_rules_connectorId_name_key"
  ON "propyte_crm"."comment_rules"("connectorId", "name");
CREATE INDEX IF NOT EXISTS "comment_rules_connectorId_isActive_priority_idx"
  ON "propyte_crm"."comment_rules"("connectorId", "isActive", "priority");

CREATE TABLE IF NOT EXISTS "propyte_crm"."comment_rule_logs" (
  "id"                  TEXT PRIMARY KEY,
  "ruleId"              TEXT,
  "connectorId"         TEXT NOT NULL,
  "platform"            "propyte_crm"."CommentPlatform" NOT NULL,
  "externalCommentId"   TEXT NOT NULL,
  "postId"              TEXT NOT NULL,
  "authorId"            TEXT NOT NULL,
  "authorHandle"        TEXT,
  "commentText"         TEXT NOT NULL,
  "matchedPhrase"       TEXT NOT NULL,
  "publicReplyStatus"   "propyte_crm"."CommentActionStatus" NOT NULL DEFAULT 'PENDING',
  "publicReplyError"    TEXT,
  "publicReplyId"       TEXT,
  "publicText"          TEXT,
  "dmStatus"            "propyte_crm"."CommentActionStatus" NOT NULL DEFAULT 'PENDING',
  "dmError"             TEXT,
  "dmText"              TEXT,
  "dmRecipientId"       TEXT,
  "dmExternalMessageId" TEXT,
  "contactId"           TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."comment_rule_logs"
    ADD CONSTRAINT "comment_rule_logs_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "propyte_crm"."comment_rules"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."comment_rule_logs"
    ADD CONSTRAINT "comment_rule_logs_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "comment_rule_logs_externalCommentId_key"
  ON "propyte_crm"."comment_rule_logs"("externalCommentId");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_connectorId_postId_authorId_idx"
  ON "propyte_crm"."comment_rule_logs"("connectorId", "postId", "authorId");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_dmRecipientId_idx"
  ON "propyte_crm"."comment_rule_logs"("dmRecipientId");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_ruleId_createdAt_idx"
  ON "propyte_crm"."comment_rule_logs"("ruleId", "createdAt");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_ruleId_publicReplyStatus_idx"
  ON "propyte_crm"."comment_rule_logs"("ruleId", "publicReplyStatus");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_createdAt_idx"
  ON "propyte_crm"."comment_rule_logs"("createdAt");
