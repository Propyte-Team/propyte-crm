/**
 * Aplica robot_infra_0005.sql directamente (bypass del migration runner
 * que no soporta $$ dollar-quoting de PL/pgSQL).
 */
import { getDb, closeDb } from "../src/robots/shared/db";

async function main() {
  const db = getDb();

  console.log("## Aplicando robot_infra_0005 — trigger de auto-actualización\n");

  // 1. Tabla de control para debounce
  console.log("  [1/5] Creando robot_trigger_log...");
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.robot_trigger_log (
      id serial PRIMARY KEY,
      event_type text NOT NULL,
      triggered_at timestamptz NOT NULL DEFAULT NOW(),
      properties_count integer DEFAULT 1,
      source_domain text,
      response_status integer
    )
  `);
  console.log("  OK");

  // 2. Función que registra cambios
  console.log("  [2/5] Creando fn_log_property_change...");
  await db.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION public.fn_log_property_change()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO public.robot_trigger_log (event_type, source_domain)
        SELECT 'insert', s.domain
        FROM public.sources s WHERE s.id = NEW.source_id;
      ELSIF TG_OP = 'UPDATE' THEN
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
    $fn$
  `);
  console.log("  OK");

  // 3. Trigger en public.properties
  console.log("  [3/5] Creando trigger trg_property_change_log...");
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_property_change_log ON public.properties`);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER trg_property_change_log
      AFTER INSERT OR UPDATE ON public.properties
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_log_property_change()
  `);
  console.log("  OK");

  // 4. Función de dispatch (para llamar manualmente o con pg_cron)
  console.log("  [4/5] Creando fn_dispatch_robot_if_needed...");
  await db.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION public.fn_dispatch_robot_if_needed()
    RETURNS text
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      changes_count integer;
      github_token text;
      response_id bigint;
    BEGIN
      SELECT COUNT(*) INTO changes_count
      FROM public.robot_trigger_log
      WHERE triggered_at > NOW() - INTERVAL '30 minutes'
        AND response_status IS NULL;

      IF changes_count = 0 THEN
        RETURN 'no_changes';
      END IF;

      BEGIN
        SELECT decrypted_secret INTO github_token
        FROM vault.decrypted_secrets
        WHERE name = 'github_pat'
        LIMIT 1;
      EXCEPTION WHEN OTHERS THEN
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

      UPDATE public.robot_trigger_log
      SET response_status = 202
      WHERE triggered_at > NOW() - INTERVAL '30 minutes'
        AND response_status IS NULL;

      RETURN 'dispatched:' || changes_count || '_changes';
    END;
    $fn$
  `);
  console.log("  OK");

  // 5. Índice
  console.log("  [5/5] Creando índice...");
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_robot_trigger_log_pending
      ON public.robot_trigger_log (triggered_at DESC)
      WHERE response_status IS NULL
  `);
  console.log("  OK");

  // Verificar
  console.log("\n## Verificación\n");
  const triggers = await db.$queryRawUnsafe<any[]>(`
    SELECT trigger_name, event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE event_object_table = 'properties'
      AND trigger_schema = 'public'
      AND trigger_name = 'trg_property_change_log'
  `);
  console.log(`  Trigger activo: ${triggers.length > 0 ? "✅ sí" : "❌ no"}`);
  for (const t of triggers) {
    console.log(`    - ${t.trigger_name} (${t.action_timing} ${t.event_manipulation})`);
  }

  const fns = await db.$queryRawUnsafe<any[]>(`
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name IN ('fn_log_property_change', 'fn_dispatch_robot_if_needed')
  `);
  console.log(`  Funciones: ${fns.map((f: any) => f.routine_name).join(", ")}`);

  console.log("\n## Siguiente paso manual\n");
  console.log("  Para activar el webhook automático, necesitas:");
  console.log("  1. Crear un GitHub PAT: Settings > Developer settings > Personal access tokens");
  console.log("     Scope: 'actions' (write) para el repo propyte-crm");
  console.log("  2. En Supabase SQL Editor, guardar el token:");
  console.log("     SELECT vault.create_secret('github_pat', 'ghp_tu_token_aqui');");
  console.log("  3. (Opcional) Programar con pg_cron cada 30 min:");
  console.log("     SELECT cron.schedule('robot-dispatch', '*/30 * * * *',");
  console.log("       $$SELECT public.fn_dispatch_robot_if_needed()$$);");
  console.log("\n  Sin el PAT, el trigger solo registra cambios en robot_trigger_log.");
  console.log("  El Robot 01 sigue corriendo cada 6h via GitHub Actions schedule.");

  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
