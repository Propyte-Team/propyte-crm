// #930 — lo que zod 4 cambió respecto a zod 3 y que el CRM tiene que conservar.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parcialSinDefaults, siFalta, siTipoInvalido, mensajesDeTipo } from "./zod4";
import { commentRuleUpdateSchema } from "@/server/comment-rules.schema";
import { brandPatchSchema } from "./brand";

describe("parcialSinDefaults (el .partial() de zod 3)", () => {
  const alta = z.object({
    name: z.string().min(1),
    isActive: z.boolean().default(false),
    priority: z.number().int().default(100),
    config: z.record(z.string(), z.unknown()).default({}),
  });

  it("un campo ausente se queda ausente, aunque en el alta tenga default", () => {
    expect(parcialSinDefaults(alta).parse({ name: "Regla" })).toEqual({ name: "Regla" });
  });

  it("un campo presente se valida igual que en el alta", () => {
    expect(parcialSinDefaults(alta).parse({ isActive: true, priority: 5 })).toEqual({ isActive: true, priority: 5 });
    expect(parcialSinDefaults(alta).safeParse({ priority: 1.5 }).success).toBe(false);
  });

  it("el alta sigue aplicando sus defaults", () => {
    expect(alta.parse({ name: "Regla" })).toEqual({ name: "Regla", isActive: false, priority: 100, config: {} });
  });
});

describe("esquemas de edición reales: un PATCH no reinicia lo que no manda", () => {
  it("reglas de comentarios: sin dailyCap, excludePhrases, postFilter ni priority en el resultado", () => {
    const d = commentRuleUpdateSchema.parse({ dmTemplate: "Hola {{usuario}}" });
    expect(d).toEqual({ dmTemplate: "Hola {{usuario}}" });
  });

  it("marcas: editar el nombre no apaga el bot", () => {
    const d = brandPatchSchema.parse({ name: "Yaxnáh" });
    expect(d).not.toHaveProperty("botEnabled");
  });
});

describe("mensajes con los parámetros de zod 4", () => {
  const issues = (s: z.ZodType, v: unknown) => s.safeParse(v).error?.issues.map((i) => i.message);

  it("siFalta: mensaje propio si falta; el de zod si llega con otro tipo", () => {
    const s = z.object({ a: z.string(siFalta("Falta A")) });
    expect(issues(s, {})).toEqual(["Falta A"]);
    expect(issues(s, { a: 1 })).not.toEqual(["Falta A"]);
  });

  it("siTipoInvalido: mensaje propio solo si llega con otro tipo", () => {
    const s = z.object({ a: z.number(siTipoInvalido("Debe ser número")) });
    expect(issues(s, { a: "x" })).toEqual(["Debe ser número"]);
    expect(issues(s, {})).not.toEqual(["Debe ser número"]);
  });

  it("mensajesDeTipo: uno para cada caso", () => {
    const s = z.object({ a: z.string(mensajesDeTipo("Pega el token", "El token debe ser texto")) });
    expect(issues(s, {})).toEqual(["Pega el token"]);
    expect(issues(s, { a: 7 })).toEqual(["El token debe ser texto"]);
  });
});

describe(".guid() acepta lo mismo que el .uuid() de zod 3", () => {
  // zod 4 hizo estricto .uuid() (versión y variante de la RFC 9562). Estos IDs los aceptaba
  // zod 3 y los usan las pruebas de agenda, actividades y negocios.
  it.each(["00000000-0000-0000-0000-000000000001", "11111111-1111-1111-1111-111111111111", "8f14e45f-ceea-467f-a8f9-1c3d2c9b5a10"])(
    "acepta %s",
    (id) => {
      expect(z.string().guid().safeParse(id).success).toBe(true);
    }
  );

  it("sigue rechazando lo que no tiene forma de UUID", () => {
    expect(z.string().guid().safeParse("not-a-uuid").success).toBe(false);
  });
});
