CREATE TABLE IF NOT EXISTS real_estate_hub."Propyte_zoho_sync_log" (
      "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      "sync_run_id" text NOT NULL,
      "direction" text NOT NULL,
      "entity_type" text NOT NULL,
      "operation" text NOT NULL,
      "record_id" text,
      "zoho_record_id" text,
      "details" jsonb,
      "error_message" text,
      "created_at" timestamptz DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_sync_log_run
      ON real_estate_hub."Propyte_zoho_sync_log" ("sync_run_id");
    CREATE INDEX IF NOT EXISTS idx_sync_log_entity_op
      ON real_estate_hub."Propyte_zoho_sync_log" ("entity_type", "operation");
    CREATE INDEX IF NOT EXISTS idx_sync_log_created
      ON real_estate_hub."Propyte_zoho_sync_log" ("created_at" DESC);

    -- Grants para service_role (ya tiene por ser superuser), agregar para completeness
    GRANT SELECT, INSERT ON real_estate_hub."Propyte_zoho_sync_log" TO authenticated;
    GRANT ALL ON real_estate_hub."Propyte_zoho_sync_log" TO service_role;