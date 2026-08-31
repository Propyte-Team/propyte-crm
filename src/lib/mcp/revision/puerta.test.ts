import { describe, expect, it } from "vitest";
import { AHORA, ctxFalso, dbFalsa, githubFalso } from "./dobles.testutil";
import { REVISION_TOOLS } from "./tools";
import type { RespuestaRevision } from "./types";

/**
 * Prueba de la puerta entera: las nueve tools, contra dobles.
 *
 * Las dos invariantes que aquí se prueban son las que sostienen todo lo demás: que TODA
 * respuesta viene rotulada, y que por la puerta NO SALE UN SOLO DATO PERSONAL. Si alguna
 * de las dos se rompe, el resto del sistema sigue funcionando y produciendo daño en
 * silencio — hallazgos incitables la primera, una fuga la segunda.
 */

/** Correo, teléfono y nombre metidos donde de verdad se escapan: los mensajes de error. */
const CORREO_SEMBRADO = "ana.lopez@gmail.com";
const TEL_SEMBRADO = "+52 998 123 4567";

const dbCompleta = () =>
  dbFalsa({
    conteos: {
      "contact.count": 14,
      "slaTimer.count": 3,
      "actionQueue.count": 5,
      "automationRule.count": 9,
      "workflowEvent.count": 2,
    },
    grupos: {
      "contact.groupBy": [{ leadSource: "META_ADS", _count: { _all: 9 } }],
      "deal.groupBy": [{ stage: "NEW_LEAD", _count: { _all: 4 } }],
      "actionQueue.groupBy": [{ status: "FAILED", _count: { _all: 5 } }],
      "user.groupBy": [{ role: "ASESOR_SR", _count: { _all: 3 } }],
      "slaTimer.groupBy": [{ type: "FIRST_RESPONSE", _count: { _all: 3 } }],
      "workflowEvent.groupBy": [{ type: "contact.created", _count: { _all: 2 } }],
    },
    listas: {
      "leadConnector.findMany": [
        {
          name: "Meta Lead Ads",
          provider: "META",
          status: "ACTIVE",
          lastSyncAt: new Date("2026-08-28T10:00:00Z"),
          lastLeadAt: new Date("2026-08-28T09:00:00Z"),
          errorCount: 2,
        },
      ],
      "actionQueue.findMany": [
        {
          createdAt: new Date("2026-08-27T10:00:00Z"),
          actionType: "SEND_WHATSAPP",
          error: `No se pudo enviar a ${TEL_SEMBRADO}: número inválido`,
          finishedAt: new Date("2026-08-27T10:01:00Z"),
          attempts: 3,
          maxAttempts: 3,
        },
      ],
      "connectorLeadLog.findMany": [
        {
          receivedAt: new Date("2026-08-27T11:00:00Z"),
          errorDetail: `Campo email inválido: ${CORREO_SEMBRADO} (lead 7f3a1b2c-1111-2222-3333-444455556666)`,
          connector: { name: "Meta Lead Ads" },
        },
      ],
      "workflowEvent.findMany": [
        { occurredAt: new Date("2026-08-27T09:00:00Z"), processedAt: null },
        {
          occurredAt: new Date("2026-08-26T09:00:00Z"),
          processedAt: new Date("2026-08-26T09:05:00Z"),
        },
      ],
      "agentRun.findMany": [
        {
          startedAt: new Date("2026-08-27T12:00:00Z"),
          status: "FAILED",
          output: null,
          trigger: "inbound_message",
          error: `Timeout consultando al contacto ${CORREO_SEMBRADO}`,
          endedAt: new Date("2026-08-27T12:00:00Z"),
        },
      ],
      "contact.findMany": [{ createdAt: new Date("2026-08-27T10:00:00Z") }],
      "deal.findMany": [{ createdAt: new Date("2026-08-27T10:00:00Z") }],
      "slaTimer.findMany": [{ createdAt: new Date("2026-08-27T10:00:00Z") }],
    },
  });

const ctx = () => ctxFalso({ db: dbCompleta(), gh: githubFalso() });

/** Las tools que no reciben argumentos obligatorios se pueden llamar con `{}`. */
const ARGS: Record<string, unknown> = {
  crm_codigo_leer: { path: "src/a.ts" },
  crm_codigo_buscar: { patron: "SlaPolicy" },
};

