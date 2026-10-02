import { describe, it, expect } from "vitest";
import { contactFormSchema, buildSubmitData } from "./contact-form";

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

// Bug reportado 2026-10-02: en Editar Contacto, vaciar el Teléfono (dejando el
// campo en blanco) parecía guardarse sin error, pero el número viejo seguía
// apareciendo después. Causa: `buildSubmitData` convertía phone/whatsappUserId
// vacíos a `undefined`, y `JSON.stringify` OMITE las claves en `undefined` — un
// PUT sin la clave "phone" significa "no tocar este campo" para el servidor, no
// "vaciarlo". Esta batería fija que esas dos claves SIEMPRE viajan explícitas,
// para que una regresión futura (alguien "simplificando" buildSubmitData) truene
// aquí en vez de en el CRM de alguien más.
describe("buildSubmitData — #830 bug: vaciar Teléfono/Usuario de WhatsApp al editar no se guardaba", () => {
  it("phone vacío viaja como \"\" explícito — NUNCA como clave ausente/undefined", () => {
    const data = buildSubmitData({ phone: "", whatsappUserId: "MX.1" }, []);
    expect("phone" in data).toBe(true);
    expect(data.phone).toBe("");
    // JSON.stringify es el mecanismo real del bug: si `phone` fuera `undefined`,
    // la clave desaparecería del body que de verdad viaja al servidor.
    expect(JSON.parse(JSON.stringify(data))).toHaveProperty("phone", "");
  });

  it("whatsappUserId vacío viaja como \"\" explícito — mismo criterio, en el otro sentido", () => {
    const data = buildSubmitData({ phone: "+5219991112233", whatsappUserId: "" }, []);
    expect("whatsappUserId" in data).toBe(true);
    expect(data.whatsappUserId).toBe("");
    expect(JSON.parse(JSON.stringify(data))).toHaveProperty("whatsappUserId", "");
  });

  it("con valor, phone y whatsappUserId se preservan tal cual (no-regresión)", () => {
    const data = buildSubmitData({ phone: "+5219991112233", whatsappUserId: "MX.1" }, []);
    expect(data.phone).toBe("+5219991112233");
    expect(data.whatsappUserId).toBe("MX.1");
  });

  it("otros campos opcionales SÍ se siguen convirtiendo a undefined al vaciarse (comportamiento preexistente, sin cambios)", () => {
    const data = buildSubmitData({ email: "", secondaryPhone: "", residenceCity: "" }, []);
    expect(data.email).toBeUndefined();
    expect(data.secondaryPhone).toBeUndefined();
    expect(data.residenceCity).toBeUndefined();
  });
});
