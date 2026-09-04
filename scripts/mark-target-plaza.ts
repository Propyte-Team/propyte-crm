// ============================================================
// Marca la plaza objetivo (targetPlaza) de los contactos, según la campaña/conector.
// NO reasigna a nadie: solo escribe la plaza para poder repartir por plaza después.
//
// Requisito: aplicar antes la migración
//   prisma/migrations-manual/2026-09-03-contact-target-plaza.sql
//
// Uso:
//   npx tsx scripts/mark-target-plaza.ts            → DRY-RUN: muestra el reparto, no escribe
//   APPLY=1 npx tsx scripts/mark-target-plaza.ts    → escribe targetPlaza en los contactos
//
// Regla: Nativa/Tulum → TULUM · Yaxnah/Mérida → MERIDA · resto → PDC
// (una sola fuente de verdad en src/lib/intake/campaign-plaza.ts).
// ============================================================
import { PrismaClient } from "@prisma/client";
import { resolveTargetPlaza } from "../src/lib/intake/campaign-plaza";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

type Row = {
  id: string;
  campaignName: string | null;
  adName: string | null;
  adsetName: string | null;
  connectorName: string | null;
  assignee: string | null;
};

async function main() {
  console.log(APPLY ? "== APLICANDO targetPlaza ==" : "== DRY-RUN (no escribe; usa APPLY=1) ==");

  // Junta, por contacto vivo, todas las señales de marca: campaña/anuncio/adset
  // (Facebook) y nombre del conector (DM de IG/Messenger).
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    select c.id,
           a."campaignName"          as "campaignName",
           a."adName"                as "adName",
           a."adsetName"             as "adsetName",
           lc.name                   as "connectorName",
           u.email                   as "assignee"
    from propyte_crm.contacts c
    left join propyte_crm.ad_attributions a on a."contactId" = c.id
    left join propyte_crm.conversations   cv on cv."contactId" = c.id
    left join propyte_crm.lead_connectors lc on lc.id = cv."connectorId"
    left join propyte_crm.users           u  on u.id = c."assignedToId"
    where c."deletedAt" is null
  `);

  // Un contacto puede traer varias filas (varias conversaciones): agrupamos señales.
  const byContact = new Map<string, { signals: (string | null)[]; assignee: string | null }>();
  for (const r of rows) {
    const entry = byContact.get(r.id) ?? { signals: [], assignee: r.assignee };
    entry.signals.push(r.campaignName, r.adName, r.adsetName, r.connectorName);
    byContact.set(r.id, entry);
  }

  const plan: { id: string; plaza: string; test: boolean }[] = [];
  for (const [id, { signals, assignee }] of byContact) {
    plan.push({ id, plaza: resolveTargetPlaza(signals), test: !!assignee?.endsWith(".local") });
  }

  // Resumen
  const count = (pred: (p: (typeof plan)[number]) => boolean) => plan.filter(pred).length;
  const dist = (subset: typeof plan) =>
    ["PDC", "TULUM", "MERIDA"].map((pz) => `${pz}:${subset.filter((p) => p.plaza === pz).length}`).join(", ");
  console.log(`\nContactos vivos: ${plan.length}`);
  console.log(`  Reparto por plaza (todos):        ${dist(plan)}`);
  console.log(`  En cuentas de prueba (.local):    ${dist(plan.filter((p) => p.test))}`);
  console.log(`  En asesores reales:               ${dist(plan.filter((p) => !p.test))}`);

  if (!APPLY) {
    console.log("\n(fue DRY-RUN — nada se escribió. No se reasigna a nadie: solo se marca la plaza.)");
    return;
  }

  let n = 0;
  for (const { id, plaza } of plan) {
    await prisma.$executeRawUnsafe(
      `update propyte_crm.contacts set "targetPlaza" = $1::propyte_crm."Plaza" where id = $2`,
      plaza,
      id,
    );
    n++;
  }
  console.log(`\nListo: targetPlaza escrita en ${n} contactos. NO se reasignó ningún lead.`);
}

main()
  .catch((e) => {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
