import { describe, it, expect } from "vitest";
import {
  ACCIONES, GRUPOS_DE_ACCION, accionPorTipo, camposVisibles, opcionesDeCampo, configParaGuardar,
  describirRetraso, describeAction, describeActions, describeRule, describeStep, validarAccion,
  fuentesDesdeRespuesta,
} from "./action-catalog";
import { workflowActionTypes, actionSpecSchema } from "@/lib/validations/rebuild-f1";
import { CANONICAL_RULES } from "./canonical-rules.fixture";
import { RULE_TEMPLATES } from "./builder-templates";

const RAW = /[A-Z]{3,}_[A-Z_]+|\b[a-z]+_[a-z_]+\b|\b\w+\.\w+\b/; // WF_CLAVE, snake_case, a.b

describe("cobertura del catálogo de acciones", () => {
  it("cada workflowActionType está en el catálogo, con grupo válido e icono", () => {
    for (const t of workflowActionTypes) {
      const a = accionPorTipo(t);
      expect(a, t).toBeDefined();
      expect(GRUPOS_DE_ACCION).toContain(a!.grupo);
      expect(a!.icono).toBeTruthy();
      expect(a!.label).not.toMatch(/^[^\p{L}]/u); // sin emoji
    }
    expect(ACCIONES).toHaveLength(workflowActionTypes.length);
  });
  it("solo AI_CALL_SUMMARY es próximamente (ai-actions.ts siempre la omite)", () => {
    expect(ACCIONES.filter((a) => a.estado === "proximamente").map((a) => a.type)).toEqual(["AI_CALL_SUMMARY"]);
  });
  it("los campos son los que el motor lee", () => {
    const claves = (t: string) => camposVisibles(t).map((c) => c.key);
    expect(claves("SEND_WHATSAPP")).toEqual(["template", "body"]);
    expect(claves("SEND_EMAIL")).toEqual(["template", "subject", "body"]);
    expect(claves("NOTIFY")).toEqual(["title", "message", "type"]);
    expect(claves("CREATE_TASK")).toEqual(["subject", "description", "dueInMinutes"]);
    expect(claves("MAKE_CALL")).toEqual(["subject", "reason", "dueInMinutes"]);
    expect(claves("ENROLL_PLAN")).toEqual(["planId"]);
    expect(claves("CHANGE_STAGE")).toEqual(["toStage"]);
    expect(claves("SET_LIFECYCLE")).toEqual(["toStage", "allowBackward"]);
    expect(claves("ADD_TAG")).toEqual(["tag"]);
    expect(claves("UPDATE_FIELD")).toEqual(["field", "value"]);
    expect(claves("ESCALATE")).toEqual(["reason"]);
    expect(claves("ASSIGN")).toEqual(["reason"]);
    expect(claves("REASSIGN")).toEqual(["reason"]);
    expect(claves("AI_REPLY")).toEqual(["goal"]);
    expect(claves("AI_DRAFT")).toEqual(["kind"]);
    expect(claves("WEBHOOK")).toEqual(["url"]);
  });
  it("campos de fuente apuntan a la fuente correcta", () => {
    expect(camposVisibles("SEND_WHATSAPP")[0]).toMatchObject({ kind: "fuente", fuente: "plantillas_whatsapp" });
    expect(camposVisibles("SEND_EMAIL")[0]).toMatchObject({ kind: "fuente", fuente: "plantillas_email" });
    expect(camposVisibles("ENROLL_PLAN")[0]).toMatchObject({ kind: "fuente", fuente: "cadencias" });
  });
  it("UPDATE_FIELD: el valor depende del dato y contactType/leadSource no ofrecen valores retirados", () => {
    const [campo, valor] = camposVisibles("UPDATE_FIELD");
    expect(Object.keys(opcionesDeCampo(campo, {})!).sort()).toEqual(["contactStatus", "contactType", "leadSource", "temperature", "urgency"]);
    expect(opcionesDeCampo(valor, { field: "temperature" })).toHaveProperty("HOT");
    expect(opcionesDeCampo(valor, { field: "contactType" })).not.toHaveProperty("REFERIDOR");
    expect(opcionesDeCampo(valor, { field: "leadSource" })).not.toHaveProperty("REFERIDO_BROKER");
    expect(opcionesDeCampo(valor, {})).toBeUndefined();
  });
});

