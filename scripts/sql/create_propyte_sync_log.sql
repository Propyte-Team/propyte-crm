-- Propyte_sync_log — log de operaciones del plugin WordPress
-- Escrito por class-propyte-sync-manager.php (log_to_supabase)
-- y class-propyte-change-log.php (log_field_change)

CREATE TABLE IF NOT EXISTS real_estate_hub."Propyte_sync_log" (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_type    text        NOT NULL,
  action       text        NOT NULL,
  entity_type  text,
  entity_id    text,
  wp_post_id   bigint,
  field_key    text,
  old_value    text,
  new_value    text,
  changed_by   text,
  details      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propyte_sync_log_created
  ON real_estate_hub."Propyte_sync_log" (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_propyte_sync_log_entity
  ON real_estate_hub."Propyte_sync_log" (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_propyte_sync_log_type_action
  ON real_estate_hub."Propyte_sync_log" (sync_type, action);

-- Grants: WP plugin usa service_role; CRM authenticated puede leer
GRANT SELECT, INSERT ON real_estate_hub."Propyte_sync_log" TO authenticated;
GRANT ALL ON real_estate_hub."Propyte_sync_log" TO service_role;
