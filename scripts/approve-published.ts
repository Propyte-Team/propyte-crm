/**
 * approve-published.ts
 *
 * 1. Diagnostica el estado de public.properties vs real_estate_hub
 * 2. Aprueba todos los registros en real_estate_hub que provienen de properties con status='published'
 */

import { getDb, closeDb } from "../src/robots/shared/db";

async function main() {
  const db = getDb();

  // ── 1. Diagnostico: qué hay en cada lado ───────────────────────
  const published: { count: number }[] = await db.$queryRawUnsafe(`
    SELECT count(*)::int as count FROM public.properties WHERE status = 'published'
  `);
  console.log(`\n📋 public.properties status='published': ${published[0].count}`);

  const hubStats: { table_name: string; total: number; with_legacy: number; approved: number }[] =
    await db.$queryRawUnsafe(`
      SELECT 'unidades' as table_name,
             count(*)::int as total,
             count(ext_legacy_property_id)::int as with_legacy,
             count(approved_at)::int as approved
      FROM real_estate_hub."Propyte_unidades"
      UNION ALL
      SELECT 'desarrollos', count(*)::int, 0, count(approved_at)::int
      FROM real_estate_hub."Propyte_desarrollos"
      UNION ALL
      SELECT 'desarrolladores', count(*)::int, 0, count(approved_at)::int
      FROM real_estate_hub."Propyte_desarrolladores"
    `);

  console.log(`\n📊 Estado real_estate_hub:`);
  for (const r of hubStats) {
    console.log(`   ${r.table_name}: ${r.total} total, ${r.approved} aprobados, ${r.with_legacy} con legacy_id`);
  }

  // ── 2. Estrategia: aprobar basado en source status ─────────────
  // Robot 01 filtró solo status IN ('review','published') y NO possible_duplicate.
  // Ahora aprobamos las unidades cuyo property source era 'published'.
  // Si ext_legacy_property_id está poblado, usamos el join directo.
  // Si no, aprobamos TODOS los registros (ya pasaron el filtro del robot).

  const unidadesWithLegacy = hubStats.find(r => r.table_name === 'unidades')?.with_legacy ?? 0;

  let unidadesApproved = 0;
  let desarrollosApproved = 0;
  let desarrolladoresApproved = 0;

  if (unidadesWithLegacy > 0) {
    // Ruta A: join directo via ext_legacy_property_id
    console.log(`\n🔗 Ruta A: join via ext_legacy_property_id`);

    const matchCount: { count: number }[] = await db.$queryRawUnsafe(`
      SELECT count(*)::int as count
      FROM real_estate_hub."Propyte_unidades" u
      JOIN public.properties p ON u.ext_legacy_property_id = p.id
      WHERE p.status = 'published'
    `);
    console.log(`   Unidades matcheadas con published: ${matchCount[0].count}`);

    if (!process.argv.includes("--dry-run")) {
      // Aprobar unidades vinculadas a published
      unidadesApproved = await db.$executeRawUnsafe(`
        UPDATE real_estate_hub."Propyte_unidades" u
        SET approved_at = NOW(),
            approved_by = 'auto:approve-published',
            zoho_pipeline_status = 'Aprobado',
            ext_publicado = true
        FROM public.properties p
        WHERE u.ext_legacy_property_id = p.id
          AND p.status = 'published'
          AND u.approved_at IS NULL
      `);

      // Aprobar desarrollos que tengan al menos 1 unidad aprobada
      desarrollosApproved = await db.$executeRawUnsafe(`
        UPDATE real_estate_hub."Propyte_desarrollos"
        SET approved_at = NOW(),
            approved_by = 'auto:approve-published',
            zoho_pipeline_status = 'Aprobado',
            ext_publicado = true
        WHERE approved_at IS NULL
          AND id IN (
            SELECT DISTINCT id_desarrollo
            FROM real_estate_hub."Propyte_unidades"
            WHERE approved_at IS NOT NULL AND id_desarrollo IS NOT NULL
          )
      `);

      // Aprobar desarrolladores vinculados a desarrollos aprobados
      desarrolladoresApproved = await db.$executeRawUnsafe(`
        UPDATE real_estate_hub."Propyte_desarrolladores"
        SET approved_at = NOW(),
            approved_by = 'auto:approve-published',
            zoho_pipeline_status = 'Aprobado',
            ext_publicado = true
        WHERE approved_at IS NULL
          AND id IN (
            SELECT DISTINCT id_desarrollador
            FROM real_estate_hub."Propyte_desarrollos"
            WHERE approved_at IS NOT NULL AND id_desarrollador IS NOT NULL
          )
      `);
    }
  } else {
    // Ruta B: sin legacy_id, aprobar TODO lo que el robot ya metió
    // (Robot 01 ya filtró: status IN ('review','published') AND NOT possible_duplicate)
    console.log(`\n🔓 Ruta B: ext_legacy_property_id vacío — aprobando todo lo existente en el hub`);
    console.log(`   (Robot 01 ya filtró datos basura; lo que está aquí es válido)`);

    if (!process.argv.includes("--dry-run")) {
      unidadesApproved = await db.$executeRawUnsafe(`
        UPDATE real_estate_hub."Propyte_unidades"
        SET approved_at = NOW(),
            approved_by = 'auto:approve-published',
            zoho_pipeline_status = 'Aprobado',
            ext_publicado = true
        WHERE approved_at IS NULL
      `);

      desarrollosApproved = await db.$executeRawUnsafe(`
        UPDATE real_estate_hub."Propyte_desarrollos"
        SET approved_at = NOW(),
            approved_by = 'auto:approve-published',
            zoho_pipeline_status = 'Aprobado',
            ext_publicado = true
        WHERE approved_at IS NULL
      `);

      desarrolladoresApproved = await db.$executeRawUnsafe(`
        UPDATE real_estate_hub."Propyte_desarrolladores"
        SET approved_at = NOW(),
            approved_by = 'auto:approve-published',
            zoho_pipeline_status = 'Aprobado',
            ext_publicado = true
        WHERE approved_at IS NULL
      `);
    }
  }

  if (process.argv.includes("--dry-run")) {
    console.log(`\n⏸️  Dry run — no se modificó nada. Quita --dry-run para ejecutar.`);
  } else {
    console.log(`\n✅ Resultados:`);
    console.log(`   Unidades aprobadas: ${unidadesApproved}`);
    console.log(`   Desarrollos aprobados: ${desarrollosApproved}`);
    console.log(`   Desarrolladores aprobados: ${desarrolladoresApproved}`);
    console.log(`\n🎉 Listo. Corre el sync manual desde WP Admin.`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
