// ============================================================
// Migrar 597 meta_leads de vieja DB → nueva DB
//
// El script migrate-to-new-db.ts leyó los meta_leads pero NO los
// escribió (solo escribió tablas Zoho via Supabase client).
// Los meta_leads son un modelo Prisma (propyte_crm schema), así que
// necesitamos copiarlos con Prisma directamente.
//
// USO:
//   OLD_DATABASE_URL="postgresql://postgres.yjbrynsykkycozeybykj:PASS@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true" npx tsx scripts/migrate-meta-leads.ts
//
// OLD_DATABASE_URL = la URL de la vieja DB (yjbrynsykkycozeybykj)
// DATABASE_URL (en .env) = ya apunta a la nueva DB
// ============================================================

import { PrismaClient } from "@prisma/client";

const OLD_DB_URL = process.env.OLD_DATABASE_URL;

if (!OLD_DB_URL) {
  console.error("❌ Falta OLD_DATABASE_URL como variable de entorno");
  console.error("   Ejemplo:");
  console.error('   OLD_DATABASE_URL="postgresql://postgres.yjbrynsykkycozeybykj:PASS@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true" npx tsx scripts/migrate-meta-leads.ts');
  process.exit(1);
}

// Cliente que lee de la vieja DB
const oldPrisma = new PrismaClient({
  datasources: { db: { url: OLD_DB_URL } },
});

// Cliente que escribe a la nueva DB (usa DATABASE_URL del .env)
const newPrisma = new PrismaClient();

async function main() {
  console.log("=== Migración de meta_leads: vieja DB → nueva DB ===\n");

  // 1. Leer de vieja DB
  const oldLeads = await oldPrisma.metaLead.findMany();
  console.log(`Leídos ${oldLeads.length} meta_leads de vieja DB`);

  if (oldLeads.length === 0) {
    console.log("No hay leads que migrar.");
    return;
  }

  // 2. Verificar cuántos ya existen en nueva DB
  const existingCount = await newPrisma.metaLead.count();
  console.log(`Nueva DB tiene ${existingCount} meta_leads actualmente`);

  // 3. Insertar en nueva DB (skip duplicados por metaLeadId unique)
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const lead of oldLeads) {
    try {
      const exists = await newPrisma.metaLead.findUnique({
        where: { metaLeadId: lead.metaLeadId },
        select: { id: true },
      });

      if (exists) {
        skipped++;
        continue;
      }

      await newPrisma.metaLead.create({
        data: {
          metaLeadId: lead.metaLeadId,
          createdOnMeta: lead.createdOnMeta,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          country: lead.country,
          language: lead.language,
          urgency: lead.urgency,
          acquisition: lead.acquisition,
          budget: lead.budget,
          description: lead.description,
          extraFields: lead.extraFields ?? undefined,
          campaignId: lead.campaignId,
          campaignName: lead.campaignName,
          adsetId: lead.adsetId,
          adsetName: lead.adsetName,
          adId: lead.adId,
          adName: lead.adName,
          formId: lead.formId,
          formName: lead.formName,
          platform: lead.platform,
          pageName: lead.pageName,
          status: lead.status,
          matchedContactId: lead.matchedContactId,
          matchedAt: lead.matchedAt,
          matchMethod: lead.matchMethod,
        },
      });
      created++;
    } catch (err) {
      errors++;
      if (errors <= 3) {
        console.log(`  ✗ Error en ${lead.metaLeadId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`\n✅ Resultado:`);
  console.log(`   Creados: ${created}`);
  console.log(`   Skipped (ya existían): ${skipped}`);
  console.log(`   Errores: ${errors}`);
  console.log(`   Total nueva DB: ${await newPrisma.metaLead.count()}`);
}

main()
  .catch((e) => {
    console.error("❌ Error fatal:", e);
    process.exit(1);
  })
  .finally(async () => {
    await oldPrisma.$disconnect();
    await newPrisma.$disconnect();
  });
