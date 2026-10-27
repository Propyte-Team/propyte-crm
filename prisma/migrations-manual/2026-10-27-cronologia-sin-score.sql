-- Cronología sin el score de contactos (spec 2026-10-26-lead-scoring-design.md §7, prerrequisito de F3).
--
-- Con `scoring.activo` encendido, el cron reescribe contacts.score en cada recálculo y el disparador
-- trg_contacts_field_changes metería una fila en record_field_changes por cada cambio: la ficha se
-- llenaría de «Score 23 → 24». El historial del score ya vive en contact_scores (desglose y versión
-- del modelo), así que se excluye aquí.
--
-- Solo para contactos: la función es compartida con deals (TG_ARGV[0]) y ahí no se toca nada.
-- Idéntica a la de 2026-07-13-cronologia-field-changes.sql salvo el bloque marcado. Idempotente.

CREATE OR REPLACE FUNCTION propyte_crm.log_field_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  excluded_keys text[] := ARRAY['updatedAt', 'lastActivityAt'];
  k text;
BEGIN
  -- 2026-10-27: el score de contactos tiene su propio historial en contact_scores.
  IF TG_ARGV[0] = 'contact' THEN
    excluded_keys := excluded_keys || 'score';
  END IF;

  FOR k IN SELECT jsonb_object_keys(new_row)
  LOOP
    IF k = ANY (excluded_keys) THEN
      CONTINUE;
    END IF;
    IF old_row -> k IS DISTINCT FROM new_row -> k THEN
      INSERT INTO propyte_crm.record_field_changes
        (entity_type, entity_id, field, old_value, new_value, source, actor_id)
      VALUES (
        TG_ARGV[0],
        NEW.id,
        k,
        old_row -> k,
        new_row -> k,
        nullif(current_setting('crm.source', true), ''),
        nullif(current_setting('crm.actor_id', true), '')
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
