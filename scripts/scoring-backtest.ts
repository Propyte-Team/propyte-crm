/**
 * Backtest del lead scoring (spec 2026-10-26-lead-scoring-design.md §5). SOLO LECTURA.
 *
 * Para cada contacto creado en los últimos N meses calcula el score con las señales que tenía a
 * los D días de creado (actividades y mensajes con fecha ≤ ese corte) y lo compara contra lo que
 * pasó DESPUÉS: llegó a reunión, tuvo deal, ganó deal. Imprime una tabla por decil.
 *
 * Criterio para activar: el decil superior debe convertir a reunión claramente más que el
 * promedio. Si no, los pesos están mal; se ajustan en `scoring.modelo` (versión mayor) y se
 * vuelve a correr.
 *
 * Sesgo conocido: los campos de PERFIL se leen con su valor de HOY (no hay historia por campo a
 * mano aquí), y algunos los llenó el asesor después de la reunión. Eso infla un poco el perfil;
 * por eso el reporte también trae la tabla «sin perfil».
 *
 * Uso: npx tsx scripts/scoring-backtest.ts [meses=12] [diasCorte=7]
 *   Lee DATABASE_URL del entorno (.env). Usa el modelo guardado en SystemConfig o el default.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { calcularScore, type ContactoScore, type SenalesScore } from "../src/lib/scoring/calcular";
import { CLAVE_MODELO, resolverModelo, type ModeloScore } from "../src/lib/scoring/modelo";
config();

const prisma = new PrismaClient();
const DIA = 86_400_000;
const LOTE = 500;
const REUNION = new Set(["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM", "WALK_IN"]);
const ETAPAS_REUNION = new Set(["MEETING_SCHEDULED", "MEETING_COMPLETED", "PROPOSAL_SENT", "NEGOTIATION", "RESERVED", "CONTRACT_SIGNED", "CLOSING", "WON"]);

interface Fila {
  score: number;
  scoreSinPerfil: number;
  reunion: boolean;
  deal: boolean;
  ganado: boolean;
}

async function main() {
  const meses = Number(process.argv[2] ?? 12);
  const diasCorte = Number(process.argv[3] ?? 7);
  const guardado = await prisma.systemConfig.findUnique({ where: { key: CLAVE_MODELO } });
  const { modelo, error } = resolverModelo(guardado?.value);
  if (error) console.warn(`scoring.modelo inválido (${error}); se usa el default`);
  const sinPerfil: ModeloScore = { ...modelo, reglas: modelo.reglas.filter((r) => r.familia !== "perfil") };

  const desde = new Date(Date.now() - meses * 30 * DIA);
  const hasta = new Date(Date.now() - diasCorte * DIA); // necesitan su ventana completa
  const filas: Fila[] = [];
  let excluidos = 0;
  let cursor: string | undefined;

  for (;;) {
    const contactos = await prisma.contact.findMany({
      where: { createdAt: { gte: desde, lte: hasta }, deletedAt: null, mergedIntoId: null },
      orderBy: { id: "asc" },
      take: LOTE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, createdAt: true, contactType: true, contactStatus: true, doNotContact: true, leadSource: true,
        purchaseTimeline: true, urgency: true, paymentMethod: true, investmentProfile: true, phone: true, email: true,
        budgetMin: true, budgetMax: true, custom: true,
        webBehavior: { select: { daysVisited: true, chatCount: true, visitorScore: true } },
      },
    });
    if (contactos.length === 0) break;
    cursor = contactos[contactos.length - 1].id;
    const ids = contactos.map((c) => c.id);

    const [actividades, mensajes, deals, playbooks] = await Promise.all([
      prisma.activity.findMany({
        where: { contactId: { in: ids }, deletedAt: null, status: { not: "CANCELADA" } },
        select: { contactId: true, activityType: true, createdAt: true },
      }),
      prisma.message.findMany({ where: { contactId: { in: ids }, direction: "INBOUND" }, select: { contactId: true, createdAt: true } }),
      prisma.deal.findMany({ where: { contactId: { in: ids }, deletedAt: null }, select: { contactId: true, stage: true } }),
      prisma.conversationPlaybookState.findMany({
        where: { status: "COMPLETED", conversation: { contactId: { in: ids } } },
        select: { completedAt: true, conversation: { select: { contactId: true } } },
      }),
    ]);

    for (const c of contactos) {
      const corte = new Date(c.createdAt.getTime() + diasCorte * DIA);
      const acts = actividades.filter((a) => a.contactId === c.id);
      const senales: SenalesScore = {
        actividades: acts.filter((a) => a.createdAt <= corte).map((a) => ({ tipo: a.activityType, fecha: a.createdAt })),
        entrantes: mensajes.filter((m) => m.contactId === c.id && m.createdAt <= corte).map((m) => m.createdAt),
        playbookCompletado: playbooks.some((p) => p.conversation?.contactId === c.id && p.completedAt !== null && p.completedAt <= corte),
        web: c.webBehavior,
      };
      const custom = (c.custom ?? {}) as Record<string, unknown>;
      // Estado de HOY no se usa en el corte (sería ver el futuro): se evalúa como lead abierto.
      const contacto: ContactoScore = {
        contactType: c.contactType, leadSource: c.leadSource, purchaseTimeline: c.purchaseTimeline, urgency: c.urgency,
        paymentMethod: c.paymentMethod, investmentProfile: c.investmentProfile, phone: c.phone, email: c.email,
        budgetMin: c.budgetMin === null ? null : Number(c.budgetMin), budgetMax: c.budgetMax === null ? null : Number(c.budgetMax),
        budgetCurrency: typeof custom.budget_currency === "string" ? custom.budget_currency : null,
      };
      const r = calcularScore(contacto, senales, modelo, corte);
      if (r.score === null) {
        excluidos++;
        continue;
      }
      const susDeals = deals.filter((d) => d.contactId === c.id);
      filas.push({
        score: r.score,
        scoreSinPerfil: calcularScore(contacto, senales, sinPerfil, corte).score ?? 0,
        reunion:
          acts.some((a) => REUNION.has(a.activityType) && a.createdAt > corte) ||
          susDeals.some((d) => ETAPAS_REUNION.has(d.stage)) ||
          c.contactStatus === "REUNION",
        deal: susDeals.length > 0,
        ganado: susDeals.some((d) => d.stage === "WON"),
      });
    }
    process.stdout.write(`\r${filas.length + excluidos} contactos leídos…`);
  }

  console.log(`\n\nModelo v${modelo.version} · ${meses} meses · corte a ${diasCorte} días · ${filas.length} contactos (${excluidos} excluidos por tipo)\n`);
  imprimir("Score completo", filas, (f) => f.score);
  imprimir("Sin perfil (control del sesgo de §5)", filas, (f) => f.scoreSinPerfil);
  await prisma.$disconnect();
}

function pct(n: number, d: number) {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)} %`;
}

function imprimir(titulo: string, filas: Fila[], valor: (f: Fila) => number) {
  const orden = [...filas].sort((a, b) => valor(b) - valor(a));
  const total = orden.length;
  const base = { reunion: orden.filter((f) => f.reunion).length, deal: orden.filter((f) => f.deal).length, ganado: orden.filter((f) => f.ganado).length };
  console.log(`── ${titulo}`);
  console.log("decil  score       n     reunión    deal       ganado");
  for (let d = 0; d < 10; d++) {
    const tramo = orden.slice(Math.floor((d * total) / 10), Math.floor(((d + 1) * total) / 10));
    if (tramo.length === 0) continue;
    const rango = `${valor(tramo[tramo.length - 1])}–${valor(tramo[0])}`;
    console.log(
      `${String(d + 1).padStart(5)}  ${rango.padEnd(10)} ${String(tramo.length).padStart(5)}  ` +
        `${pct(tramo.filter((f) => f.reunion).length, tramo.length).padStart(8)}  ` +
        `${pct(tramo.filter((f) => f.deal).length, tramo.length).padStart(8)}  ` +
        `${pct(tramo.filter((f) => f.ganado).length, tramo.length).padStart(8)}`
    );
  }
  console.log(`  todo              ${String(total).padStart(5)}  ${pct(base.reunion, total).padStart(8)}  ${pct(base.deal, total).padStart(8)}  ${pct(base.ganado, total).padStart(8)}\n`);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
