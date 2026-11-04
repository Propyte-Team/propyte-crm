import { describe, it, expect, vi } from "vitest";
import {
  DISPARADORES, GRUPOS_DE_DISPARADOR, disparadorPorKey, disparadorDesde, triggerConfigDesde, triggerTypeDe,
  armarDisparador, describeTrigger, validarDisparador, formatearHoras,
} from "./trigger-catalog";
import { buildTriggerConfig, parseTriggerValue } from "./builder-model";
import { TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";
import { EVENTOS_DE_CONDICION } from "./condition-catalog";
import { matchesTrigger } from "./engine";
import { CANONICAL_RULES } from "./canonical-rules.fixture";

// engine.ts importa Prisma: solo se usa matchesTrigger (puro), pero el módulo se carga entero.
vi.mock("@/lib/db", () => ({ default: {} }));

describe("cobertura del catálogo", () => {
  it("cada TriggerType tiene al menos un disparador", () => {
    // TIME se retiró del catálogo: el motor no tiene rama para él (ver scheduler.ts).
    for (const t of TRIGGER_TYPES.filter((x) => x !== "TIME")) expect(DISPARADORES.some((d) => d.triggerType === t), t).toBe(true);
  });
  it("cada evento de EVENTOS_DE_CONDICION se puede elegir (propio o suelto)", () => {
    for (const ev of Object.keys(EVENTOS_DE_CONDICION)) {
      const { key } = disparadorDesde("EVENT", { eventType: ev });
      expect(disparadorPorKey(key), ev).toBeDefined();
    }
  });
  it("keys únicas, grupos válidos y frases en minúscula sin claves crudas", () => {
    expect(new Set(DISPARADORES.map((d) => d.key)).size).toBe(DISPARADORES.length);
    for (const d of DISPARADORES) {
      expect(GRUPOS_DE_DISPARADOR).toContain(d.grupo);
      expect(d.frase[0]).toBe(d.frase[0].toLowerCase());
      expect(d.frase).not.toMatch(/[a-z]+\.[a-z_]+|_/);
    }
  });
  it("BEHAVIORAL es próximamente; INACTIVITY y SLA_BREACH activos; TIME ya no se ofrece", () => {
    expect(disparadorPorKey("time")).toBeUndefined();
    expect(disparadorPorKey("behavioral")?.estado).toBe("proximamente");
    expect(disparadorPorKey("inactivity")?.estado).toBe("activo");
    expect(disparadorPorKey("sla_breach")?.estado).toBe("activo");
  });
  it("los eventos que ya se emiten (fusión, cotización abierta, visita) están activos y sin aviso", () => {
    for (const k of ["contact.merged", "quote.opened", "visit.completed"]) {
      expect(disparadorPorKey(k)?.estado, k).toBe("activo");
      expect(disparadorPorKey(k)?.ayuda, k).toBeUndefined();
    }
    expect(disparadorPorKey("lead.captured")?.estado).toBe("activo");
  });
});

describe("ida y vuelta con lo guardado (compatible con builder-model)", () => {
  it.each(CANONICAL_RULES.map((r) => [r.name, r] as const))("%s", (_n, r) => {
    const { key, valor } = disparadorDesde(r.triggerType, r.triggerConfig);
    expect(triggerTypeDe(key)).toBe(r.triggerType);
    // Lo que produce la UI = lo que produciría el builder actual con el mismo valor.
    const valorBuilder = parseTriggerValue({ triggerConfig: r.triggerConfig });
    expect(triggerConfigDesde(key, valor)).toEqual(
      buildTriggerConfig(r.triggerType, r.triggerType === "EVENT" ? valorBuilder : valor),
    );
    // Y el motor reacciona igual al resultado.
    const rearmado = armarDisparador(key, valor);
    const evento = r.triggerType === "STAGE_CHANGE" ? "deal.stage_changed" : (r.triggerConfig as { eventType?: string }).eventType;
    if (evento) {
      const ev = { type: evento, payload: { toStage: (r.triggerConfig as { toStage?: string }).toStage } };
      expect(matchesTrigger(rearmado as never, ev as never)).toBe(matchesTrigger(r as never, ev as never));
    }
  });

  it("claves de triggerConfig: eventType, toStage, stage (legado), threshold, hours", () => {
    expect(disparadorDesde("STAGE_CHANGE", { stage: "RESERVED" })).toEqual({ key: "stage_change", valor: "RESERVED" });
    expect(disparadorDesde("LIFECYCLE_CHANGE", { toStage: "SQL" })).toEqual({ key: "lifecycle_change", valor: "SQL" });
    expect(disparadorDesde("SCORE_THRESHOLD", { threshold: 70 })).toEqual({ key: "score_threshold", valor: "70" });
    expect(disparadorDesde("INACTIVITY", { hours: 48 })).toEqual({ key: "inactivity", valor: "48" });
    expect(triggerConfigDesde("score_threshold", "70")).toEqual({ threshold: 70 });
    expect(triggerConfigDesde("inactivity", "48")).toEqual({ hours: 48 });
    expect(triggerConfigDesde("stage_change", "WON")).toEqual({ toStage: "WON" });
    expect(triggerConfigDesde("lifecycle_change", "SQL")).toEqual({ toStage: "SQL" });
    expect(triggerConfigDesde("lead.captured", "")).toEqual({ eventType: "lead.captured" });
    expect(triggerConfigDesde("sla_breach", "")).toEqual({});
  });

  it("un evento con disparador propio se presenta con él y sigue disparando", () => {
    expect(disparadorDesde("EVENT", { eventType: "deal.stage_changed" })).toEqual({ key: "stage_change", valor: "" });
    expect(disparadorDesde("EVENT", { eventType: "sla.breach" })).toEqual({ key: "sla_breach", valor: "" });
    // cualquier etapa: STAGE_CHANGE sin toStage = EVENT deal.stage_changed
    expect(matchesTrigger({ triggerType: "STAGE_CHANGE", triggerConfig: triggerConfigDesde("stage_change", "") } as never,
      { type: "deal.stage_changed", payload: { toStage: "WON" } } as never)).toBe(true);
  });

  it("un evento desconocido se conserva", () => {
    const d = disparadorDesde("EVENT", { eventType: "algo.nuevo" });
    expect(d.key).toBe("algo.nuevo");
    expect(triggerConfigDesde(d.key, d.valor)).toEqual({ eventType: "algo.nuevo" });
  });
});

describe("describeTrigger", () => {
  it("frases en español, sin claves crudas", () => {
    expect(describeTrigger("EVENT", { eventType: "lead.captured" })).toBe("entra un lead");
    expect(describeTrigger("EVENT", { eventType: "lead.assigned" })).toBe("se asigna un lead");
    expect(describeTrigger("EVENT", { eventType: "payment.overdue" })).toBe("se atrasa un pago");
    expect(describeTrigger("EVENT", { eventType: "contact.opted_out" })).toBe("un contacto pide no ser contactado");
    expect(describeTrigger("STAGE_CHANGE", { toStage: "MEETING_COMPLETED" })).toMatch(/^cambia de etapa a /);
    expect(describeTrigger("STAGE_CHANGE", {})).toBe("cambia de etapa");
    expect(describeTrigger("LIFECYCLE_CHANGE", { toStage: "SQL" })).toMatch(/^cambia de ciclo de vida a /);
    expect(describeTrigger("SCORE_THRESHOLD", { threshold: 70 })).toBe("el score llega a 70");
    expect(describeTrigger("INACTIVITY", { hours: 24 })).toBe("lleva 24 h sin actividad");
    expect(describeTrigger("INACTIVITY", { hours: 720 })).toBe("lleva 30 días sin actividad");
    expect(describeTrigger("INACTIVITY", {})).toBe("lleva 24 h sin actividad");
    expect(describeTrigger("SLA_BREACH", {})).toBe("vence un tiempo de respuesta");
    expect(describeTrigger("EVENT", { eventType: "algo.nuevo" })).toBe("ocurre «algo nuevo»");
  });
  it("las 8 reglas canónicas se leen sin claves crudas", () => {
    for (const r of CANONICAL_RULES) {
      const f = describeTrigger(r.triggerType, r.triggerConfig);
      expect(f, r.name).not.toMatch(/[A-Z_]{4,}|\w+\.\w+/);
    }
  });
  it("formatearHoras", () => {
    expect(formatearHoras(24)).toBe("24 h");
    expect(formatearHoras(48)).toBe("2 días");
    expect(formatearHoras(50)).toBe("50 h");
  });
});

describe("validarDisparador", () => {
  it("umbral de score es obligatorio y numérico", () => {
    expect(validarDisparador("score_threshold", "").ok).toBe(false);
    expect(validarDisparador("score_threshold", "abc").ok).toBe(false);
    expect(validarDisparador("score_threshold", "70").ok).toBe(true);
  });
  it("etapa vacía vale (cualquiera); 0 horas no", () => {
    expect(validarDisparador("stage_change", "").ok).toBe(true);
    expect(validarDisparador("inactivity", "").ok).toBe(true);
    expect(validarDisparador("inactivity", "0").ok).toBe(false);
  });
  it("sin disparador no es válido", () => {
    expect(validarDisparador("", "").ok).toBe(false);
    expect(validarDisparador("lead.captured", "").ok).toBe(true);
  });
});
