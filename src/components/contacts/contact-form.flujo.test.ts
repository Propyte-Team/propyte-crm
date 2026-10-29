import { describe, it, expect } from "vitest";
import { contactFormSchema } from "./contact-form";

// #951: el formulario de contacto (alta y «Editar todo») valida con contactFormSchema y manda
// `validation.data`. Si el esquema no conoce `flujo`, zod lo quita del cuerpo en silencio y el
// servidor nunca lo recibe (lo mismo que pasaba en la API antes de #948).

const BASE = { firstName: "Karla", lastName: "Muñoz", leadSource: "WHATSAPP", phone: "+52 984 123 4567" };

describe("contactFormSchema — flujo (#951)", () => {
  it("conserva el flujo elegido en lo que se envía", () => {
    const r = contactFormSchema.safeParse({ ...BASE, flujo: "F2_CORRETAJE_COMPRADOR" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveProperty("flujo", "F2_CORRETAJE_COMPRADOR");
  });

  it("conserva «Sin flujo» como null (quitarlo al editar)", () => {
    const r = contactFormSchema.safeParse({ ...BASE, flujo: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveProperty("flujo", null);
  });

  it("sin flujo en el cuerpo, no lo inventa", () => {
    const r = contactFormSchema.safeParse(BASE);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("flujo");
  });

  it("rechaza un flujo que no existe", () => {
    expect(contactFormSchema.safeParse({ ...BASE, flujo: "F9" }).success).toBe(false);
  });
});
