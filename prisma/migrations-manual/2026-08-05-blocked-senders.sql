-- 2026-08-05 — blocked_senders
-- Lista propia de remitentes bloqueados, para que "marcar como spam" desde el Inbox impida
-- que un inbound futuro del mismo IGSID/PSID vuelva a crear un contacto.
-- Diseño: docs/superpowers/specs/2026-08-05-marcar-spam-inbox-design.md
--
-- No crea tipos nuevos: reutiliza los enums propyte_crm."MessageChannel" y
-- propyte_crm."CommentActionStatus", que ya existen.
--
-- Espeja a comment_rule_logs (la tabla hermana más reciente): sin RLS, y grants
-- postgres (todo) + service_role (SELECT). Verificado contra la base, no supuesto.

CREATE TABLE IF NOT EXISTS propyte_crm.blocked_senders (
  "id"              text                              NOT NULL,
  "channel"         propyte_crm."MessageChannel"      NOT NULL,
  "identifier"      text                              NOT NULL,
  "reason"          text,
  "blockedById"     text,
  "contactId"       text,
  "metaBlockStatus" propyte_crm."CommentActionStatus" NOT NULL DEFAULT 'PENDING',
  "metaSpamStatus"  propyte_crm."CommentActionStatus" NOT NULL DEFAULT 'PENDING',
  "metaError"       text,
  "createdAt"       timestamp(3) without time zone    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unblockedAt"     timestamp(3) without time zone,
  CONSTRAINT blocked_senders_pkey PRIMARY KEY ("id")
);

-- Un remitente = una fila. Desbloquear y volver a bloquear reutiliza la fila
-- (unblockedAt vuelve a NULL) en vez de duplicarla.
CREATE UNIQUE INDEX IF NOT EXISTS "blocked_senders_channel_identifier_key"
  ON propyte_crm.blocked_senders USING btree ("channel", "identifier");

-- La consulta del intake: isSenderBlocked(channel, identifier) con unblockedAt IS NULL.
CREATE INDEX IF NOT EXISTS "blocked_senders_unblockedAt_idx"
  ON propyte_crm.blocked_senders USING btree ("unblockedAt");

CREATE INDEX IF NOT EXISTS "blocked_senders_contactId_idx"
  ON propyte_crm.blocked_senders USING btree ("contactId");

CREATE INDEX IF NOT EXISTS "blocked_senders_createdAt_idx"
  ON propyte_crm.blocked_senders USING btree ("createdAt");

-- SET NULL en las dos FK: borrar un usuario o un contacto NUNCA debe llevarse por delante
-- el bloqueo. El identificador vive en esta tabla, no en el contacto.
ALTER TABLE propyte_crm.blocked_senders
  ADD CONSTRAINT "blocked_senders_blockedById_fkey"
  FOREIGN KEY ("blockedById") REFERENCES propyte_crm.users("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE propyte_crm.blocked_senders
  ADD CONSTRAINT "blocked_senders_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES propyte_crm.contacts("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON propyte_crm.blocked_senders TO postgres;
GRANT SELECT ON propyte_crm.blocked_senders TO service_role;
