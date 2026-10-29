import { describe, it, expect } from "vitest";
import {
  CAMPOS_EXPORTACION,
  camposElegidos,
  celdaTelefono,
  celdaTexto,
  construirCsv,
  fechaExport,
  puedeExportarContactos,
  type ContactoExportable,
} from "./exportar";

const contacto = (over: Partial<ContactoExportable> = {}): ContactoExportable => ({
  firstName: "Javier", lastName: "Prieto", email: "prietojavier357@gmail.com", phone: "+5219842536158",
  secondaryPhone: null, contactType: null, flujo: null, contactStatus: "NUEVO", lifecycleStage: "MQL", temperature: "COLD",
  score: 10, urgency: null, tags: ["vip", "cancun"], leadSource: "MESSENGER", leadSourceDetail: null,
  targetPlaza: null, residenceCity: "Mérida", residenceCountry: null, nationality: null, preferredLanguage: "ES",
  investmentProfile: "INVESTOR_RENTAL", propertyType: null, purchaseTimeline: null, budgetMin: "2500000.00",
  budgetMax: null, paymentMethod: null, preferredZone: null, purchaseModality: null, rentalStrategy: null,
  doNotContact: false, whatsappOptOut: true, createdAt: "2026-10-15T18:30:00Z", lastActivityAt: null,
  updatedAt: "2026-10-16T02:05:00Z", assignedTo: { name: "Karla Muñoz", email: "k@propyte.com" },
  brands: [{ brand: { name: "Propyte" } }], _count: { deals: 2, activities: 5 }, ...over,
});

describe("puedeExportarContactos", () => {
  it("solo ADMIN y DIRECTOR", () => {
    const roles = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER", "ASESOR", "MARKETING", "HOSTESS", "DEVELOPER_EXT", "MANTENIMIENTO"];
    expect(roles.filter(puedeExportarContactos)).toEqual(["ADMIN", "DIRECTOR"]);
    expect(puedeExportarContactos(undefined)).toBe(false);
  });
});

describe("catálogo", () => {
  it("claves únicas", () => {
    const keys = CAMPOS_EXPORTACION.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("camposElegidos ignora claves desconocidas y respeta el orden del catálogo", () => {
    expect(camposElegidos(["email", "nombre", "inventado"]).map((c) => c.key)).toEqual(["nombre", "email"]);
  });
});

describe("celdas", () => {
  it("escapa comillas", () => {
    expect(celdaTexto('Casa "Azul", Tulum')).toBe('"Casa ""Azul"", Tulum"');
  });
  it("neutraliza fórmulas (inyección de CSV)", () => {
    expect(celdaTexto("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(celdaTexto("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    expect(celdaTexto("-2+3")).toBe("\"'-2+3\"");
    expect(celdaTexto("Ana")).toBe('"Ana"');
  });
  it("teléfono: texto exacto para Excel y solo deja pasar + y dígitos", () => {
    expect(celdaTelefono("+52 984 253-6158")).toBe('"=""+529842536158"""');
    expect(celdaTelefono('+52"&HYPERLINK("x")')).toBe('"=""+52"""');
    expect(celdaTelefono("")).toBe('""');
  });
});

describe("construirCsv", () => {
  it("BOM, encabezados en español, etiquetas legibles y fechas en horario de Cancún", () => {
    const csv = construirCsv([contacto()], camposElegidos(["nombre", "telefono", "tipo", "estado", "fuente", "marcas", "asesor", "perfil", "presupuestoMin", "bajaWhatsapp", "etiquetas", "registro", "modificado"]));
    expect(csv.startsWith("﻿")).toBe(true);
    const [enc, fila] = csv.slice(1).trim().split("\r\n");
    expect(enc).toBe('"Nombre","Teléfono","Tipo de contacto","Estado","Etiquetas","Fuente","Marca","Asesor asignado","Perfil de inversión","Presupuesto mínimo","Baja de WhatsApp","Fecha de registro","Última modificación"');
    expect(fila).toBe('"Javier","=""+5219842536158""","","Nuevo","vip, cancun","Messenger","Propyte","Karla Muñoz","Inversionista (renta)","2500000.00","Sí","2026-10-15 13:30","2026-10-15 21:05"');
  });
  it("sin contactos: solo encabezados", () => {
    expect(construirCsv([], camposElegidos(["nombre"]))).toBe('﻿"Nombre"\r\n');
  });
});

describe("fechaExport", () => {
  it("vacía si no hay fecha", () => {
    expect(fechaExport(null)).toBe("");
  });
});
