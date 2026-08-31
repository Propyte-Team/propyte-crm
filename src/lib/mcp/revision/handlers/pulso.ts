import type { RevisionContext } from "../types";

/**
 * `crm_pulso` — el estado del CRM hoy, en conteos.
 *
 * TODO AGREGADO, CERO PII (§9.1 del spec). No sale de aquí ni un nombre, ni un correo, ni
 * un teléfono: solo cuántos. Un revisor que necesite el detalle de un caso concreto tiene
 * que pedírselo a una persona, y eso es deliberado.
 *
 * Las credenciales de los conectores están cifradas en la columna y NO se leen: el
 * `select` las excluye a mano en vez de traer la fila entera y borrar campos después,
 * porque lo segundo falla en silencio en cuanto alguien agregue una columna sensible.
 */

const DIA = 24 * 60 * 60 * 1000;

export async function pulso(_args: unknown, ctx: RevisionContext) {
  const { db, ahora } = ctx;
  const hace24h = new Date(ahora.getTime() - DIA);
  const hace7d = new Date(ahora.getTime() - 7 * DIA);

  const [
    leads24h,
    leads7d,
    porOrigen,
    porEtapa,
    slaVencidos,
    slaCorriendoVencidos,
    cola,
    colaAgotadas,
    conectores,
    reglasActivas,
    reglasTotales,
    usuarios,
    eventosSinProcesar,
  ] = await Promise.all([
    db.contact.count({ where: { createdAt: { gte: hace24h } } }),
    db.contact.count({ where: { createdAt: { gte: hace7d } } }),
    db.contact.groupBy({
      by: ["leadSource"],
      where: { createdAt: { gte: hace7d } },
      _count: { _all: true },
    }),
    db.deal.groupBy({ by: ["stage"], _count: { _all: true } }),
    db.slaTimer.count({ where: { status: "BREACHED", createdAt: { gte: hace7d } } }),
    // 🚨 El más interesante de todos: sigue RUNNING pero su `dueAt` ya pasó. Es un SLA
    // incumplido que todavía no se marcó como tal — no aparece en el conteo de BREACHED
    // y por eso un tablero que solo mire ese conteo lo reporta todo en verde.
    db.slaTimer.count({ where: { status: "RUNNING", dueAt: { lt: ahora } } }),
    db.actionQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    db.actionQueue.count({
      where: { status: "FAILED", attempts: { gte: 3 } },
    }),
    db.leadConnector.findMany({
      select: {
        name: true,
        provider: true,
        status: true,
        lastSyncAt: true,
        lastLeadAt: true,
        errorCount: true,
      },
      orderBy: { name: "asc" },
    }),
    db.automationRule.count({ where: { isActive: true, deletedAt: null } }),
    db.automationRule.count({ where: { deletedAt: null } }),
    db.user.groupBy({
      by: ["role"],
      where: { isActive: true, deletedAt: null },
      _count: { _all: true },
    }),
    db.workflowEvent.count({
      // Una hora de gracia: lo encolado hace un minuto y sin procesar es normal, no un
      // fallo. Sin ese margen la métrica marca rojo cada vez que se mide.
      where: { processedAt: null, occurredAt: { lt: new Date(ahora.getTime() - 60 * 60 * 1000) } },
    }),
  ]);

  return {
    leads: {
      nuevos_24h: leads24h,
      nuevos_7d: leads7d,
      por_origen_7d: Object.fromEntries(
        porOrigen.map((o) => [o.leadSource, o._count._all]).sort((a, b) => Number(b[1]) - Number(a[1])),
      ),
    },
    deals_por_etapa: Object.fromEntries(porEtapa.map((e) => [e.stage, e._count._all])),
    sla: {
      incumplidos_7d: slaVencidos,
      /** Corriendo con la hora ya pasada: incumplidos que nadie marcó todavía. */
      vencidos_sin_marcar: slaCorriendoVencidos,
    },
    cola_de_acciones: {
      ...Object.fromEntries(cola.map((c) => [c.status.toLowerCase(), c._count._all])),
      /** Fallaron y ya no se reintentan: estas no se recuperan solas. */
      agotadas: colaAgotadas,
    },
    conectores: conectores.map((c) => ({
      nombre: c.name,
      proveedor: c.provider,
      estado: c.status,
      ultima_sincronizacion: c.lastSyncAt?.toISOString() ?? null,
      ultimo_lead: c.lastLeadAt?.toISOString() ?? null,
      errores_acumulados: c.errorCount,
    })),
    automatizaciones: { activas: reglasActivas, totales: reglasTotales },
    usuarios_activos: Object.fromEntries(usuarios.map((u) => [u.role, u._count._all])),
    eventos_sin_procesar: eventosSinProcesar,
  };
}
