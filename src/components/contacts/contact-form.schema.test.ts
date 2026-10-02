import { describe, it, expect } from "vitest";
import { contactFormSchema } from "./contact-form";

// #830: mismo criterio que el schema del servidor (route.ts) — probado aquí sin
// montar el componente (el repo no trae jsdom/Testing Library). Esto es la parte
// del formulario que decide si el botón "Guardar" deja pasar el envío o no.

const BASE = {
  firstName: "Karla",
  lastName: "Muñoz",
  leadSource: "WHATSAPP",
};

describe("contactFormSchema — #830 teléfono opcional con Usuario de WhatsApp", () => {
  it("no-regresión: con teléfono válido y sin whatsappUserId, pasa", () => {
    const r = contactFormSchema.safeParse({ ...BASE, phone: "+52 984 123 4567" });
    expect(r.success).toBe(true);
  });

  it("sin teléfono pero con whatsappUserId válido: pasa", () => {
    const r = contactFormSchema.safeParse({ ...BASE, whatsappUserId: "MX.13491208655302741918" });
    expect(r.success).toBe(true);
  });

  it("sin teléfono y sin whatsappUserId: falla, y el error se reporta sobre el campo phone", () => {
    const r = contactFormSchema.safeParse({ ...BASE });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "phone")).toBe(true);
    }
  });

  it("whatsappUserId con espacios se rechaza (no es un identificador válido)", () => {
    const r = contactFormSchema.safeParse({ ...BASE, whatsappUserId: "MX 1234" });
    expect(r.success).toBe(false);
  });

  it("whatsappUserId demasiado corto se rechaza", () => {
    const r = contactFormSchema.safeParse({ ...BASE, whatsappUserId: "ab" });
    expect(r.success).toBe(false);
  });

  it("teléfono inválido (letras) sigue rechazándose aunque ahora sea opcional", () => {
    const r = contactFormSchema.safeParse({ ...BASE, phone: "no-es-un-telefono" });
    expect(r.success).toBe(false);
  });

  it("teléfono vacío (\"\") es válido cuando hay whatsappUserId — el formulario puede mandarlo así", () => {
    const r = contactFormSchema.safeParse({ ...BASE, phone: "", whatsappUserId: "MX.1" });
    expect(r.success).toBe(true);
  });

  it("con AMBOS teléfono y whatsappUserId: pasa (no es ni/o exclusivo)", () => {
    const r = contactFormSchema.safeParse({ ...BASE, phone: "+5219991112233", whatsappUserId: "MX.1" });
    expect(r.success).toBe(true);
  });
});