describe("retraso en config.delayMinutes", () => {
  it("describeAction lo muestra y validarAccion lo valida", () => {
    expect(describeAction({ type: "CREATE_TASK", config: { subject: "x", delayMinutes: 1440 } }, undefined, { conRetraso: true })).toContain("(tras 1 día)");
    expect(describeAction({ type: "CREATE_TASK", config: { subject: "x", delayMinutes: 1440 }, delayMinutes: 60 }, undefined, { conRetraso: true })).toContain("(tras 1 h");
    expect(validarAccion({ type: "CREATE_TASK", config: { subject: "x", delayMinutes: -1 } }).problemas.join()).toContain("retraso");
  });
});

describe("describeAction", () => {
  const fuentes = fuentesDesdeRespuesta({
    plantillas: [{ id: "t1", nombre: "Bienvenida" }, { id: "t2", nombre: "Seguimiento" }],
    cadencias: [{ id: "p1", nombre: "Seguimiento 7 días" }],
    usuarios: [{ id: "u1", nombre: "Ana" }],
  });
  it("usa nombres de las fuentes (por id o por clave)", () => {
    expect(describeAction({ type: "SEND_WHATSAPP", config: { template: "t1" } }, fuentes)).toBe("enviar WhatsApp «Bienvenida»");
    expect(describeAction({ type: "SEND_WHATSAPP", config: { template: "Seguimiento" } }, fuentes)).toBe("enviar WhatsApp «Seguimiento»");
    expect(describeAction({ type: "ENROLL_PLAN", config: { planId: "p1" } }, fuentes)).toBe("inscribir en la cadencia «Seguimiento 7 días»");
  });
  it("sin fuentes humaniza la clave; con fuentes y cadencia inexistente lo dice", () => {
    expect(describeAction({ type: "SEND_WHATSAPP", config: { template: "bienvenida_postventa" } })).toBe("enviar WhatsApp «Bienvenida postventa»");
    expect(describeAction({ type: "ENROLL_PLAN", config: { planId: "9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" } })).toBe("inscribir en una cadencia");
    expect(describeAction({ type: "ENROLL_PLAN", config: { planId: "9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" } }, fuentes)).toBe("inscribir en una cadencia que ya no existe");
  });
  it("frases de cada acción", () => {
    const f = (type: string, config: Record<string, unknown> = {}) => describeAction({ type, config });
    expect(f("SEND_WHATSAPP", { body: "Hola" })).toBe("enviar un WhatsApp con mensaje propio");
    expect(f("SEND_EMAIL", { subject: "Hola" })).toBe("enviar correo «Hola»");
    expect(f("NOTIFY")).toBe("avisar al asesor");
    expect(f("NOTIFY", { title: "Lead nuevo" })).toBe("avisar al asesor: «Lead nuevo»");
    expect(f("CREATE_TASK", { subject: "Enviar cotización", dueInMinutes: 1440 })).toBe("crear la tarea «Enviar cotización» (vence en 1 día)");
    expect(f("MAKE_CALL")).toBe("crear una tarea de llamada");
    expect(f("ASSIGN")).toBe("asignar asesor");
    expect(f("REASSIGN")).toBe("reasignar asesor");
    expect(f("CHANGE_STAGE", { toStage: "WON" })).toMatch(/^mover el negocio a «.+»$/);
    expect(f("SET_LIFECYCLE", { toStage: "SQL", allowBackward: true })).toMatch(/aunque retroceda/);
    expect(f("ADD_TAG", { tag: "vip" })).toBe("agregar la etiqueta «vip»");
    expect(f("UPDATE_FIELD", { field: "leadSource", value: "META_ADS" })).toMatch(/^cambiar fuente a «.+»$/);
    expect(f("ESCALATE")).toBe("escalar al líder o a la gerencia");
    expect(f("AI_REPLY", { goal: "saludo_calificacion" })).toBe("el bot responde (saludo y calificación)");
    expect(f("AI_DRAFT", { kind: "reactivacion" })).toBe("preparar un borrador con IA (reactivación)");
    expect(f("AI_DRAFT", { goal: "seguimiento" })).toBe("preparar un borrador con IA (seguimiento)");
    expect(f("AI_CALL_SUMMARY")).toBe("resumir la llamada con IA");
    expect(f("WEBHOOK", { url: "https://hooks.example.com/x" })).toBe("avisar a un servicio externo (hooks.example.com)");
  });
  it("retraso de primer nivel (el único que lee el motor)", () => {
    const a = { type: "ASSIGN", delayMinutes: 1440 };
    expect(describeAction(a)).toBe("asignar asesor");
    expect(describeAction(a, undefined, { conRetraso: true })).toBe("asignar asesor (tras 1 día)");
    // delayMinutes dentro de config también lo lee el motor (walkNodes): se muestra.
    expect(describeAction({ type: "ASSIGN", config: { delayMinutes: 1440 } }, undefined, { conRetraso: true })).toBe("asignar asesor (tras 1 día)");
  });
  it("nodo de decisión y tipo desconocido", () => {
    expect(describeAction({ type: "x", kind: "decision", branches: [{}, {}] })).toBe("decidir según condiciones (2 ramas)");
    expect(describeAction({ type: "NUEVA_ACCION" })).toBe("nueva accion");
  });
  it("describirRetraso", () => {
    expect(describirRetraso(0)).toBe("de inmediato");
    expect(describirRetraso(15)).toBe("tras 15 min");
    expect(describirRetraso(60)).toBe("tras 1 h");
    expect(describirRetraso(2880)).toBe("tras 2 días");
    expect(describirRetraso(90)).toBe("tras 90 min");
  });
});

