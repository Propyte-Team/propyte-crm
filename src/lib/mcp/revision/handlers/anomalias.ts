import { realLeadWhere } from "@/lib/leads/real-leads";
import type { RevisionContext } from "../types";

/**
 * `crm_anomalias` — cada serie contra su propia mediana, no contra una expectativa.
 *
 * Es lo que convierte "hay 14 leads" en "hay 14 leads y la mediana de los últimos 14 días
 * es 60". El primer dato no es accionable; el segundo es un hallazgo con cifra.
 *
 * 🚨 EL DÍA EN CURSO ES UN BORRADOR. Comparar el día de hoy —que va a la mitad— contra
 * medianas de días completos hace que TODA serie se vea baja, todos los días, hasta la
 * medianoche. Es un modo de falla ya pagado en esta casa con los datos intradía de Google
 * Ads. Por eso la comparación se hace sobre el ÚLTIMO DÍA COMPLETO, y lo de hoy se
 * devuelve aparte, rotulado como parcial y sin comparar contra nada.
 *
 * La mediana se usa en vez del promedio porque un solo día con una campaña grande mueve
 * el promedio lo bastante como para esconder una caída real durante dos semanas.
 */

const DIA = 24 * 60 * 60 * 1000;
const VENTANA_DIAS = 14;

/** Clave `YYYY-MM-DD` en UTC. La zona no se adivina: se declara. */
function claveDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

/** Cuenta por día a partir de las fechas crudas. Sin SQL raw: el tipo de `db` no lo permite. */
function contarPorDia(fechas: Date[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of fechas) m.set(claveDia(f), (m.get(claveDia(f)) ?? 0) + 1);
  return m;
}

/**
 * Regla de señal, declarada en vez de implícita: se marca cuando el valor sale del rango
 * [mediana/2, mediana×2] **y** además se aleja al menos 3 unidades.
 *
 * El segundo requisito existe porque sin él una serie que va de 1 a 3 se reporta como
 * "triplicó" todos los días, y ese ruido entrena a ignorar la herramienta.
 */
function senal(valor: number, med: number, historia: number): "alto" | "bajo" | "normal" | "sin_historia" {
  if (historia < 7) return "sin_historia";
  if (Math.abs(valor - med) < 3) return "normal";
  if (valor > med * 2) return "alto";
  if (valor < med / 2) return "bajo";
  return "normal";
}

