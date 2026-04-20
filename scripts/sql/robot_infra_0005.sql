-- robot_infra_0005.sql
-- Trigger: auto-notifica cuando public.properties se actualiza
-- Dispara un webhook via pg_net para que GitHub Actions corra el Robot 01
--
-- PREREQUISITO: extensión pg_net habilitada en Supabase (ya viene por defecto)
--
-- El trigger se activa cuando:
--  1. Se INSERT una nueva property
--  2. Se UPDATE el status de una property (ej: draft→review, review→published)
--  3. Se UPDATE el content_es (nuevo contenido de MPgenesis)
--
-- IMPORTANTE: Para que funcione el webhook, necesitas:
--  1. Crear un Personal Access Token de GitHub (Settings > Developer settings > PAT)
--  2. Guardarlo como secret en Supabase: vault.create_secret('github_pat', 'ghp_xxx...')
--     O como variable de entorno en el dashboard
--  3. El repo debe aceptar workflow_dispatch events

-- ─── 1. Tabla de control para debounce ─────────────────────────
-- Evita que 500 INSERTs en una crawl_run disparen 500 webhooks
CREATE TABLE IF NOT EXISTS public.robot_trigger_log (
  id serial PRIMARY KEY,
  event_type text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT NOW(),
  properties_count integer DEFAULT 1,
  source_domain text,
  response_status integer
);

-- ─── 2. Función que registra cambios (lightweight, no llama webhook) ──
CREATE OR REPLACE FUNCTION public.fn_log_property_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo logear si es un cambio significativo
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.robot_trigger_log (event_type, source_domain)
    SELECT 'insert', s.domain
    FROM public.sources s WHERE s.id = NEW.source_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo si cambió status o content
    IF OLD.status IS DISTINCT FROM NEW.status
       OR OLD.content_es IS DISTINCT FROM NEW.content_es
       OR OLD.content_hash IS DISTINCT FROM NEW.content_hash THEN
      INSERT INTO public.robot_trigger_log (event_type, source_domain)
      SELECT 'update_' || CASE
        WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'status'
        WHEN OLD.content_es IS DISTINCT FROM NEW.content_es THEN 'content'
        ELSE 'hash'
      END, s.domain
      FROM public.sources s WHERE s.id = NEW.source_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 3. Trigger en public.properties ───────────────────────────
DROP TRIGGER IF EXISTS trg_property_change_log ON public.properties;
CREATE TRIGGER trg_property_change_log
  AFTER INSERT OR UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_log_property_change();

-- ─── 4. Función de dispatch (llamar manualmente o con pg_cron) ──
-- Esta función revisa robot_trigger_log y si hay cambios recientes
-- (últimos 30 min), dispara el workflow de GitHub via pg_net.
--
-- Llamar con: SELECT public.fn_dispatch_robot_if_needed();
-- O programar con pg_cron: SELECT cron.schedule('robot-dispatch', '*/30 * * * *', $$SELECT public.fn_dispatch_robot_if_needed()$$);
CREATE OR REPLACE FUNCTION public.fn_dispatch_robot_if_needed()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  changes_count integer;
  github_token text;
  response_id bigint;
BEGIN
  -- Contar cambios en los últimos 30 minutos que no se han procesado
  SELECT COUNT(*) INTO changes_count
  FROM public.robot_trigger_log
  WHERE triggered_at > NOW() - INTERVAL '30 minutes'
    AND response_status IS NULL;

  IF changes_count = 0 THEN
    RETURN 'no_changes';
  END IF;

  -- Intentar obtener el token de GitHub del vault
  -- Si no existe, retornar sin error (el schedule de cada 6h sigue funcionando)
  BEGIN
    SELECT decrypted_secret INTO github_token
    FROM vault.decrypted_secrets
    WHERE name = 'github_pat'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    -- Vault no disponible o secret no existe
    -- Marcar como procesados para no acumular
    UPDATE public.robot_trigger_log
    SET response_status = -1
    WHERE triggered_at > NOW() - INTERVAL '30 minutes'
      AND response_status IS NULL;
    RETURN 'no_token';
  END;

  IF github_token IS NULL THEN
    UPDATE public.robot_trigger_log
    SET response_status = -1
    WHERE triggered_at > NOW() - INTERVAL '30 minutes'
      AND response_status IS NULL;
    RETURN 'no_token';
  END IF;

  -- Disparar workflow via pg_net
  SELECT net.http_post(
    url := 'https://api.github.com/repos/Propyte-Team/propyte-crm/actions/workflows/robot-01-classifier.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || github_token,
      'Accept', 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version', '2022-11-28'
    ),
    body := jsonb_build_object(
      'ref', 'main',
      'inputs', jsonb_build_object('dry_run', 'false')
    )
  ) INTO response_id;

  -- Marcar cambios como procesados
  UPDATE public.robot_trigger_log
  SET response_status = 202
  WHERE triggered_at > NOW() - INTERVAL '30 minutes'
    AND response_status IS NULL;

  RETURN 'dispatched:' || changes_count || '_changes';
END;
$$;

-- ─── 5. Índice para queries rápidas ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_robot_trigger_log_pending
  ON public.robot_trigger_log (triggered_at DESC)
  WHERE response_status IS NULL;