describe("describeRule — las 8 reglas canónicas", () => {
  const por = Object.fromEntries(CANONICAL_RULES.map((r) => [r.name, describeRule(r)]));

  it("WF1", () => {
    expect(por.WF1).toBe(
      "Cuando entra un lead · si fuente es alguno de Facebook Ads, Google Ads, TikTok Ads, Sitio web, WhatsApp, Instagram" +
      " · entonces asignar asesor → el bot responde (saludo y calificación) → avisar al asesor",
    );
  });
  it("WF1 con la forma del spec (empieza con la frase y las partes)", () => {
    expect(por.WF1).toMatch(/^Cuando entra un lead · si fuente es alguno de .+ · entonces asignar asesor → /);
  });
  it("sin condiciones se omite el «si»", () => {
    expect(por.WF5).not.toContain(" si ");
    expect(por.WF5).toMatch(/^Cuando cambia de etapa a .+ · entonces crear la tarea «Checklist KYC \(expediente\)» \(vence en 1 día\) → avisar al asesor \(tras 2 días\) → avisar al asesor \(tras 5 días\)$/);
    expect(por.WF8).toMatch(/^Cuando se gana un negocio · entonces enviar WhatsApp «Bienvenida postventa» → enviar correo «Encuesta satisfaccion» \(tras 7 días\) → enviar WhatsApp «Referidos» \(tras 30 días\)$/);
  });
  it("WF3, WF4, WF6, WF7", () => {
    expect(por.WF3).toMatch(/^Cuando lleva 24 h sin actividad · si tipo de contacto es .+ y no contactar es No · entonces reasignar asesor → escalar al líder o a la gerencia$/);
    expect(por.WF4).toMatch(/^Cuando cambia de etapa a .+ · si .+ · entonces crear la tarea «Enviar cotización» \(vence en 1 día\) → preparar un borrador con IA \(seguimiento de cotización\)$/);
    expect(por.WF6).toBe("Cuando se atrasa un pago · entonces enviar WhatsApp «Pago vencido» (tras 1 día) → crear la tarea «Llamada cobranza» (tras 7 días) → escalar al líder o a la gerencia (tras 15 días)");
    expect(por.WF7).toMatch(/^Cuando lleva 30 días sin actividad · si temperatura es alguno de .+ · entonces preparar un borrador con IA \(reactivación\)$/);
    expect(por.WF2).toMatch(/^Cuando se asigna un lead · si .+ · entonces crear una tarea de llamada$/);
  });
  it("ninguna parte «Cuando» ni «entonces» deja claves crudas", () => {
    for (const r of CANONICAL_RULES) {
      const cuando = describeRule({ ...r, conditions: {} });
      expect(cuando, r.name).not.toMatch(RAW);
    }
  });
  it("regla sin acciones y con acciones que no son lista", () => {
    expect(describeRule({ triggerType: "EVENT", triggerConfig: { eventType: "deal.won" }, conditions: {}, actions: [] }))
      .toBe("Cuando se gana un negocio · entonces no hace nada");
    expect(describeActions(null)).toBe("");
  });
  it("las plantillas de reglas del builder se leen", () => {
    for (const t of RULE_TEMPLATES) {
      const f = describeRule(t.rule as never);
      expect(f).toMatch(/^Cuando entra un lead · si campaña contiene /);
      expect(f).toContain("entonces cambiar tipo de contacto a");
    }
  });
});

