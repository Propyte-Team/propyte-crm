import { describe, it, expect } from "vitest";
import {
  parseLeadFormSummary,
  leadFormContactUpdates,
  isPlaceholderFirstName,
  isPlaceholderLastName,
} from "./lead-form-summary";

// Texto real (con datos de ejemplo) del DM que dejó un anuncio de Messenger con
// formulario el 2026-10-10: el contacto se quedó "Messenger (por identificar)".
const RESUMEN_MESSENGER = [
  "¡Hola! Completé el formulario y me gustaría obtener más información sobre el negocio.",
  "¿Cuál es tu esquema de pago?: Recurso propio",
  "¿En qué zona te interesa invertir?: Tulum",
  "Last name: Melendez",
  "Phone number: 55 5453 3990",
  "First name: Yanush",
  "Email: someone@example.com",
].join("\n");

describe("parseLeadFormSummary", () => {
  it("lee nombre, apellido, teléfono (E.164 MX) y correo del resumen de Messenger", () => {
    expect(parseLeadFormSummary(RESUMEN_MESSENGER)).toEqual({
      firstName: "Yanush",
      lastName: "Melendez",
      phone: "+525554533990",
      email: "someone@example.com",
    });
  });

  it("acepta las claves en español, con acentos o sin ellos", () => {
    const text = [
      "Nombre: Ana",
      "Apellidos: Pérez López",
      "Número de teléfono: 998 123 4567",
      "Correo electrónico: Ana.Perez@Example.MX",
    ].join("\n");
    expect(parseLeadFormSummary(text)).toEqual({
      firstName: "Ana",
      lastName: "Pérez López",
      phone: "+529981234567",
      email: "ana.perez@example.mx",
    });
  });

  it.each([
    ["Teléfono: 9981234567", "+529981234567"],
    ["Telefono: 9981234567", "+529981234567"],
    ["Celular: 998-123-4567", "+529981234567"],
    ["Phone number: +52 1 998 123 4567", "+529981234567"],
    ["phone_number: +1 305 555 1234", "+13055551234"],
  ])("teléfono %s → %s", (line, phone) => {
    expect(parseLeadFormSummary(line)?.phone).toBe(phone);
  });

  it.each(["Apellido: García", "Apellido(s): García", "last_name: García"])("apellido: %s", (line) => {
    expect(parseLeadFormSummary(line)?.lastName).toBe("García");
  });

  it.each(["Correo: x@y.com", "E-mail: x@y.com", "email: x@y.com"])("correo: %s", (line) => {
    expect(parseLeadFormSummary(line)?.email).toBe("x@y.com");
  });

  it("'Full name' se reparte en nombre y apellido si no vinieron por separado", () => {
    expect(parseLeadFormSummary("Full name: Yanush Melendez Ruiz")).toEqual({
      firstName: "Yanush",
      lastName: "Melendez Ruiz",
    });
    expect(parseLeadFormSummary("Nombre completo: Ana\nLast name: Pérez")).toEqual({
      firstName: "Ana",
      lastName: "Pérez",
    });
  });

  it("descarta valores que no son creíbles", () => {
    const text = [
      "Nombre: Departamento de 2 recámaras",
      "Teléfono: no tengo",
      "Correo: pendiente",
    ].join("\n");
    expect(parseLeadFormSummary(text)).toBeNull();
  });

  it("un mensaje normal no produce nada", () => {
    expect(parseLeadFormSummary("Hola, me interesa el depa de Tulum. ¿Precio?")).toBeNull();
    expect(parseLeadFormSummary("Horario: de 9 a 5")).toBeNull();
    expect(parseLeadFormSummary("")).toBeNull();
    expect(parseLeadFormSummary(null)).toBeNull();
  });

  it("si una clave se repite, gana la primera", () => {
    expect(parseLeadFormSummary("First name: Ana\nNombre: Otra")?.firstName).toBe("Ana");
  });

  it("tolera viñetas, negritas y CRLF", () => {
    expect(parseLeadFormSummary("- *First name*: Ana\r\n• Email: a@b.co")).toEqual({
      firstName: "Ana",
      email: "a@b.co",
    });
  });
});

describe("placeholders del alta", () => {
  it.each(["Messenger", "Instagram", "WhatsApp", "", "@yanush_m"])("nombre placeholder: %j", (v) => {
    expect(isPlaceholderFirstName(v)).toBe(true);
  });
  it("un nombre real no es placeholder", () => {
    expect(isPlaceholderFirstName("Yanush")).toBe(false);
  });
  it.each(["(por identificar)", "(sin apellido)", "(@yanush_m)", ""])("apellido placeholder: %j", (v) => {
    expect(isPlaceholderLastName(v)).toBe(true);
  });
  it("un apellido real no es placeholder", () => {
    expect(isPlaceholderLastName("Melendez")).toBe(false);
  });
});

describe("leadFormContactUpdates", () => {
  const fields = parseLeadFormSummary(RESUMEN_MESSENGER)!;

  it("contacto placeholder de Messenger: llena todo", () => {
    expect(
      leadFormContactUpdates(
        { firstName: "Messenger", lastName: "(por identificar)", phone: "", email: null },
        fields
      )
    ).toEqual({
      firstName: "Yanush",
      lastName: "Melendez",
      phone: "+525554533990",
      email: "someone@example.com",
    });
  });

  it("nunca sobrescribe datos reales", () => {
    expect(
      leadFormContactUpdates(
        { firstName: "Juan", lastName: "Pérez", phone: "+529981112233", email: "juan@x.com" },
        fields
      )
    ).toEqual({});
  });

  it("nombre real del perfil + apellido placeholder: solo llena lo que falta", () => {
    expect(
      leadFormContactUpdates({ firstName: "Yanush", lastName: "(por identificar)", phone: "" }, fields)
    ).toEqual({ lastName: "Melendez", phone: "+525554533990", email: "someone@example.com" });
  });
});
