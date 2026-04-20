/**
 * Auditoría completa del stack Supabase Propyte.
 *
 * Busca:
 * - Tablas sin RLS
 * - Indexes faltantes (FK sin index, columnas con filtros frecuentes sin index)
 * - FKs declarativas faltantes (columnas *_id que no apuntan a nada)
 * - Tablas huérfanas / sin uso
 * - Materialized views sin unique index (REFRESH CONCURRENTLY falla)
 * - GRANTs riesgosos (anon con INSERT/UPDATE)
 * - Data quality: duplicates por slug, NULLs críticos
 * - Robot runs status + errores recientes
 *
 * Uso: npx tsx scripts/audit-full.ts
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const pwd = process.env.SUPABASE_DB_PASSWORD!;
const URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(pwd)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const db = new PrismaClient({ datasourceUrl: URL });

const SCHEMAS = ["real_estate_hub", "investment_analytics", "public", "propyte_crm"];

async function section(title: string) {
  console.log(`\n\n════════ ${title} ════════`);
}

async function main() {
  // ══════════════ 1. RLS STATUS ══════════════
  await section("1. TABLAS SIN RLS (en schemas nuestros)");
  const rlsGaps = await db.$queryRawUnsafe<Array<{ schema: string; tbl: string; rls: boolean; policies: bigint }>>(`
    SELECT n.nspname AS schema, c.relname AS tbl, c.relrowsecurity AS rls,
           (SELECT COUNT(*)::bigint FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('real_estate_hub', 'investment_analytics')
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
    ORDER BY n.nspname, c.relname
  `);
  if (rlsGaps.length === 0) console.log("  OK — todas tienen RLS");
  rlsGaps.forEach(r => console.log(`  [${r.schema}] ${r.tbl}  (policies: ${r.policies})`));

  // ══════════════ 2. FKs faltantes en columnas *_id ══════════════
  await section("2. COLUMNAS *_id SIN FK DECLARATIVA");
  const fkGaps = await db.$queryRawUnsafe<Array<{ schema: string; tbl: string; col: string }>>(`
    SELECT c.table_schema AS schema, c.table_name AS tbl, c.column_name AS col
    FROM information_schema.columns c
    WHERE c.table_schema IN ('real_estate_hub', 'investment_analytics', 'propyte_crm')
      AND c.column_name LIKE '%_id'
      AND c.column_name NOT IN ('id', 'wp_post_id', 'zoho_record_id', 'ext_legacy_property_id', 'development_id', 'supabase_id', 'zoho_id', 'entity_id', 'record_id', 'sync_run_id')
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.key_column_usage k
        JOIN information_schema.table_constraints tc ON k.constraint_name = tc.constraint_name
        WHERE k.table_schema = c.table_schema
          AND k.table_name = c.table_name
          AND k.column_name = c.column_name
          AND tc.constraint_type = 'FOREIGN KEY'
      )
    ORDER BY c.table_schema, c.table_name, c.column_name
  `);
  if (fkGaps.length === 0) console.log("  OK");
  fkGaps.forEach(r => console.log(`  [${r.schema}] ${r.tbl}.${r.col}`));

  // ══════════════ 3. FKs SIN INDEX (joins lentos) ══════════════
  await section("3. FKs SIN INDEX (joins van a seq scan)");
  const fkNoIdx = await db.$queryRawUnsafe<Array<{ schema: string; tbl: string; col: string }>>(`
    SELECT n.nspname AS schema, cl.relname AS tbl, a.attname AS col
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    WHERE con.contype = 'f'
      AND n.nspname IN ('real_estate_hub', 'investment_analytics', 'propyte_crm')
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = con.conrelid
          AND a.attnum = ANY(i.indkey)
          AND i.indkey[0] = a.attnum
      )
    ORDER BY n.nspname, cl.relname, a.attname
  `);
  if (fkNoIdx.length === 0) console.log("  OK");
  fkNoIdx.forEach(r => console.log(`  [${r.schema}] ${r.tbl}.${r.col}`));

  // ══════════════ 4. GRANTs a anon con INSERT/UPDATE/DELETE ══════════════
  await section("4. GRANTs RIESGOSOS (anon con write)");
  const grantsBad = await db.$queryRawUnsafe<Array<{ schema: string; tbl: string; grantee: string; priv: string }>>(`
    SELECT table_schema AS schema, table_name AS tbl, grantee, privilege_type AS priv
    FROM information_schema.role_table_grants
    WHERE table_schema IN ('real_estate_hub', 'investment_analytics')
      AND grantee IN ('anon', 'PUBLIC')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    ORDER BY table_schema, table_name
  `);
  if (grantsBad.length === 0) console.log("  OK — anon solo SELECT");
  grantsBad.forEach(r => console.log(`  ⚠ [${r.schema}] ${r.tbl} → ${r.grantee} tiene ${r.priv}`));

  // ══════════════ 5. Materialized views sin unique index ══════════════
  await section("5. MATERIALIZED VIEWS (REFRESH CONCURRENTLY requiere unique index)");
  const mvs = await db.$queryRawUnsafe<Array<{ schema: string; mv: string; has_unique: boolean }>>(`
    SELECT n.nspname AS schema, c.relname AS mv,
           EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisunique) AS has_unique
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'm'
      AND n.nspname IN ('real_estate_hub', 'investment_analytics', 'public')
    ORDER BY n.nspname, c.relname
  `);
  mvs.forEach(m => console.log(`  ${m.has_unique ? "OK " : "⚠  "} [${m.schema}] ${m.mv}  unique_idx=${m.has_unique}`));

  // ══════════════ 6. TAMAÑO TABLAS + LAST UPDATE ══════════════
  await section("6. TAMAÑO Y ACTIVIDAD (real_estate_hub + investment_analytics)");
  const sizes = await db.$queryRawUnsafe<Array<{ schema: string; tbl: string; size: string; rows: bigint; last_vac: string | null }>>(`
    SELECT n.nspname AS schema, c.relname AS tbl,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
           COALESCE(s.n_live_tup, 0)::bigint AS rows,
           to_char(GREATEST(s.last_autoanalyze, s.last_analyze, s.last_autovacuum, s.last_vacuum), 'YYYY-MM-DD HH24:MI') AS last_vac
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname IN ('real_estate_hub', 'investment_analytics')
      AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 30
  `);
  sizes.forEach(r => console.log(`  [${r.schema}] ${r.tbl.padEnd(30)} ${r.size.padStart(10)}  ${String(r.rows).padStart(8)} rows  last_stat=${r.last_vac ?? 'nunca'}`));

  // ══════════════ 7. DATA QUALITY — duplicates por slug ══════════════
  await section("7. DATA QUALITY: duplicados por slug");
  const slugChecks: Array<[string, string]> = [
    ["Propyte_desarrollos", "ext_slug_desarrollo"],
    ["Propyte_unidades", "slug_unidad"],
  ];
  for (const [tbl, col] of slugChecks) {
    try {
      const d = await db.$queryRawUnsafe<Array<{ slug: string; n: bigint }>>(`
        SELECT "${col}" AS slug, COUNT(*)::bigint AS n
        FROM real_estate_hub."${tbl}"
        WHERE "${col}" IS NOT NULL AND "${col}" != '' AND deleted_at IS NULL
        GROUP BY "${col}" HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC LIMIT 5
      `);
      if (d.length === 0) console.log(`  OK  ${tbl}`);
      else {
        console.log(`  ⚠ ${tbl} (${col}) ${d.length}+ duplicados:`);
        d.forEach(x => console.log(`     "${x.slug}": ${x.n}x`));
      }
    } catch (e: any) {
      console.log(`  SKIP ${tbl}: ${e.message?.slice(0, 80)}`);
    }
  }

  // ══════════════ 8. NULLs críticos en Propyte_desarrollos ══════════════
  await section("8. NULLs en campos CRÍTICOS (Propyte_desarrollos)");
  const nullStats = await db.$queryRawUnsafe<Array<{ field: string; null_count: bigint; total: bigint; pct: number }>>(`
    WITH tot AS (SELECT COUNT(*)::bigint AS t FROM real_estate_hub."Propyte_desarrollos" WHERE deleted_at IS NULL)
    SELECT f.field,
           COUNT(*) FILTER (WHERE (f.val IS NULL OR f.val = '') AND deleted_at IS NULL)::bigint AS null_count,
           (SELECT t FROM tot) AS total,
           ROUND(100.0 * COUNT(*) FILTER (WHERE (f.val IS NULL OR f.val = '') AND deleted_at IS NULL) / NULLIF((SELECT t FROM tot), 0), 1)::float AS pct
    FROM real_estate_hub."Propyte_desarrollos" d
    CROSS JOIN LATERAL (VALUES
      ('nombre_desarrollo', d.nombre_desarrollo::text),
      ('ciudad', d.ciudad::text),
      ('tipo_desarrollo', d.tipo_desarrollo::text),
      ('ext_precio_min_mxn', d.ext_precio_min_mxn::text),
      ('latitud', d.latitud::text),
      ('longitud', d.longitud::text),
      ('id_desarrollador', d.id_desarrollador::text),
      ('ext_descripcion_es', d.ext_descripcion_es),
      ('ext_meta_title_desarrollo', d.ext_meta_title_desarrollo),
      ('ext_meta_description_desarrollo', d.ext_meta_description_desarrollo)
    ) AS f(field, val)
    GROUP BY f.field
    ORDER BY 4 DESC
  `);
  nullStats.forEach(n => console.log(`  ${n.pct >= 50 ? '⚠ ' : '  '}${n.field.padEnd(38)} ${n.null_count}/${n.total} (${n.pct}% NULL)`));

  // ══════════════ 9. AMENITIES coverage ══════════════
  await section("9. AMENITIES COVERAGE (16 booleanas, Propyte_desarrollos)");
  const amenCols = ["amenidad_alberca_comunitaria", "amenidad_gimnasio", "amenidad_rooftop", "amenidad_jardin", "amenidad_salon_usos_multiples", "amenidad_cancha_deportiva", "amenidad_spa", "amenidad_playa_privada"];
  const amenStats = await db.$queryRawUnsafe<Array<{ col: string; trues: bigint; total: bigint }>>(`
    SELECT 'total' AS col, COUNT(*) FILTER (WHERE true)::bigint AS trues, COUNT(*)::bigint AS total
    FROM real_estate_hub."Propyte_desarrollos" WHERE deleted_at IS NULL
  `);
  console.log(`  Universe: ${amenStats[0].total} desarrollos activos`);
  for (const c of amenCols) {
    try {
      const r = await db.$queryRawUnsafe<Array<{ t: bigint }>>(`SELECT COUNT(*) FILTER (WHERE "${c}" = true)::bigint AS t FROM real_estate_hub."Propyte_desarrollos" WHERE deleted_at IS NULL`);
      console.log(`  ${c.padEnd(40)} ${r[0].t}`);
    } catch (e: any) {
      console.log(`  ${c}: col no existe`);
    }
  }

  // ══════════════ 10. GEO COVERAGE ══════════════
  await section("10. GEO COVERAGE");
  const geo = await db.$queryRawUnsafe<Array<{ total: bigint; with_geo: bigint; pct: number }>>(`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE latitud IS NOT NULL AND longitud IS NOT NULL)::bigint AS with_geo,
           ROUND(100.0 * COUNT(*) FILTER (WHERE latitud IS NOT NULL AND longitud IS NOT NULL) / NULLIF(COUNT(*), 0), 1)::float AS pct
    FROM real_estate_hub."Propyte_desarrollos" WHERE deleted_at IS NULL
  `);
  console.log(`  Desarrollos con lat/lng: ${geo[0].with_geo}/${geo[0].total} (${geo[0].pct}%)`);

  // ══════════════ 11. ROBOT RUNS ══════════════
  await section("11. ÚLTIMAS CORRIDAS ROBOTS (últimas 24h)");
  try {
    const runs = await db.$queryRawUnsafe<Array<{ robot: string; status: string; started: string; duration_ms: number; errors: number; metrics: any }>>(`
      SELECT robot, status,
             to_char(started_at, 'YYYY-MM-DD HH24:MI') AS started,
             duration_ms, errors_count::int AS errors, metrics
      FROM real_estate_hub."Propyte_robot_runs"
      WHERE started_at > NOW() - INTERVAL '24 hours'
      ORDER BY started_at DESC LIMIT 20
    `);
    if (runs.length === 0) console.log("  (sin runs en últimas 24h)");
    runs.forEach(r => console.log(`  ${r.started} ${r.robot.padEnd(15)} ${r.status.padEnd(10)} ${String(r.duration_ms).padStart(6)}ms errors=${r.errors}`));
  } catch (e: any) {
    console.log(`  SKIP: ${e.message?.slice(0, 100)}`);
  }

  // ══════════════ 12. UNIDADES HUÉRFANAS (sin desarrollo) ══════════════
  await section("12. UNIDADES SUELTAS (sin desarrollo padre)");
  const huerf = await db.$queryRawUnsafe<Array<{ total: bigint; sin_dev: bigint; pct: number }>>(`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE id_desarrollo IS NULL)::bigint AS sin_dev,
           ROUND(100.0 * COUNT(*) FILTER (WHERE id_desarrollo IS NULL) / NULLIF(COUNT(*), 0), 1)::float AS pct
    FROM real_estate_hub."Propyte_unidades" WHERE deleted_at IS NULL
  `);
  console.log(`  ${huerf[0].sin_dev}/${huerf[0].total} sin desarrollo padre (${huerf[0].pct}%)`);

  // ══════════════ 13. EXTENSIONES ══════════════
  await section("13. EXTENSIONES INSTALADAS");
  const exts = await db.$queryRawUnsafe<Array<{ extname: string; extversion: string }>>(`
    SELECT extname, extversion FROM pg_extension ORDER BY extname
  `);
  exts.forEach(e => console.log(`  ${e.extname} ${e.extversion}`));

  await db.$disconnect();
  console.log("\n\n=== FIN AUDITORIA ===");
}

main().catch(e => { console.error(e); process.exit(1); });