export async function anomalias(_args: unknown, ctx: RevisionContext) {
  const { db, ahora } = ctx;
  // Se arranca en el corte de hoy y se retrocede: así el "último día completo" es ayer
  // entero, sin depender de la hora a la que corra la revisión.
  const corteHoy = new Date(`${claveDia(ahora)}T00:00:00.000Z`);
  const desde = new Date(corteHoy.getTime() - VENTANA_DIAS * DIA);

  const [contactos, deals, accionesFallidas, leadsConError, slaIncumplidos, eventos, corridas] = await Promise.all([
    // Con el filtro del CRM: la serie tiene que medir lo mismo que `/reportes`, o la
    // mediana se calcula sobre spam y la señal deja de significar nada.
    db.contact.findMany({ where: realLeadWhere({ createdAt: { gte: desde } }), select: { createdAt: true } }),
    db.deal.findMany({ where: { createdAt: { gte: desde } }, select: { createdAt: true } }),
    db.actionQueue.findMany({
      where: { status: "FAILED", createdAt: { gte: desde } },
      select: { createdAt: true },
    }),
    db.connectorLeadLog.findMany({
      where: { status: "ERROR", receivedAt: { gte: desde } },
      select: { receivedAt: true },
    }),
    db.slaTimer.findMany({
      where: { status: "BREACHED", createdAt: { gte: desde } },
      select: { createdAt: true },
    }),
    /**
     * La cola de eventos es un STOCK, no un flujo: importa cuántos quedaban PENDIENTES
     * al cierre de cada día, no cuántos entraron. Por eso se traen las dos fechas y el
     * backlog se reconstruye por día — con `processedAt` se sabe hasta qué día estuvo
     * pendiente cada evento, así que la serie histórica es exacta y no una estimación.
     *
     * El `OR` con `processedAt: null` es lo que evita el sesgo: un evento viejo que sigue
     * sin procesarse está fuera de la ventana por `occurredAt` pero pesa en el backlog de
     * TODOS los días. Omitirlo haría que la cola atascada se viera vacía.
     */
    db.workflowEvent.findMany({
      where: { OR: [{ occurredAt: { gte: desde } }, { processedAt: null }] },
      select: { occurredAt: true, processedAt: true },
    }),
    db.agentRun.findMany({
      where: { startedAt: { gte: desde } },
      select: { startedAt: true, status: true, output: true },
    }),
  ]);

  const series: Record<string, Date[]> = {
    leads_reales_nuevos: contactos.map((x) => x.createdAt),
    deals_nuevos: deals.map((x) => x.createdAt),
    acciones_fallidas: accionesFallidas.map((x) => x.createdAt),
    leads_de_conector_con_error: leadsConError.map((x) => x.receivedAt),
    sla_incumplidos: slaIncumplidos.map((x) => x.createdAt),
    /**
     * Que los agentes SIGAN CORRIENDO. Es la señal que pide la práctica
     * `automatizaciones-vivas` y la única que detecta el modo de falla más silencioso de
     * todos: que dejen de dispararse. Cero corridas no produce ningún error en ningún
     * log — simplemente no pasa nada.
     */
    corridas_de_agente: corridas.map((x) => x.startedAt),
    corridas_de_agente_fallidas: corridas
      .filter((x) => x.status === "FAILED")
      .map((x) => x.startedAt),
    /**
     * 🚨 Cerradas como exitosas y con la salida VACÍA. Es la huella de una corrida que se
     * quedó a medias, y se cuenta por el PATRÓN y no por el estado: así la serie detecta
     * el caso aunque el status siga diciendo que todo salió bien (tarjeta #654).
     */
    corridas_de_agente_sin_conclusion: corridas
      .filter((x) => x.status === "COMPLETED" && !(x.output ?? "").trim())
      .map((x) => x.startedAt),
  };

  // Las claves de los días previos, del más viejo al más nuevo, SIN incluir hoy.
  const diasPrevios: string[] = [];
  for (let i = VENTANA_DIAS; i >= 1; i--) {
    diasPrevios.push(claveDia(new Date(corteHoy.getTime() - i * DIA)));
  }
  const ayer = diasPrevios[diasPrevios.length - 1];
  const anteriores = diasPrevios.slice(0, -1);

  const comparadas: Record<string, unknown> = {};
  const parcialHoy: Record<string, number> = {};

  /** Cuántos eventos seguían sin procesar en un instante dado. */
  const backlogEn = (corte: Date) =>
    eventos.filter(
      (e) => e.occurredAt <= corte && (e.processedAt === null || e.processedAt > corte),
    ).length;

  for (const [nombre, fechas] of Object.entries(series)) {
    const porDia = contarPorDia(fechas);
    const historicos = anteriores.map((d) => porDia.get(d) ?? 0);
    const valorAyer = porDia.get(ayer) ?? 0;
    const med = mediana(historicos);

    comparadas[nombre] = {
      ultimo_dia_completo: valorAyer,
      mediana_13_dias_previos: med,
      desviacion: Number((valorAyer - med).toFixed(2)),
      senal: senal(valorAyer, med, historicos.length),
    };
    parcialHoy[nombre] = porDia.get(claveDia(ahora)) ?? 0;
  }

  /**
   * La cola de eventos, medida como stock al cierre de cada día.
   *
   * Va por fuera del bucle porque las otras cinco series cuentan CUÁNTOS pasaron y esta
   * cuenta CUÁNTOS quedaban. El manual del propio CRM dice que la alarma es que este
   * número crezca día con día —significa que el cron que los consume dejó de correr— y
   * un conteo puntual no puede mostrar crecimiento: cada día se compara contra nada.
   */
  const cierres: Date[] = [];
  for (let i = VENTANA_DIAS; i >= 1; i--) {
    // El cierre del día `i` atrás es el corte del día siguiente.
    cierres.push(new Date(corteHoy.getTime() - (i - 1) * DIA));
  }
  const backlogs = cierres.map(backlogEn);
  const backlogAyer = backlogs[backlogs.length - 1];
  const backlogPrevios = backlogs.slice(0, -1);
  const medBacklog = mediana(backlogPrevios);

  comparadas.eventos_sin_procesar = {
    ultimo_dia_completo: backlogAyer,
    mediana_13_dias_previos: medBacklog,
    desviacion: Number((backlogAyer - medBacklog).toFixed(2)),
    senal: senal(backlogAyer, medBacklog, backlogPrevios.length),
    nota:
      "Es un STOCK —cuántos quedaban pendientes al cierre del día—, no un flujo. Un valor " +
      "que crece día con día significa que el cron que los consume dejó de correr, aunque " +
      "ningún log reporte error. Su cifra de hoy es el backlog AHORA MISMO, que sí es un " +
      "dato completo: la advertencia de día parcial no le aplica.",
  };
  parcialHoy.eventos_sin_procesar = backlogEn(ahora);

  return {
    /** La comparación válida: un día completo contra la mediana de los 13 anteriores. */
    dia_comparado: ayer,
    series: comparadas,
    /**
     * Lo que va del día de hoy. NO SE COMPARA con nada: está incompleto por definición y
     * cualquier lectura de "está bajo" sería un artefacto de la hora, no una señal.
     */
    hoy_parcial: {
      advertencia:
        "El día en curso está incompleto. Estos números NO son comparables contra las medianas " +
        "y no deben usarse como evidencia de un hallazgo.",
      fecha: claveDia(ahora),
      conteos: parcialHoy,
    },
    regla_de_senal:
      "Se marca `alto`/`bajo` cuando el valor sale del rango [mediana/2, mediana×2] y además " +
      "se aleja al menos 3 unidades. Con menos de 7 días de historia se devuelve `sin_historia`.",
  };
}
