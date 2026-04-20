/**
 * cleanup-brokers-and-slugs.ts
 * 1. Soft-delete desarrolladores que son brokers/agencias (matchean blacklist)
 * 2. Nullificar slug_unidad genéricos que causan colisiones
 *
 * Corre: npx tsx scripts/cleanup-brokers-and-slugs.ts
 * Dry-run: npx tsx scripts/cleanup-brokers-and-slugs.ts --dry-run
 */
import { getDb, closeDb } from "../src/robots/shared/db";
import { isDeveloperBlacklisted } from "../src/robots/shared/developer-blacklist";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();

  if (DRY_RUN) console.log("🔒 DRY-RUN — no se modifica nada\n");

  // ─── 1. LIMPIAR DESARROLLADORES-BROKER ───────────────────────
  console.log("## 1. Limpieza de desarrolladores-broker\n");

  const allDevs = await db.$queryRawUnsafe<any[]>(`
    SELECT id::text, nombre_desarrollador
    FROM real_estate_hub."Propyte_desarrolladores"
    WHERE deleted_at IS NULL
    ORDER BY nombre_desarrollador
  `);

  console.log(`  Total desarrolladores activos: ${allDevs.length}\n`);

  const toDelete: { id: string; name: string }[] = [];
  const toKeep: string[] = [];

  for (const dev of allDevs) {
    if (isDeveloperBlacklisted(dev.nombre_desarrollador)) {
      toDelete.push({ id: dev.id, name: dev.nombre_desarrollador });
    } else {
      toKeep.push(dev.nombre_desarrollador);
    }
  }

  console.log(`  ✅ Legítimos (conservar): ${toKeep.length}`);
  console.log(`  🔴 Brokers/agencias (eliminar): ${toDelete.length}\n`);

  if (toDelete.length > 0) {
    console.log("  Desarrolladores a eliminar:");
    for (const d of toDelete) {
      console.log(`    - "${d.name}" (${d.id})`);
    }

    if (!DRY_RUN) {
      const devIds = toDelete.map((d) => d.id);
      for (const devId of devIds) {
        // Encontrar desarrollos vinculados a este broker-developer
        const linkedDesarrollos = await db.$queryRawUnsafe<any[]>(`
          SELECT id::text, nombre_desarrollo
          FROM real_estate_hub."Propyte_desarrollos"
          WHERE id_desarrollador = $1::uuid AND deleted_at IS NULL
        `, devId);

        for (const des of linkedDesarrollos) {
          // Verificar si ya existe otro desarrollo con el mismo nombre y NULL developer
          const existing = await db.$queryRawUnsafe<any[]>(`
            SELECT id::text FROM real_estate_hub."Propyte_desarrollos"
            WHERE lower(nombre_desarrollo) = lower($1)
              AND COALESCE(id_desarrollador::text, 'NULL') = 'NULL'
              AND deleted_at IS NULL
              AND id != $2::uuid
            LIMIT 1
          `, des.nombre_desarrollo, des.id);

          if (existing.length > 0) {
            // Ya existe un desarrollo con mismo nombre sin developer → reasignar unidades y soft-delete este
            console.log(`    → "${des.nombre_desarrollo}": merge con existente (${existing[0].id})`);
            await db.$executeRawUnsafe(`
              UPDATE real_estate_hub."Propyte_unidades"
              SET id_desarrollo = $1::uuid, id_desarrollador = NULL, updated_at = NOW()
              WHERE id_desarrollo = $2::uuid AND deleted_at IS NULL
            `, existing[0].id, des.id);
            await db.$executeRawUnsafe(`
              UPDATE real_estate_hub."Propyte_desarrollos"
              SET deleted_at = NOW(), updated_at = NOW()
              WHERE id = $1::uuid
            `, des.id);
          } else {
            // No hay conflicto → solo quitar FK
            await db.$executeRawUnsafe(`
              UPDATE real_estate_hub."Propyte_desarrollos"
              SET id_desarrollador = NULL, updated_at = NOW()
              WHERE id = $1::uuid
            `, des.id);
          }
        }

        // Quitar FK de unidades sueltas
        await db.$executeRawUnsafe(`
          UPDATE real_estate_hub."Propyte_unidades"
          SET id_desarrollador = NULL, updated_at = NOW()
          WHERE id_desarrollador = $1::uuid AND deleted_at IS NULL
        `, devId);

        // Soft-delete el developer
        await db.$executeRawUnsafe(`
          UPDATE real_estate_hub."Propyte_desarrolladores"
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE id = $1::uuid
        `, devId);
      }
      console.log(`\n  ✅ ${toDelete.length} developers soft-deleted + FKs limpiadas/mergeadas`);
    } else {
      console.log("\n  [dry-run] No se eliminó nada");
    }
  }

  // ─── 2. LIMPIAR SLUGS GENÉRICOS ─────────────────────────────
  console.log("\n## 2. Limpieza de slugs genéricos\n");

  const badSlugs = await db.$queryRawUnsafe<any[]>(`
    SELECT slug_unidad, COUNT(*) as cnt
    FROM real_estate_hub."Propyte_unidades"
    WHERE deleted_at IS NULL
      AND slug_unidad IS NOT NULL
    GROUP BY slug_unidad
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `);

  // También incluir slugs conocidos que son genéricos aunque solo aparezcan 1 vez
  const GENERIC_SLUGS = [
    "privado", "de-lujo", "con-alberca", "con-rooftop",
    "frente-al-mar", "boutique", "vista-al-mar", "con-jardin",
    "exclusivo", "premium", "residencial", "departamento",
  ];

  const genericFromDb = await db.$queryRawUnsafe<any[]>(`
    SELECT slug_unidad, COUNT(*) as cnt
    FROM real_estate_hub."Propyte_unidades"
    WHERE deleted_at IS NULL
      AND slug_unidad = ANY($1::text[])
    GROUP BY slug_unidad
    ORDER BY cnt DESC
  `, GENERIC_SLUGS);

  // Merge both lists
  const allBadSlugs = new Set<string>();
  for (const r of badSlugs) allBadSlugs.add(r.slug_unidad);
  for (const r of genericFromDb) allBadSlugs.add(r.slug_unidad);

  if (allBadSlugs.size === 0) {
    console.log("  ✅ No hay slugs genéricos que limpiar");
  } else {
    console.log(`  Slugs a nullificar: ${allBadSlugs.size}`);
    for (const slug of allBadSlugs) {
      const matchingRows = [...badSlugs, ...genericFromDb].find((r) => r.slug_unidad === slug);
      console.log(`    - "${slug}" (${matchingRows?.cnt || "?"} unidades)`);
    }

    if (!DRY_RUN) {
      const result = await db.$executeRawUnsafe(`
        UPDATE real_estate_hub."Propyte_unidades"
        SET slug_unidad = NULL, updated_at = NOW()
        WHERE deleted_at IS NULL
          AND slug_unidad = ANY($1::text[])
      `, [...allBadSlugs]);
      console.log(`\n  ✅ ${result} unidades con slug limpiado → NULL`);
    } else {
      console.log("\n  [dry-run] No se limpió nada");
    }
  }

  // ─── 3. RESUMEN ──────────────────────────────────────────────
  console.log("\n## 3. Estado post-limpieza\n");

  const postDevs = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) as cnt FROM real_estate_hub."Propyte_desarrolladores"
    WHERE deleted_at IS NULL
  `);
  const postSlugs = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) as cnt FROM real_estate_hub."Propyte_unidades"
    WHERE deleted_at IS NULL AND slug_unidad IS NOT NULL
  `);
  console.log(`  Desarrolladores activos: ${postDevs[0].cnt}`);
  console.log(`  Unidades con slug: ${postSlugs[0].cnt}`);

  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
