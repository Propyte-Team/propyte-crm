import { describe, it, expect } from "vitest";
import { SEGMENT_PLAYBOOKS } from "./segment-playbooks";
import { coerceCapture, type EnumOption } from "./capture";
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

describe("Playbook de reclutamiento (spec 2026-11-02)", () => {
  const pb = SEGMENT_PLAYBOOKS.find((p) => p.agentName === "Agente Reclutamiento")!;
  const claves = pb.tasks.map((t) => t.key);

  it("existe y sigue el orden de la prueba del 2026-11-03: mayor de edad primero, luego nombre y plaza", () => {
    expect(pb).toBeTruthy();
    expect(claves).toEqual([
      "mayor_edad", "nombre", "plaza", "telefono", "acepta_comision", "disponibilidad", "colchon_meses", "movilidad",
      "experiencia_inmobiliaria", "cartera_clientes", "experiencia_ventas", "ingles", "prospeccion_digital",
      "actitud_1", "actitud_2", "actitud_3",
    ]);
  });

  it("nombre: se pregunta siempre aunque Instagram ya traiga firstName (skipIfFilled=false, apellidos)", () => {
    const nombre = pb.tasks.find((t) => t.key === "nombre")!;
    expect(nombre.skipIfFilled).toBe(false);
    expect(nombre.objective).toMatch(/apellidos/);
    // El resto no lo declara: el seed lo persiste como true (comportamiento de siempre).
    for (const t of pb.tasks.filter((t) => t.key !== "nombre")) expect(t.skipIfFilled, t.key).toBeUndefined();
  });

  it("telefono: pide 10 dígitos con lada", () => {
    expect(pb.tasks.find((t) => t.key === "telefono")!.objective).toMatch(/10 dígitos/);
  });

  it("todo lo específico del candidato va a custom.reclutamiento_<clave>", () => {
    for (const t of pb.tasks) {
      if (["firstName", "phone", "email"].includes(t.targetField)) continue;
      expect(t.targetField, t.key).toBe(`custom.reclutamiento_${t.key}`);
    }
  });

  it("tiene los 6 filtros, los 5 puntuables y las 3 de actitud", () => {
    for (const k of ["mayor_edad", "acepta_comision", "disponibilidad", "colchon_meses", "plaza", "movilidad"]) expect(claves).toContain(k);
    for (const k of ["experiencia_inmobiliaria", "cartera_clientes", "experiencia_ventas", "ingles", "prospeccion_digital"]) expect(claves).toContain(k);
    for (const k of ["actitud_1", "actitud_2", "actitud_3"]) expect(claves).toContain(k);
  });

  it("los filtros van antes que los puntuables y la actitud al final", () => {
    const i = (k: string) => claves.indexOf(k);
    expect(i("movilidad")).toBeLessThan(i("experiencia_inmobiliaria"));
    expect(i("prospeccion_digital")).toBeLessThan(i("actitud_1"));
    expect(claves[claves.length - 1]).toBe("actitud_3");
  });

  it("las opciones ENUM coinciden con las claves del modelo default", async () => {
    const { MODELO_DEFAULT } = await import("@/lib/reclutamiento/modelo");
    for (const [clave, f] of Object.entries(MODELO_DEFAULT.filtros)) {
      const t = pb.tasks.find((x) => x.key === clave)!;
      const valores = t.enumOptions!.map((o) => o.value);
      for (const v of [...f.pasa, ...f.ambiguo]) expect(valores, clave).toContain(v);
    }
    for (const [clave, p] of Object.entries(MODELO_DEFAULT.puntuables)) {
      const t = pb.tasks.find((x) => x.key === clave)!;
      const valores = t.enumOptions!.map((o) => o.value);
      for (const v of Object.keys(p.puntos)) expect(valores, clave).toContain(v);
    }
  });

  it("ya no existen las claves viejas puesto/experiencia/ciudad", () => {
    expect(claves).not.toContain("puesto");
    expect(claves).not.toContain("experiencia");
    expect(claves).not.toContain("ciudad");
  });

  it("no pide correo: el motor ignora required:false y lo volvería compuerta dura", () => {
    expect(claves).not.toContain("correo");
    expect(pb.tasks.some((t) => t.targetField === "email")).toBe(false);
  });

  // coerceEnum se queda con el PRIMER substring que encuentre, opción por opción,
  // y el value mismo cuenta ("SI" cae en "necesito", "NO" en "menos"). Estas frases
  // reales fijan el orden de opciones y los sinónimos del bloque.
  describe("coerción con las opciones reales del guion", () => {
    const coerce = (clave: string, frase: string) => {
      const t = pb.tasks.find((x) => x.key === clave)!;
      const r = coerceCapture({ targetField: t.targetField, captureType: "ENUM", enumOptions: t.enumOptions as EnumOption[] }, frase);
      return r.ok ? r.writes[0].value : null;
    };

    it("colchon_meses: 12 meses no cae en MENOS_DE_TRES por el '2 meses'", () => {
      expect(coerce("colchon_meses", "tengo como 12 meses cubiertos")).toBe("MAS_DE_SEIS");
      expect(coerce("colchon_meses", "un año")).toBe("MAS_DE_SEIS");
      expect(coerce("colchon_meses", "unos 4 meses")).toBe("TRES_A_SEIS");
      expect(coerce("colchon_meses", "2 meses")).toBe("MENOS_DE_TRES");
      expect(coerce("colchon_meses", "no lo he calculado")).toBe("NO_SE");
      expect(coerce("colchon_meses", "no sé")).toBe("NO_SE");
    });

    it("colchon_meses: «Tengo otro trabajo» (la respuesta real de la prueba) cae en OTRO_INGRESO", () => {
      expect(coerce("colchon_meses", "Tengo otro trabajo")).toBe("OTRO_INGRESO");
      expect(coerce("colchon_meses", "sigo trabajando mientras")).toBe("OTRO_INGRESO");
      expect(coerce("colchon_meses", "mi pareja me apoya")).toBe("OTRO_INGRESO");
      expect(coerce("colchon_meses", "mis papás me ayudan")).toBe("OTRO_INGRESO");
      expect(coerce("colchon_meses", "tengo ingresos aparte")).toBe("OTRO_INGRESO");
      // Negaciones: un desempleado sin ahorros no debe pasar el filtro.
      expect(coerce("colchon_meses", "no tengo trabajo ni ahorros")).not.toBe("OTRO_INGRESO");
      expect(coerce("colchon_meses", "no tengo ingresos")).not.toBe("OTRO_INGRESO");
      // OTRO_INGRESO va antes que las numéricas, pero no se roba una respuesta en meses.
      expect(coerce("colchon_meses", "tengo como 12 meses cubiertos")).toBe("MAS_DE_SEIS");
      expect(coerce("colchon_meses", "6 meses")).toBe("TRES_A_SEIS");
    });

    it("«Sip» y otros sí coloquiales (prueba 2026-11-04) cuentan como SI sin robarse las negativas", () => {
      expect(coerce("acepta_comision", "Sip")).toBe("SI");
      expect(coerce("acepta_comision", "simón")).toBe("SI");
      expect(coerce("acepta_comision", "ok, me parece bien")).toBe("SI");
      expect(coerce("acepta_comision", "no me parece")).toBe("NO");
      expect(coerce("acepta_comision", "no me funciona")).toBe("NO");
      expect(coerce("mayor_edad", "Sí, así es")).toBe("SI");
      expect(coerce("mayor_edad", "sip")).toBe("SI");
      expect(coerce("mayor_edad", "no soy mayor de edad")).toBe("NO");
      expect(coerce("movilidad", "sip")).toBe("SI");
      expect(coerce("movilidad", "no tengo")).toBe("NO");
    });

    it("respuestas cortas y negaciones comunes caen en la opción correcta", () => {
      expect(coerce("acepta_comision", "no sé")).toBe("NO_SE");
      expect(coerce("acepta_comision", "bueno, sin problema")).toBe("SI");
      expect(coerce("prospeccion_digital", "casi no")).toBe("NO");
      expect(coerce("prospeccion_digital", "uso instagram")).toBe("SI");
      expect(coerce("experiencia_inmobiliaria", "nunca")).toBe("SIN_EXPERIENCIA");
    });
    it("acepta_comision: 'necesito sueldo' no cae en SI por el 'si' de 'necesito'", () => {
      expect(coerce("acepta_comision", "necesito sueldo base")).toBe("NO");
      expect(coerce("acepta_comision", "sí, me funciona")).toBe("SI");
      expect(coerce("acepta_comision", "SI")).toBe("SI");
      expect(coerce("acepta_comision", "lo pensaría")).toBe("NO_SE");
    });

    it("mayor_edad: edades concretas, sin el truco de 'tengo 2/3/4/5'", () => {
      expect(coerce("mayor_edad", "tengo 18")).toBe("SI");
      expect(coerce("mayor_edad", "tengo 17")).toBe("NO");
      expect(coerce("mayor_edad", "soy menor")).toBe("NO");
    });

    it("movilidad: sin vehículo pero con disposición no cae en SI", () => {
      expect(coerce("movilidad", "no tengo coche pero me muevo en transporte")).toBe("SOLO_DISPOSICION");
      expect(coerce("movilidad", "tengo moto")).toBe("SI");
      expect(coerce("movilidad", "no puedo moverme")).toBe("NO");
    });

    it("experiencia_inmobiliaria: números de años", () => {
      expect(coerce("experiencia_inmobiliaria", "llevo 10 años")).toBe("MAS_DE_3_ANOS");
      expect(coerce("experiencia_inmobiliaria", "2 años")).toBe("DE_1_A_3_ANOS");
      expect(coerce("experiencia_inmobiliaria", "más de un año")).toBe("DE_1_A_3_ANOS");
      expect(coerce("experiencia_inmobiliaria", "unos meses")).toBe("MENOS_1_ANO");
      expect(coerce("experiencia_inmobiliaria", "ninguna")).toBe("SIN_EXPERIENCIA");
    });

    it("las opciones negativas van al final y con frases específicas", () => {
      expect(coerce("ingles", "no sé inglés")).toBe("NO");
      expect(coerce("ingles", "básico")).toBe("BASICO");
      expect(coerce("cartera_clientes", "no tengo cartera")).toBe("NO");
      expect(coerce("cartera_clientes", "menos de 10")).toBe("MENOS_10");
      expect(coerce("experiencia_ventas", "nunca he vendido")).toBe("NINGUNA");
      expect(coerce("prospeccion_digital", "no uso redes")).toBe("NO");
      expect(coerce("prospeccion_digital", "instagram")).toBe("SI");
    });

    it("ningún sinónimo suelto 'sí'/'si'/'no' en el bloque", () => {
      for (const t of pb.tasks) {
        for (const o of t.enumOptions ?? []) {
          expect(o.synonyms ?? [], `${t.key}=${o.value}`).not.toContain("si");
          expect(o.synonyms ?? [], `${t.key}=${o.value}`).not.toContain("sí");
          expect(o.synonyms ?? [], `${t.key}=${o.value}`).not.toContain("no");
        }
      }
    });
  });
});
