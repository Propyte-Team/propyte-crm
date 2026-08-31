import { describe, expect, it } from "vitest";
import { FASE_DEL_PROYECTO, HECHOS_DECLARADOS } from "./contexto.data";
import { ctxFalso, dbFalsa } from "./dobles.testutil";
import { protocolo } from "./handlers/protocolo";
import { pulso } from "./handlers/pulso";
import type { RespuestaRevision } from "./types";

/**
 * El contexto declarado: lo que se ve como problema y no lo es.
 *
 * Estas pruebas cuidan la mitad frágil del mecanismo. Declarar un hecho es fácil; lo que
 * se rompe con el tiempo es la CADUCIDAD — el día que el CRM salga de BETA,
 * «automatizaciones pausadas» pasa de decisión a bug caro, y sin fecha nadie lo vuelve a
 * mirar. Un hecho sin `caduca_cuando` no es contexto: es una venda.
 */

const dbBase = (activas: number, totales: number) =>
  dbFalsa({
    conteos: {
      "contact.count": 10,
      "slaTimer.count": 0,
      "actionQueue.count": 0,
      "workflowEvent.count": 0,
    },
    secuencias: { "automationRule.count": [activas, totales] },
    grupos: {
      "contact.groupBy": [],
      "deal.groupBy": [],
      "actionQueue.groupBy": [],
      "user.groupBy": [],
    },
    listas: {
      "leadConnector.findMany": [
        // Webhook: nada escribe su lastSyncAt, nunca. Es el caso de los 9 reales.
        {
          name: "IG - Propyte",
          provider: "INSTAGRAM",
          status: "ACTIVE",
          lastSyncAt: null,
          lastLeadAt: null,
          errorCount: 0,
        },
        // Pull: tiene cron que sí la escribe.
        {
          name: "TikTok",
          provider: "TIKTOK",
          status: "ACTIVE",
          lastSyncAt: new Date("2026-08-28T10:00:00Z"),
          lastLeadAt: null,
          errorCount: 0,
        },
      ],
    },
  });

type DatosPulso = {
  leads: { reales_7d: number; crudos_7d: number; descontados_7d: number; nota: string };
  automatizaciones: { activas: number; totales: number; nota?: string };
};