describe("describeStep", () => {
  it("relativo y acumulado", () => {
    const paso = { actionType: "SEND_WHATSAPP", config: { template: "seguimiento" }, delayMinutes: 2880 };
    expect(describeStep(paso)).toBe("Tras 2 días: enviar WhatsApp «Seguimiento»");
    expect(describeStep(paso, undefined, { acumuladoMinutos: 1440 })).toBe("Día 2: enviar WhatsApp «Seguimiento»");
    expect(describeStep({ ...paso, delayMinutes: 0 })).toBe("Al inscribir: enviar WhatsApp «Seguimiento»");
    expect(describeStep(paso, undefined, { acumuladoMinutos: 0 })).toMatch(/^Día 1: /);
    expect(describeStep(paso, undefined, { acumuladoMinutos: 90 })).toMatch(/^Tras 90 min: /);
  });
});

describe("configParaGuardar", () => {
  it("convierte números y booleanos, quita vacíos y conserva claves que el catálogo no conoce", () => {
    expect(configParaGuardar("CREATE_TASK", { subject: " Llamar ", description: "", dueInMinutes: "90" }))
      .toEqual({ subject: "Llamar", dueInMinutes: 90 });
    expect(configParaGuardar("SET_LIFECYCLE", { toStage: "SQL", allowBackward: "false" })).toEqual({ toStage: "SQL", allowBackward: false });
    expect(configParaGuardar("SET_LIFECYCLE", { toStage: "SQL", allowBackward: "true" })).toEqual({ toStage: "SQL", allowBackward: true });
    // claves de las reglas canónicas que el motor ignora pero no debemos perder al editar
    expect(configParaGuardar("ASSIGN", { reason: "", strategy: "routing_rules" })).toEqual({ strategy: "routing_rules" });
    expect(configParaGuardar("AI_DRAFT", { kind: "reactivacion", useMatching: true })).toEqual({ kind: "reactivacion", useMatching: true });
  });
  it("un número no numérico se deja como texto para que la validación lo marque", () => {
    const c = configParaGuardar("CREATE_TASK", { dueInMinutes: "mañana" });
    expect(c.dueInMinutes).toBe("mañana");
    expect(validarAccion({ type: "CREATE_TASK", config: c }).ok).toBe(false);
  });
  it("lo que arma la UI pasa el schema del motor", () => {
    const spec = { type: "CREATE_TASK", config: configParaGuardar("CREATE_TASK", { subject: "x", dueInMinutes: "60" }), delayMinutes: 15 };
    expect(actionSpecSchema.safeParse(spec).success).toBe(true);
  });
});

