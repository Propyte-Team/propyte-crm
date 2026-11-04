import { describe, it, expect } from "vitest";
import { CANONICAL_RULES } from "./canonical-rules.fixture";
import { GLOBAL_TEMPLATES } from "./seed-templates";

// actions.ts resuelve `config.template` por id o por name EXACTO; el canal de SEND_EMAIL se filtra.
const CANAL: Record<string, "WHATSAPP" | "EMAIL"> = { SEND_WHATSAPP: "WHATSAPP", SEND_EMAIL: "EMAIL" };

describe("plantillas del seed vs reglas canónicas", () => {
  const usos = CANONICAL_RULES.flatMap((r) =>
    (r.actions as { type: string; config: { template?: string } }[])
      .filter((a) => CANAL[a.type] && a.config.template)
      .map((a) => ({ regla: r.name, canal: CANAL[a.type], nombre: a.config.template! })),
  );

  it("hay envíos con plantilla que verificar", () => {
    expect(usos.length).toBeGreaterThanOrEqual(4);
  });

  for (const u of usos) {
    it(`${u.regla}: «${u.nombre}» (${u.canal}) existe como plantilla global ES`, () => {
      const t = GLOBAL_TEMPLATES.find((g) => g.name === u.nombre && g.language === "ES");
      expect(t, `falta la plantilla ${u.nombre}`).toBeDefined();
      expect(t!.channel).toBe(u.canal);
      expect(t!.body.length).toBeGreaterThan(20);
      if (u.canal === "EMAIL") expect((t as { subject?: string }).subject).toBeTruthy();
    });
  }

  it("nombres únicos", () => {
    const n = GLOBAL_TEMPLATES.map((t) => `${t.name}|${t.language}`);
    expect(new Set(n).size).toBe(n.length);
  });
});