describe("hechos declarados", () => {
  it("todos traen caducidad, dueño y fecha", () => {
    expect(HECHOS_DECLARADOS.length).toBeGreaterThan(0);
    for (const h of HECHOS_DECLARADOS) {
      expect(h.caduca_cuando, `${h.id} sin caduca_cuando`).toBeTruthy();
      expect(h.no_reportar, `${h.id} no dice qué NO reportar`).toBeTruthy();
      // Sin dueño y fecha, el hecho no se puede reconfirmar con nadie más adelante.
      expect(h.declarado, `${h.id} sin declarado`).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("los ids son únicos: son la clave con la que el revisor los cita", () => {
    const ids = HECHOS_DECLARADOS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("la fase declara su implicación, no solo su nombre", () => {
    // «beta» a secas no le dice nada al revisor sobre qué sí sigue siendo un hallazgo.
    expect(FASE_DEL_PROYECTO.implicacion).toMatch(/hallazgo/i);
  });
});

describe("crm_pulso y el contexto", () => {
  it("🚨 con 0 activas de 8 adjunta la nota, con su caducidad", async () => {
    // El número desnudo se reporta como fallo todos los días. La nota es lo que lo frena,
    // y la caducidad lo que evita que lo frene para siempre.
    const r = (await pulso({}, ctxFalso({ db: dbBase(0, 8) }))) as unknown as DatosPulso;
    expect(r.automatizaciones).toMatchObject({ activas: 0, totales: 8 });
    expect(r.automatizaciones.nota).toMatch(/BETA/);
    expect(r.automatizaciones.nota).toMatch(/Caduca cuando/);
  });

  it("con reglas activas NO adjunta nota: no hay nada que explicar", async () => {
    const r = (await pulso({}, ctxFalso({ db: dbBase(5, 8) }))) as unknown as DatosPulso;
    expect(r.automatizaciones.nota).toBeUndefined();
  });

  it("sin reglas configuradas tampoco: 0 de 0 no es el caso del BETA", async () => {
    const r = (await pulso({}, ctxFalso({ db: dbBase(0, 0) }))) as unknown as DatosPulso;
    expect(r.automatizaciones.nota).toBeUndefined();
  });

  it("distingue leads reales de crudos y publica la brecha", async () => {
    // Los reportes del CRM usan realLeadWhere. Si la puerta contara distinto, entregaría
    // una tercera versión de la verdad que nadie más ve en pantalla.
    const r = (await pulso({}, ctxFalso({ db: dbBase(0, 8) }))) as unknown as DatosPulso;
    expect(r.leads).toHaveProperty("reales_7d");
    expect(r.leads).toHaveProperty("crudos_7d");
    expect(r.leads.descontados_7d).toBe(r.leads.crudos_7d - r.leads.reales_7d);
    // La nota advierte que el filtro NO cubre el spam de DM: incluso `reales_*` sobrecuenta.
    expect(r.leads.nota).toMatch(/spam/i);
    expect(r.leads.nota).toMatch(/sobrecuenta/);
  });
});

describe("crm_revision_protocolo publica el contexto", () => {
  it("lo trae completo y dice cómo usarlo", async () => {
    const r = (await protocolo({}, ctxFalso())) as RespuestaRevision<{
      contexto_declarado: {
        fase: string;
        hechos: typeof HECHOS_DECLARADOS;
        como_usarlo: string;
      };
      pasos: Array<{ nombre: string; regla: string }>;
    }>;

    expect(r.datos.contexto_declarado.fase).toBe("beta");
    expect(r.datos.contexto_declarado.hechos).toHaveLength(HECHOS_DECLARADOS.length);
    // Lo importante no es publicarlo, es decir qué hacer con él.
    expect(r.datos.contexto_declarado.como_usarlo).toMatch(/NO se crea tarea/);
    // Y que un hecho caducado se vuelva hallazgo urgente, no silencio permanente.
    expect(r.datos.contexto_declarado.como_usarlo).toMatch(/caduca_cuando/);
  });

  it("el paso de descartar manda releerlo: el tablero no lo cubre", async () => {
    // Lo explicado en el contexto nunca llega al tablero, así que el dedup del servidor no
    // puede frenarlo. El único freno es que el revisor lo lea.
    const r = (await protocolo({}, ctxFalso())) as RespuestaRevision<{
      pasos: Array<{ nombre: string; regla: string }>;
    }>;
    const paso2 = r.datos.pasos.find((p) => p.nombre === "Descartar lo ya sabido")!;
    expect(paso2.regla).toMatch(/contexto_declarado/);
  });
});

describe("crm_pulso y los conectores", () => {
  /**
   * El caso que casi produce un hallazgo falso de verdad.
   *
   * Los 9 conectores reales son META/INSTAGRAM/MESSENGER —todos webhook— y su
   * `lastSyncAt` estaba en `null`. Se lee como «llevan meses sin sincronizar». No es
   * cierto: los ÚNICOS crons de conectores del repo son linkedin y tiktok, así que esa
   * columna nunca se escribe para los demás. El dato no estaba mal; la presentación sí.
   */
  it("🚨 a un conector de webhook NO le emite ultima_sincronizacion", async () => {
    const r = (await pulso({}, ctxFalso({ db: dbBase(0, 8) }))) as unknown as {
      conectores: { nota: string; lista: Array<Record<string, unknown>> };
    };

    const ig = r.conectores.lista.find((c) => c.proveedor === "INSTAGRAM")!;
    expect(ig.via).toBe("webhook");
    // Ausente, no nulo: un campo que falta se pregunta, uno nulo se interpreta mal.
    expect(Object.keys(ig)).not.toContain("ultima_sincronizacion");
    expect(ig).toHaveProperty("ultimo_lead");
  });

  it("a uno de pull sí se la emite, porque su cron la escribe", async () => {
    const r = (await pulso({}, ctxFalso({ db: dbBase(0, 8) }))) as unknown as {
      conectores: { lista: Array<Record<string, unknown>> };
    };

    const tk = r.conectores.lista.find((c) => c.proveedor === "TIKTOK")!;
    expect(tk.via).toBe("pull (cron)");
    expect(tk.ultima_sincronizacion).toBe("2026-08-28T10:00:00.000Z");
  });

  /**
   * 🚨 El caso que un humano y yo dimos por bueno, y que el revisor automático corrigió.
   *
   * Yo concluí que «la señal de vida de un webhook es `ultimo_lead`» y lo escribí en la
   * nota. Es falso: `lastLeadAt` solo se escribe dentro de `processIncomingLead` —la vía
   * de formularios de anuncio— y las vías de DM llaman a `captureLead` directamente, sin
   * tocarla. Un conector de INSTAGRAM/MESSENGER activo, recibiendo prospectos todos los
   * días, se queda en `null` para siempre.
   *
   * Consecuencia real: si mañana se cae, el panel se ve EXACTAMENTE igual que hoy.
   */
  it("un conector de webhook sin lastLeadAt sale con senal_de_vida: ninguna", async () => {
    const r = (await pulso({}, ctxFalso({ db: dbBase(0, 8) }))) as unknown as {
      conectores: { nota: string; lista: Array<Record<string, unknown>> };
    };

    const ig = r.conectores.lista.find((c) => c.proveedor === "INSTAGRAM")!;
    // «ninguna» es distinto de «no ha llegado nada»: es «no tenemos forma de saberlo».
    expect(ig.senal_de_vida).toBe("ninguna");

    const tk = r.conectores.lista.find((c) => c.proveedor === "TIKTOK")!;
    expect(tk.senal_de_vida).toBe("ultima_sincronizacion");
  });

  it("la nota ya NO afirma que ultimo_lead sea señal de vida de un webhook", async () => {
    // Guardia contra la regresión exacta: la afirmación falsa llegó a producción una vez.
    const r = (await pulso({}, ctxFalso({ db: dbBase(0, 8) }))) as unknown as {
      conectores: { nota: string };
    };
    expect(r.conectores.nota).toMatch(/TAMPOCO es señal de vida fiable/);
    expect(r.conectores.nota).toMatch(/#653/);
    expect(r.conectores.nota).not.toMatch(/La señal de vida de un webhook es/);
  });
});
