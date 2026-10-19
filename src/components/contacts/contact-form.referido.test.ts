import { describe, it, expect } from "vitest";
import { campoReferidoPor, contactFormSchema } from "./contact-form";

// #907: «Referido por» en el formulario. Al editar solo viaja si cambió, para que un rol con
// ese campo en solo lectura pueda seguir guardando lo demás (el servidor da 403 a cualquier
// campo bloqueado presente en el cuerpo, aunque traiga el mismo valor).
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";

describe("campoReferidoPor", () => {
  it("al crear: solo si se eligió un broker", () => {
    expect(campoReferidoPor("create", null, null)).toEqual({});
    expect(campoReferidoPor("create", null, A)).toEqual({ referredById: A });
  });

  it("al editar sin cambio: no manda nada (ni siquiera el mismo valor)", () => {
    expect(campoReferidoPor("edit", A, A)).toEqual({});
    expect(campoReferidoPor("edit", null, null)).toEqual({});
  });

  it("al editar con cambio: manda el nuevo, o null para quitarlo", () => {
    expect(campoReferidoPor("edit", A, B)).toEqual({ referredById: B });
    expect(campoReferidoPor("edit", null, A)).toEqual({ referredById: A });
    expect(campoReferidoPor("edit", A, null)).toEqual({ referredById: null });
  });
});

describe("contactFormSchema — tipos y «Referido por» (#907)", () => {
  const BASE = { firstName: "Ana", lastName: "López", leadSource: "WHATSAPP", phone: "+5219991112233" };

  it("acepta Proveedor y Otro; ya no Referidor", () => {
    expect(contactFormSchema.safeParse({ ...BASE, contactType: "PROVEEDOR" }).success).toBe(true);
    expect(contactFormSchema.safeParse({ ...BASE, contactType: "OTRO" }).success).toBe(true);
    expect(contactFormSchema.safeParse({ ...BASE, contactType: "REFERIDOR" }).success).toBe(false);
  });

  it("referredById: uuid o null", () => {
    expect(contactFormSchema.safeParse({ ...BASE, referredById: A }).success).toBe(true);
    expect(contactFormSchema.safeParse({ ...BASE, referredById: null }).success).toBe(true);
    expect(contactFormSchema.safeParse({ ...BASE, referredById: "x" }).success).toBe(false);
  });
});
