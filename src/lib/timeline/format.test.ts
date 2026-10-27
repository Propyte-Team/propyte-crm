import { describe, it, expect } from "vitest";
import { humanizeDuration, fieldChangeTitle, fieldLabel, valueLabel } from "./format";

describe("humanizeDuration", () => {
  it("menos de 1 minuto → '<1m'", () => {
    expect(humanizeDuration(30_000)).toBe("<1m");
    expect(humanizeDuration(0)).toBe("<1m");
  });

  it("minutos sin horas → '45m'", () => {
    expect(humanizeDuration(45 * 60_000)).toBe("45m");
  });

  it("horas y minutos → '2h 15m'", () => {
    expect(humanizeDuration(2 * 3_600_000 + 15 * 60_000)).toBe("2h 15m");
  });

  it("horas exactas sin minutos → '2h'", () => {
    expect(humanizeDuration(2 * 3_600_000)).toBe("2h");
  });

  it("días y horas → '3d 4h'", () => {
    expect(humanizeDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe("3d 4h");
  });

  it("días exactos sin horas → '3d'", () => {
    expect(humanizeDuration(3 * 86_400_000)).toBe("3d");
  });
});

describe("fieldChangeTitle", () => {
  it("título estilo Zoho para contactStatus usando CONTACT_STATUS_LABELS", () => {
    expect(fieldChangeTitle("contactStatus", "NUEVO", "CONTACTADO")).toBe(
      "Estado de contacto se actualizó de Nuevo a Contactado"
    );
  });

  it("mapea el label del campo temperature", () => {
    expect(fieldChangeTitle("temperature", "COLD", "HOT")).toBe(
      "Temperatura se actualizó de Frío a Caliente"
    );
  });

  it("mapea assignedToId con su label de campo (valores ya resueltos por el caller)", () => {
    expect(fieldChangeTitle("assignedToId", "Sin asignar", "Ana Pérez")).toBe(
      "Asignado a se actualizó de Sin asignar a Ana Pérez"
    );
  });

  it("campo sin mapa conocido se pasa a palabras (#934: antes salía el nombre crudo)", () => {
    expect(fieldChangeTitle("customFieldX", "a", "b")).toBe(
      "Custom field x se actualizó de a a b"
    );
  });

  it("valor sin mapa conocido usa String(value) como fallback", () => {
    expect(fieldChangeTitle("score", 10, 25)).toBe("Puntuación se actualizó de 10 a 25");
  });

  it("valor null se muestra como '—'", () => {
    expect(fieldChangeTitle("urgency", null, "ALTA")).toBe("Urgencia se actualizó de — a Alta");
  });

  it("arreglos (tags) se listan separados por coma", () => {
    expect(fieldChangeTitle("tags", ["vip"], ["vip", "referido"])).toBe(
      "Etiquetas se actualizó de vip a vip, referido"
    );
  });
});

// #934 — la cronología ya no muestra nombres técnicos de campo ni valores en crudo.
describe("fieldChangeTitle — nombres y valores legibles (#934)", () => {
  it("los campos de la captura salen con su nombre de la ficha", () => {
    expect(fieldChangeTitle("firstName", "Messenger", "Frank Arturo")).toBe(
      "Nombre se actualizó de Messenger a Frank Arturo"
    );
    expect(fieldChangeTitle("lastName", "(por identificar)", "Ruiz Esparza")).toBe(
      "Apellido se actualizó de (por identificar) a Ruiz Esparza"
    );
    expect(fieldChangeTitle("email", null, "frank@gmail.com")).toBe("Correo se actualizó de — a frank@gmail.com");
  });

  it("un teléfono vacío (\"\", el centinela de captureLead) sale como «—», no en blanco", () => {
    expect(fieldChangeTitle("phone", "", "+529997402652")).toBe("Teléfono se actualizó de — a +529997402652");
  });

  it("cada campo que cambió en producción (27-oct) tiene nombre legible, ninguno crudo", () => {
    const medidos = [
      "custom", "lifecycleStage", "assignedToId", "lastName", "firstName", "email", "phone",
      "contactType", "targetPlaza", "tags", "messengerPsid", "budgetMin", "contactStatus",
      "budgetMax", "doNotContact", "instagramId", "whatsappUserId", "investmentProfile",
      "propertyType", "leadSource", "preferredZone", "referredById", "purchaseTimeline",
      "purchaseModality", "rentalStrategy", "company", "paymentMethod", "urgency",
      "residenceCity", "temperature",
    ];
    for (const campo of medidos) {
      const etiqueta = fieldLabel(campo);
      expect(etiqueta, campo).not.toBe(campo);
      expect(etiqueta, campo).toMatch(/^[A-ZÁÉÍÓÚÑ]/); // empieza como palabra, no como identificador
      expect(etiqueta, campo).not.toMatch(/^[a-z]+[A-Z]\w*$/); // nada de camelCase crudo
    }
  });

  it("valores de perfil, plaza, sí/no y montos en español", () => {
    expect(fieldChangeTitle("investmentProfile", null, "INVESTOR_RENTAL")).toBe(
      "Perfil de inversión se actualizó de — a Inversionista (renta)"
    );
    expect(fieldChangeTitle("purchaseTimeline", "IMMEDIATE", "ONE_TO_THREE_MONTHS")).toBe(
      "Horizonte de compra se actualizó de Inmediato a 1-3 meses"
    );
    expect(fieldChangeTitle("targetPlaza", null, "TULUM")).toBe("Plaza se actualizó de — a Tulum");
    expect(fieldChangeTitle("doNotContact", false, true)).toBe("No contactar se actualizó de No a Sí");
    expect(fieldChangeTitle("budgetMax", null, 2000000)).toBe("Presupuesto máx. se actualizó de — a 2,000,000");
    expect(fieldChangeTitle("budgetMin", null, "1500000.00")).toBe("Presupuesto mín. se actualizó de — a 1,500,000");
  });

  it("borrar y restaurar un contacto se dicen así, no con una fecha cruda", () => {
    expect(fieldChangeTitle("deletedAt", null, "2026-10-16T21:00:00.000Z")).toBe("Contacto eliminado");
    expect(fieldChangeTitle("deletedAt", "2026-10-16T21:00:00.000Z", null)).toBe("Contacto restaurado");
  });

  it("listas vacías y objetos nunca salen en blanco ni como «[object Object]»", () => {
    expect(valueLabel("tags", [])).toBe("—");
    expect(valueLabel("algo", { a: 1 })).toBe('{"a":1}');
  });
});
