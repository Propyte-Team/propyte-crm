import { realLeadWhere } from "@/lib/leads/real-leads";
import { HECHOS_DECLARADOS } from "../contexto.data";
import type { RevisionContext } from "../types";

/**
 * Proveedores que entregan por PULL, es decir los que tienen un cron que les escribe
 * `lastSyncAt`. Verificado contra el código, no supuesto: los únicos crons de conectores
 * en el repo son `api/cron/connectors/linkedin` y `api/cron/connectors/tiktok`.
 *
 * Todo lo demás (META, INSTAGRAM, MESSENGER, WHATSAPP…) llega por webhook, y para esos
 * `lastSyncAt` no se escribe NUNCA. Servirlo como `null` hizo que casi reportara «9
 * conectores llevan meses sin sincronizar» sobre un sistema que funcionaba bien.
 */
const PROVEEDORES_PULL = new Set(["LINKEDIN", "TIKTOK"]);

function esPull(proveedor: string): boolean {
  return PROVEEDORES_PULL.has(proveedor);
}

/** El hecho declarado que explica «0 automatizaciones activas», con su caducidad. */
function notaDeAutomatizaciones(): string {
  const h = HECHOS_DECLARADOS.find((x) => x.id === "automatizaciones-pausadas-por-beta");
  return h ? `${h.por_que} ${h.no_reportar} Caduca cuando: ${h.caduca_cuando}` : "";
}

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
    crudos24h,
    crudos7d,
    reales24h,
    reales7d,
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
    // Crudo: todo lo que entró. Sirve solo para medir la brecha, nunca como volumen.
    db.contact.count({ where: { createdAt: { gte: hace24h } } }),
    db.contact.count({ where: { createdAt: { gte: hace7d } } }),
    // 🚨 `realLeadWhere` es LA definición de lead del CRM, la misma que usan el tablero,
    // las metas, `/reportes` y Vista Hoy. Contar por nuestra cuenta daría un número que
    // contradice al que el equipo mira en pantalla, y entonces la puerta no reporta el
    // estado del CRM: reporta el de una tercera versión de la verdad que nadie más ve.
    db.contact.count({ where: realLeadWhere({ createdAt: { gte: hace24h } }) }),
    db.contact.count({ where: realLeadWhere({ createdAt: { gte: hace7d } }) }),
    db.contact.groupBy({
      by: ["leadSource"],
      where: realLeadWhere({ createdAt: { gte: hace7d } }),
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
      /** La cifra buena: el mismo filtro que el tablero, las metas y `/reportes`. */
      reales_24h: reales24h,
      reales_7d: reales7d,
      /** Sin filtro. NO usar como volumen: incluye contactos que nunca levantaron la mano. */
      crudos_24h: crudos24h,
      crudos_7d: crudos7d,
      /** La brecha. Es esperada, no un hallazgo. */
      descontados_7d: crudos7d - reales7d,
      /** Ya filtrado. */
      por_origen_7d: Object.fromEntries(
        porOrigen.map((o) => [o.leadSource, o._count._all]).sort((a, b) => Number(b[1]) - Number(a[1])),
      ),
      nota:
        "`reales_*` aplica realLeadWhere (descuenta los contactos nacidos de un comentario " +
        "que nunca contestaron). Los canales sociales además traen spam que este filtro " +
        "todavía NO cubre, así que incluso `reales_*` sobrecuenta en INSTAGRAM y MESSENGER. " +
        "Ver crm_revision_protocolo → contexto_declarado.",
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
    conectores: {
      nota:
        "`ultima_sincronizacion` SOLO existe para los proveedores de tipo pull: son los " +
        "únicos con cron que la escribe. Para los de webhook el campo ni siquiera se emite, " +
        "porque un `null` ahí se lee como «lleva meses sin sincronizar» cuando en realidad " +
        "esa columna nunca les aplicó. " +
        "🚨 Y `ultimo_lead` TAMPOCO es señal de vida fiable: solo se escribe dentro de " +
        "`processIncomingLead` (la vía de formularios de anuncio). Los leads que entran por " +
        "DM llaman a `captureLead` directamente y no la tocan nunca, así que un conector de " +
        "INSTAGRAM/MESSENGER activo y recibiendo prospectos puede quedarse en `null` para " +
        "siempre. Los que salen con `senal_de_vida: \"ninguna\"` no se pueden monitorear hoy " +
        "— es la tarea #653 del tablero, no un hallazgo nuevo.",
      lista: conectores.map((c) => {
        const pull = esPull(c.provider);
        return {
          nombre: c.name,
          proveedor: c.provider,
          estado: c.status,
          via: pull ? "pull (cron)" : "webhook",
          // El campo se OMITE en los de webhook en vez de mandarse nulo. Un campo ausente
          // se pregunta; un nulo se interpreta, y se interpreta mal.
          ...(pull ? { ultima_sincronizacion: c.lastSyncAt?.toISOString() ?? null } : {}),
          ultimo_lead: c.lastLeadAt?.toISOString() ?? null,
          /**
           * Con qué se sabría si este conector se cayó.
           *
           * `ninguna` no es un adorno: significa que si mañana deja de entregar, el panel se
           * ve EXACTAMENTE igual que hoy. Decirlo aquí evita que el revisor lea `ultimo_lead:
           * null` como «no ha llegado nada» cuando el dato correcto es «no tenemos forma de
           * saberlo».
           */
          senal_de_vida: pull ? "ultima_sincronizacion" : c.lastLeadAt ? "ultimo_lead" : "ninguna",
          errores_acumulados: c.errorCount,
        };
      }),
    },
    automatizaciones: {
      activas: reglasActivas,
      totales: reglasTotales,
      // El número nunca se sirve desnudo: leído solo, «0 de 8» se reporta como fallo, y
      // durante el BETA es una decisión. El hecho declarado trae su fecha de caducidad.
      ...(reglasActivas === 0 && reglasTotales > 0 ? { nota: notaDeAutomatizaciones() } : {}),
    },
    usuarios_activos: Object.fromEntries(usuarios.map((u) => [u.role, u._count._all])),
    eventos_sin_procesar: eventosSinProcesar,
  };
}
