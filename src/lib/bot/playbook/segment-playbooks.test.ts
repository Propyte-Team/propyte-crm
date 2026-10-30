import { describe, it, expect } from "vitest";
import { SEGMENT_PLAYBOOKS } from "./segment-playbooks";
import { NATIVE_TARGET_FIELDS, isCustomTarget, isNativeTarget } from "./fields";
import { etiquetaCustom, valorCustom } from "@/lib/timeline/custom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Estos tests existen por una razón concreta: `resolveWrite` (apply.ts) descarta
// un targetField desconocido con kind:"skip" **sin lanzar ni loguear**. Un typo o
// un campo no whitelisteado no rompe el bot: simplemente hace que el dato nunca
// se guarde, y eso solo se descubre semanas después mirando contactos vacíos.
// Aquí se convierte ese fallo silencioso en un test rojo.

describe("Agentes del #954/#955", () => {
  it("existen el playbook de Lead Comprador (renombrado) y el de Lead Vendedor", () => {
    const agentes = SEGMENT_PLAYBOOKS.map((p) => p.agentName);
    expect(agentes).toContain("Agente Lead Comprador");
    expect(agentes).toContain("Agente Lead Vendedor");
    // El nombre viejo ya no existe en la BD: el aplicador diría «no existe el agente».
    expect(agentes).not.toContain("Agente Clientes");
  });

  it("Lead Vendedor guarda lo de la propiedad en custom.propiedad_venta_*, no en campos de comprador", () => {
    const vendedor = SEGMENT_PLAYBOOKS.find((p) => p.agentName === "Agente Lead Vendedor")!;
    const deLaPropiedad = vendedor.tasks.filter((t) => !["firstName", "phone"].includes(t.targetField));
    expect(deLaPropiedad.length).toBeGreaterThanOrEqual(5);
    for (const t of deLaPropiedad) expect(t.targetField, t.key).toMatch(/^custom\.propiedad_venta_/);
    expect(vendedor.tasks.some((t) => t.targetField === "phone")).toBe(true);
  });
});

describe("La migración del #955 es copia fiel del playbook", () => {
  // Las tareas del Agente Lead Vendedor se aplican a producción con SQL (sin acceso de la
  // sesión a la BD). Si alguien cambia el playbook aquí y no el SQL, esto lo avisa.
  it("cada tarea de Lead Vendedor está en el SQL con su campo, captura y obligatoriedad", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma", "migrations-manual", "2026-10-30-agentes-lead-comprador-y-vendedor.sql"),
      "utf8",
    );
    const vendedor = SEGMENT_PLAYBOOKS.find((p) => p.agentName === "Agente Lead Vendedor")!;
    vendedor.tasks.forEach((t, i) => {
      const fila = `(${i}, '${t.key}', '${t.objective.replace(/'/g, "''")}', '${t.targetField}', '${t.captureType}', '${JSON.stringify(t.enumOptions ?? [])}'`;
      expect(sql, t.key).toContain(fila);
      expect(sql, `${t.key} required`).toMatch(new RegExp(`\\(${i}, '${t.key}'[^\\n]*, ${t.required ?? true}\\),?\\n`));
    });
    expect(sql).toContain(`'${vendedor.name}'`);
    expect(sql).toContain("'Agente Lead Comprador'");
  });
});

describe("SEGMENT_PLAYBOOKS — se leen bien en la cronología (#933, #955)", () => {
  // Un custom.* nuevo sin etiqueta sale en la ficha como «Propiedad venta tipo: CESION_DE_DERECHOS».
  const custom = SEGMENT_PLAYBOOKS.flatMap((p) => p.tasks).filter((t) => isCustomTarget(t.targetField));

  it("cada valor ENUM de un campo custom tiene su texto en español", () => {
    const crudos: string[] = [];
    for (const t of custom.filter((t) => t.captureType === "ENUM")) {
      const clave = t.targetField.slice("custom.".length);
      for (const o of t.enumOptions ?? []) {
        if (valorCustom(clave, o.value) === o.value) crudos.push(`${clave}=${o.value}`);
      }
    }
    expect(crudos).toEqual([]);
  });

  it("los campos de la propiedad en venta tienen etiqueta propia", () => {
    for (const t of custom.filter((t) => t.targetField.startsWith("custom.propiedad_venta_"))) {
      expect(etiquetaCustom(t.targetField.slice("custom.".length)), t.key).toMatch(/^Propiedad en venta: /);
    }
  });
});

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

  it("ningún playbook de broker, reclutamiento o vendedor pregunta presupuesto de compra", () => {
    // El punto entero de separar por segmento: no preguntarle presupuesto de
    // inversión a un candidato a empleo, a un broker ni a quien viene a vender (#955).
    const camposDeCompra = ["budgetMax", "budgetMin", "purchaseTimeline", "propertyType", "preferredZone", "investmentProfile"];
    for (const p of SEGMENT_PLAYBOOKS) {
      if (p.agentName === "Agente Lead Comprador") continue;
      if (p.agentName === "Agente Brokers") {
        // La zona donde opera el broker sí va en preferredZone (decisión de septiembre).
        const intrusos = p.tasks
          .filter((t) => camposDeCompra.filter((c) => c !== "preferredZone").includes(t.targetField))
          .map((t) => t.key);
        expect(intrusos, `"${p.name}" pregunta cosas de comprador`).toEqual([]);
        continue;
      }
      const intrusos = p.tasks
        .filter((t) => camposDeCompra.includes(t.targetField))
        .map((t) => t.key);
      expect(intrusos, `"${p.name}" pregunta cosas de comprador`).toEqual([]);
    }
  });
});
