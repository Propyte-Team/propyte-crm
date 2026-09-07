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
    slaPorEstado,
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
    // 🚨 Agrupado por estado, no contando solo los BREACHED. La diferencia es el
    // DENOMINADOR: un `incumplidos_7d: 0` sin total no distingue «cumplimos todo» de
    // «no se creó ni un temporizador», y las dos cosas producen el mismo cero verde.
    // 🚨 #732: agrupado por estado Y POR TIPO. El Pond (#678) sella temporizadores
    // ORPHAN —«nadie pudo tomar este lead»—, que no son atención cumplida ni incumplida:
    // son leads sin dueño. Sumarlos al denominador del cumplimiento hace que un lead que
    // nadie atendió pueda contar como atención cumplida. Se miden aparte.
    db.slaTimer.groupBy({
      by: ["status", "type"],
      where: { createdAt: { gte: hace7d } },
      _count: { _all: true },
    }),
    // 🚨 El más interesante de todos: sigue RUNNING pero su `dueAt` ya pasó. Es un SLA
    // incumplido que todavía no se marcó como tal — no aparece en el conteo de BREACHED
    // y por eso un tablero que solo mire ese conteo lo reporta todo en verde.
    db.slaTimer.count({
      where: { status: "RUNNING", dueAt: { lt: ahora }, type: { not: "ORPHAN" } },
    }),
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

  /**
   * El total del periodo sale de la misma agrupación: no hay una segunda consulta que
   * pueda desincronizarse con la primera.
   */
  // #732: el cumplimiento se mide SOLO sobre los temporizadores de atención
  // (FIRST_TOUCH, RETRY). Los ORPHAN del Pond se publican aparte, nunca dentro del
  // porcentaje: significan «nadie pudo tomar este lead», que es un problema de reparto,
  // no de rapidez de respuesta.
  const esPond = (t: { type: string }) => t.type === "ORPHAN";
  const atencion = slaPorEstado.filter((t) => !esPond(t));
  const pond = slaPorEstado.filter(esPond);

  const porEstado = (filas: typeof slaPorEstado) => {
    const acc: Record<string, number> = {};
    for (const f of filas) acc[f.status] = (acc[f.status] ?? 0) + f._count._all;
    return acc;
  };
  const totalDe = (filas: typeof slaPorEstado) =>
    filas.reduce((suma, f) => suma + f._count._all, 0);

  const slaEstados = porEstado(atencion);
  const slaTotal = totalDe(atencion);
  const slaVencidos = slaEstados.BREACHED ?? 0;

  const pondEstados = porEstado(pond);
  const pondTotal = totalDe(pond);
  const slaPorTipo = Object.fromEntries(
    Object.entries(
      slaPorEstado.reduce<Record<string, number>>((acc, f) => {
        acc[f.type] = (acc[f.type] ?? 0) + f._count._all;
        return acc;
      }, {}),
    ),
  );

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
      /**
       * El denominador, que es lo que hacía falta.
       *
       * El `como_se_mide` de la práctica `sla-primera-respuesta` pide «la proporción de
       * BREACHED sobre el total de temporizadores del periodo». Con solo el numerador esa
       * proporción no se podía calcular, y el cero de incumplidos se leía como verde
       * cuando podía significar que el reloj nunca se echó a andar.
       */
      temporizadores_7d: slaTotal,
      por_estado_7d: slaEstados,
      por_tipo_7d: slaPorTipo,
      incumplidos_7d: slaVencidos,
      /** La lectura correcta de `incumplidos_7d`. `null` cuando no hay denominador. */
      proporcion_incumplidos_7d:
        slaTotal === 0 ? null : Math.round((slaVencidos / slaTotal) * 1000) / 1000,
      /**
       * Corriendo con la hora ya pasada: incumplidos que nadie marcó todavía.
       * #732: excluye los ORPHAN, por la misma razón que el denominador.
       */
      vencidos_sin_marcar: slaCorriendoVencidos,
      /**
       * #732 — El Pond, medido aparte y NUNCA dentro del cumplimiento.
       *
       * Un temporizador ORPHAN significa «ningún asesor pudo quedarse con este lead».
       * Mientras estuvo mezclado con los demás, un lead que nadie atendió podía acabar
       * contando como atención cumplida: con un solo temporizador MET la puerta publicaba
       * 100% de cumplimiento sin que se pudiera saber de qué tipo era.
       *
       * `proporcion_al_pond_7d` es el segundo número que faltaba: qué parte de los leads
       * reales termina sin dueño. Un cumplimiento perfecto con un tercio de los leads en
       * el Pond no es una buena semana.
       */
      pond: {
        temporizadores_7d: pondTotal,
        por_estado_7d: pondEstados,
        proporcion_al_pond_7d:
          reales7d === 0 ? null : Math.round((pondTotal / reales7d) * 1000) / 1000,
      },
      nota:
        slaTotal === 0
          ? "🚨 CERO temporizadores DE ATENCIÓN creados en la ventana (los del Pond, si " +
            "los hay, están en `pond`). `incumplidos_7d: 0` aquí NO " +
            "significa que se cumplió el SLA: significa que no se midió nada. Antes de " +
            "reportar la atención como buena hay que averiguar por qué no se crea ninguno " +
            "—si el ruteo no corre, si la regla que los crea está apagada— porque un cero " +
            "sin denominador no es una métrica, es la ausencia de una."
          : "`temporizadores_7d` cuenta SOLO atención (FIRST_TOUCH y RETRY): los ORPHAN " +
            "del Pond van en `pond` y nunca entran al cumplimiento, porque significan que " +
            "nadie pudo tomar el lead, no que se respondiera tarde. Léelos juntos: un " +
            "cumplimiento alto con `pond.proporcion_al_pond_7d` alta es un problema de " +
            "reparto disfrazado de buena atención. " +
            "`incumplidos_7d` se lee SOBRE `temporizadores_7d`, nunca solo. " +
            "`vencidos_sin_marcar` no está incluido en los incumplidos: sigue RUNNING con la " +
            "hora pasada, así que es incumplimiento que nadie ha marcado todavía y hay que " +
            "sumarlo a mano para leer el peor caso.",
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
        "Para los de webhook la señal de vida es `ultimo_lead`, y desde la tarjeta #653 la " +
        "escriben LAS DOS vías de entrega: los formularios de anuncio y el intake de DM. " +
        "Antes solo la escribía la primera, así que un conector de INSTAGRAM/MESSENGER " +
        "activo y recibiendo prospectos se quedaba en `null` para siempre. " +
        "Ojo con la lectura histórica: un `ultimo_lead: null` anterior al despliegue de esa " +
        "tarjeta no prueba que el conector no entregó, solo que nadie lo anotaba.",
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
           * Con qué se sabría si este conector se cayó: qué campo de esta misma fila hay
           * que mirar. Depende de la vía, no del dato — un `ultimo_lead` nulo significa
           * «no ha entregado», que es una respuesta, no una laguna.
           *
           * Hasta la tarjeta #653 había una tercera opción, `ninguna`, para los conectores
           * de DM: su `lastLeadAt` no lo escribía nadie, así que caídos y sanos se veían
           * igual. Ya lo escriben las dos vías de entrega, así que ese caso desapareció.
           */
          senal_de_vida: pull ? "ultima_sincronizacion" : "ultimo_lead",
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