describe("la puerta de revisión, de punta a punta", () => {
  it.each(REVISION_TOOLS.map((t) => [t.name, t] as const))(
    "%s devuelve el sobre de rotulado completo",
    async (nombre, tool) => {
      const r = (await tool.handler(ARGS[nombre] ?? {}, ctx())) as RespuestaRevision<unknown>;

      expect(r.sobre, `${nombre} sin sobre`).toBeDefined();
      expect(r.sobre.ref).toBeTruthy();
      expect(r.sobre.alcance).toBeTruthy();
      expect(r.sobre.medido_en).toBe(AHORA.toISOString());
      expect(r).toHaveProperty("datos");
    },
  );

  it("las tools de código rotulan el SHA; las de datos lo dejan explícitamente nulo", async () => {
    // Un hallazgo de datos citado con el SHA de otra llamada sería una cita falsa. Por eso
    // `sha: null` es un valor deliberado y no un olvido.
    const porNombre = Object.fromEntries(REVISION_TOOLS.map((t) => [t.name, t]));

    const codigo = (await porNombre.crm_codigo_arbol.handler({}, ctx())) as RespuestaRevision<unknown>;
    expect(codigo.sobre.sha).toMatch(/^[0-9a-f]{40}$/);

    const datos = (await porNombre.crm_pulso.handler({}, ctx())) as RespuestaRevision<unknown>;
    expect(datos.sobre.sha).toBeNull();
  });

  it("🚨 NINGUNA tool deja salir un correo, un teléfono ni un UUID", async () => {
    // Los conteos no son el riesgo: el riesgo son los mensajes de error, que traen el
    // payload que reventó. Aquí van sembrados a propósito en los tres orígenes que sí
    // producen texto libre.
    for (const tool of REVISION_TOOLS) {
      const r = await tool.handler(ARGS[tool.name] ?? {}, ctx());
      const texto = JSON.stringify(r);

      expect(texto, `${tool.name} filtró un correo`).not.toContain(CORREO_SEMBRADO);
      expect(texto, `${tool.name} filtró un teléfono`).not.toMatch(/998[\s-]?123[\s-]?4567/);
      expect(texto, `${tool.name} filtró un UUID`).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
    }
  });

  it("crm_fallos agrupa y conserva el motivo, ya redactado", async () => {
    const tool = REVISION_TOOLS.find((t) => t.name === "crm_fallos")!;
    const r = (await tool.handler({}, ctx())) as RespuestaRevision<{
      leads_de_conector_perdidos: Array<{ ejemplo: string; casos: number }>;
      acciones_agotadas: number;
      limitacion_declarada: string;
    }>;

    const perdido = r.datos.leads_de_conector_perdidos[0];
    expect(perdido.casos).toBe(1);
    // El motivo sigue siendo legible —«Campo email inválido»— sin el dato de la persona.
    expect(perdido.ejemplo).toContain("Campo email inválido");
    expect(perdido.ejemplo).toContain("«correo»");

    expect(r.datos.acciones_agotadas).toBe(1);
    // Un vacío significa «sin fallos de negocio», nunca «sin errores».
    expect(r.datos.limitacion_declarada).toMatch(/runtime|500s/);
  });

  it("crm_anomalias compara el último día completo y aparta lo de hoy", async () => {
    // Comparar el día en curso contra medianas de días completos marca TODA serie en rojo
    // hasta la medianoche. La separación es la que evita ese artefacto.
    const tool = REVISION_TOOLS.find((t) => t.name === "crm_anomalias")!;
    const r = (await tool.handler({}, ctx())) as RespuestaRevision<{
      dia_comparado: string;
      hoy_parcial: { fecha: string; advertencia: string };
      series: Record<string, { ultimo_dia_completo: number }>;
    }>;

    expect(r.datos.dia_comparado).toBe("2026-08-27");
    expect(r.datos.hoy_parcial.fecha).toBe("2026-08-28");
    expect(r.datos.hoy_parcial.advertencia).toMatch(/NO son comparables/);
    expect(r.datos.series.leads_reales_nuevos.ultimo_dia_completo).toBe(1);
  });

  it("crm_revision_protocolo obliga a pedir las descartadas explícitamente", async () => {
    // Es el paso que evita re-proponer cada día justo lo que ya fue rechazado, porque
    // `mejoras_list_tasks` las oculta por default.
    const tool = REVISION_TOOLS.find((t) => t.name === "crm_revision_protocolo")!;
    const r = (await tool.handler({}, ctx())) as RespuestaRevision<{
      pasos: Array<{ nombre: string; hacer?: string[]; regla: string }>;
      criterio_de_exito: string;
    }>;

    const paso2 = r.datos.pasos.find((p) => p.nombre === "Descartar lo ya sabido")!;
    expect(paso2.hacer?.some((h) => h.includes("descartada"))).toBe(true);
    expect(r.datos.criterio_de_exito).toMatch(/CERO tareas/);
  });

  it("crm_practicas rota las sugeridas por día y todas traen criterio de medición", async () => {
    const tool = REVISION_TOOLS.find((t) => t.name === "crm_practicas")!;
    const hoy = (await tool.handler({}, ctx())) as RespuestaRevision<{
      sugeridas_hoy: string[];
      practicas: Array<{ id: string; como_se_mide: string; ya_existe_si: string }>;
    }>;
    const manana = (await tool.handler(
      {},
      ctxFalso({ db: dbCompleta(), ahora: new Date("2026-08-29T15:00:00.000Z") }),
    )) as RespuestaRevision<{ sugeridas_hoy: string[] }>;

    expect(hoy.datos.sugeridas_hoy).toHaveLength(2);
    // Sin rotación del servidor, el agente elegiría la primera de la lista todos los días.
    expect(manana.datos.sugeridas_hoy).not.toEqual(hoy.datos.sugeridas_hoy);

    for (const p of hoy.datos.practicas) {
      expect(p.como_se_mide, `${p.id} sin criterio de medición`).toBeTruthy();
      expect(p.ya_existe_si, `${p.id} sin criterio de existencia`).toBeTruthy();
    }
  });
});