describe("validarAccion", () => {
  const fuentes = fuentesDesdeRespuesta({
    plantillas: [{ id: "t1", nombre: "Bienvenida" }],
    cadencias: [{ id: "p1", nombre: "Seguimiento" }],
  });
  it("campos requeridos", () => {
    expect(validarAccion({ type: "SEND_WHATSAPP", config: {} }).ok).toBe(false);
    expect(validarAccion({ type: "SEND_WHATSAPP", config: { body: "Hola" } }).ok).toBe(true);
    expect(validarAccion({ type: "SEND_EMAIL", config: { subject: "x" } }).ok).toBe(false);
    expect(validarAccion({ type: "SEND_EMAIL", config: { subject: "x", body: "y" } }).ok).toBe(true);
    expect(validarAccion({ type: "SEND_EMAIL", config: { template: "t1" } }).ok).toBe(true);
    expect(validarAccion({ type: "ADD_TAG", config: {} }).ok).toBe(false);
    expect(validarAccion({ type: "CHANGE_STAGE", config: {} }).ok).toBe(false);
    expect(validarAccion({ type: "CHANGE_STAGE", config: { toStage: "WON" } }).ok).toBe(true);
    expect(validarAccion({ type: "CHANGE_STAGE", config: { toStage: "NOPE" } }).ok).toBe(false);
    expect(validarAccion({ type: "SET_LIFECYCLE", config: { toStage: "SQL" } }).ok).toBe(true);
    expect(validarAccion({ type: "ENROLL_PLAN", config: {} }).ok).toBe(false);
    expect(validarAccion({ type: "WEBHOOK", config: { url: "http://x.com" } }).ok).toBe(false);
    expect(validarAccion({ type: "WEBHOOK", config: { url: "https://x.com" } }).ok).toBe(true);
    expect(validarAccion({ type: "ASSIGN", config: {} }).ok).toBe(true);
    expect(validarAccion({ type: "NOTIFY", config: {} }).ok).toBe(true);
  });
  it("UPDATE_FIELD: solo datos permitidos y valores válidos", () => {
    expect(validarAccion({ type: "UPDATE_FIELD", config: { field: "score", value: "1" } }).ok).toBe(false);
    expect(validarAccion({ type: "UPDATE_FIELD", config: { field: "temperature" } }).ok).toBe(false);
    expect(validarAccion({ type: "UPDATE_FIELD", config: { field: "temperature", value: "HOT" } }).ok).toBe(true);
    expect(validarAccion({ type: "UPDATE_FIELD", config: { field: "contactType", value: "LEAD" } }).ok).toBe(false);
    expect(validarAccion({ type: "UPDATE_FIELD", config: { field: "leadSource", value: "META_ADS" } }).ok).toBe(true);
  });
  it("plantilla y cadencia inexistentes solo se marcan si hay fuentes", () => {
    expect(validarAccion({ type: "SEND_WHATSAPP", config: { template: "pago_vencido" } }).ok).toBe(true);
    const r = validarAccion({ type: "SEND_WHATSAPP", config: { template: "pago_vencido" } }, fuentes);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain("Pago vencido");
    expect(validarAccion({ type: "SEND_WHATSAPP", config: { template: "t1" } }, fuentes).ok).toBe(true);
    expect(validarAccion({ type: "ENROLL_PLAN", config: { planId: "x" } }, fuentes).ok).toBe(false);
    expect(validarAccion({ type: "ENROLL_PLAN", config: { planId: "p1" } }, fuentes).ok).toBe(true);
    expect(validarAccion({ type: "ENROLL_PLAN", config: { planId: "x" } }).ok).toBe(true);
  });
  it("retraso inválido y acción desconocida", () => {
    expect(validarAccion({ type: "ASSIGN", delayMinutes: -5 }).ok).toBe(false);
    expect(validarAccion({ type: "ASSIGN", delayMinutes: 1.5 }).ok).toBe(false);
    expect(validarAccion({ type: "ASSIGN", delayMinutes: 60 }).ok).toBe(true);
    expect(validarAccion({ type: "NOPE" }).ok).toBe(false);
  });
  it("las plantillas de reglas del builder son válidas ", () => {
    const lead = RULE_TEMPLATES.find((t) => t.key === "lead")!;
    const problemas = lead.rule.actions.flatMap((a) => validarAccion(a as never).problemas);
    // builder-templates.ts ya guarda LEAD_COMPRADOR (el LEAD retirado en #938 se corrigió).
    expect(problemas).toEqual([]);
  });
});

describe("fuentesDesdeRespuesta", () => {
  it("indexa plantillas por id y por nombre; vacío si no hay datos", () => {
    const f = fuentesDesdeRespuesta({ plantillas: [{ id: "t1", nombre: "A" }] });
    expect(f.plantillas).toEqual({ t1: "A", A: "A" });
    expect(f.cadencias).toEqual({});
    expect(fuentesDesdeRespuesta(null)).toEqual({});
  });
});
