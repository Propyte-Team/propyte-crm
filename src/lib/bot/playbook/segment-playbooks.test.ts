import { describe, it, expect } from "vitest";
import { SEGMENT_PLAYBOOKS } from "./segment-playbooks";
import { NATIVE_TARGET_FIELDS, isCustomTarget, isNativeTarget } from "./fields";

// Estos tests existen por una razón concreta: `resolveWrite` (apply.ts) descarta
// un targetField desconocido con kind:"skip" **sin lanzar ni loguear**. Un typo o
// un campo no whitelisteado no rompe el bot: simplemente hace que el dato nunca
// se guarde, y eso solo se descubre semanas después mirando contactos vacíos.
// Aquí se convierte ese fallo silencioso en un test rojo.

describe("SEGMENT_PLAYBOOKS — contrato con el aplicador", () => {
  const allTasks = SEGMENT_PLAYBOOKS.flatMap((p) =>
    p.tasks.map((t) => ({ playbook: p.name, ...t })),
  );

  it("TODO targetField es nativo whitelisteado o custom.*", () => {
    const invalidos = allTasks
      .filter((t) => !isNativeTarget(t.targetField) && !isCustomTarget(t.targetField))
      .map((t) => `${t.playbook} → ${t.key} (${t.targetField})`);

    // Si esto falla: o agregas el campo a NATIVE_TARGET_FIELDS (si es columna real
    // de Contact) o lo pasas a `custom.<algo>`. No lo dejes así: se perdería.
    expect(invalidos).toEqual([]);
  });

  it("un campo nativo que es enum en Prisma se captura como ENUM", () => {
    // Este SÍ es un invariante real, a diferencia de exigir que el captureType
    // sea idéntico al de la whitelist: ese valor es solo el default que la UI
    // pre-llena al elegir el campo (playbook-tab.tsx), y el playbook global de
    // producción ya se aparta de él a propósito (BUDGET_RANGE sobre budgetMax,
    // que la whitelist declara MONEY).
    //
    // Lo que no se puede hacer es escribir texto libre en una columna que
    // Postgres tiene como enum: coerceEnum nunca correría, el valor crudo
    // llegaría al UPDATE y Prisma reventaría dentro del catch de apply.ts, que
    // se lo traga. Dato perdido, cero rastro.
    const malCapturados = allTasks
      .filter((t) => isNativeTarget(t.targetField))
      .filter((t) => (NATIVE_TARGET_FIELDS[t.targetField].enumValues ?? []).length > 0)
      .filter((t) => t.captureType !== "ENUM")
      .map((t) => `${t.playbook} → ${t.key}: ${t.targetField} es enum pero captura ${t.captureType}`);

    expect(malCapturados).toEqual([]);
  });

  it("los ENUM de campos nativos solo proponen valores que el enum de Prisma acepta", () => {
    const fuera: string[] = [];
    for (const t of allTasks) {
      if (t.captureType !== "ENUM" || !isNativeTarget(t.targetField)) continue;
      const permitidos = NATIVE_TARGET_FIELDS[t.targetField].enumValues ?? [];
      for (const opt of t.enumOptions ?? []) {
        if (!permitidos.includes(opt.value)) {
          fuera.push(`${t.playbook} → ${t.key}: "${opt.value}" no está en ${t.targetField}`);
        }
      }
    }
    // Un valor inventado aquí pasaría coerceEnum y luego reventaría el UPDATE de
    // Prisma, que apply.ts se traga en su catch: otro fallo invisible.
    expect(fuera).toEqual([]);
  });

  it("toda tarea ENUM trae opciones (sin ellas coerceEnum nunca captura nada)", () => {
    const sinOpciones = allTasks
      .filter((t) => t.captureType === "ENUM" && (t.enumOptions ?? []).length === 0)
      .map((t) => `${t.playbook} → ${t.key}`);

    expect(sinOpciones).toEqual([]);
  });

  it("las keys son únicas dentro de cada playbook", () => {
    for (const p of SEGMENT_PLAYBOOKS) {
      const keys = p.tasks.map((t) => t.key);
      expect(new Set(keys).size, `keys duplicadas en "${p.name}"`).toBe(keys.length);
    }
  });

  it("los nombres de playbook y de agente son únicos", () => {
    const nombres = SEGMENT_PLAYBOOKS.map((p) => p.name);
    const agentes = SEGMENT_PLAYBOOKS.map((p) => p.agentName);
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(new Set(agentes).size).toBe(agentes.length);
  });

  it("cada playbook pide al menos el nombre y tiene tareas", () => {
    for (const p of SEGMENT_PLAYBOOKS) {
      expect(p.tasks.length, `"${p.name}" sin tareas`).toBeGreaterThan(0);
      expect(
        p.tasks.some((t) => t.targetField === "firstName"),
        `"${p.name}" no captura el nombre`,
      ).toBe(true);
    }
  });

  it("ningún playbook de broker o reclutamiento pregunta presupuesto de compra", () => {
    // El punto entero de separar por segmento: no preguntarle presupuesto de
    // inversión a un candidato a empleo ni a un broker.
    const camposDeCompra = ["budgetMax", "budgetMin", "purchaseTimeline", "propertyType"];
    for (const p of SEGMENT_PLAYBOOKS) {
      if (p.agentName === "Agente Clientes") continue;
      const intrusos = p.tasks
        .filter((t) => camposDeCompra.includes(t.targetField))
        .map((t) => t.key);
      expect(intrusos, `"${p.name}" pregunta cosas de comprador`).toEqual([]);
    }
  });
});
