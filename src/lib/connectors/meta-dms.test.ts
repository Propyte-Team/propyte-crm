// Piezas puras del alta conjunta «Meta DMs» (2026-10-10): nombres, reparto config/credentials
// según el registro y choques con cuentas que ya existen.
import { describe, it, expect } from "vitest";
import {
  metaDmBaseName,
  metaDmNames,
  buildMetaDmDrafts,
  findMetaDmConflicts,
  conflictMessage,
  noLinkedInstagramMessage,
  igMismatchMessage,
} from "./meta-dms";

const FIELDS = {
  pageId: "PAGE-1",
  brand: "Nativa",
  pageAccessToken: "EAAtoken",
  appSecret: "APP-SECRET",
  verifyToken: "VERIFY",
  igBusinessId: "IG-1",
};

describe("metaDmNames", () => {
  it("usa la convención de la base: «Messenger | DM X» e «IG - X»", () => {
    expect(metaDmNames("Nativa Tulum")).toEqual({ messenger: "Messenger | DM Nativa Tulum", instagram: "IG - Nativa Tulum" });
  });

  it("recorta y colapsa espacios", () => {
    expect(metaDmBaseName("  Nativa   Tulum \n")).toBe("Nativa Tulum");
  });

  it("si el admin pega el nombre con prefijo, no lo duplica", () => {
    expect(metaDmNames("IG - Nativa").messenger).toBe("Messenger | DM Nativa");
    expect(metaDmNames("Messenger | DM Yaxnah").instagram).toBe("IG - Yaxnah");
    expect(metaDmBaseName("messenger|dm Propyte")).toBe("Propyte");
  });

  it("no toca nombres que solo empiezan parecido", () => {
    expect(metaDmBaseName("IGNIS Residencial")).toBe("IGNIS Residencial");
    expect(metaDmBaseName("DM Nativa")).toBe("DM Nativa");
  });
});

describe("buildMetaDmDrafts", () => {
  it("con Instagram: dos cuentas con los mismos secretos y la misma Página", () => {
    const [messenger, instagram] = buildMetaDmDrafts({ name: "Nativa Tulum", fields: FIELDS, includeInstagram: true });
    const secrets = { pageAccessToken: "EAAtoken", appSecret: "APP-SECRET", verifyToken: "VERIFY" };

    expect(messenger).toEqual({
      provider: "MESSENGER",
      name: "Messenger | DM Nativa Tulum",
      config: { pageId: "PAGE-1", brand: "Nativa" },
      credentials: secrets,
    });
    expect(instagram).toEqual({
      provider: "INSTAGRAM",
      name: "IG - Nativa Tulum",
      config: { pageId: "PAGE-1", igBusinessId: "IG-1", brand: "Nativa" },
      credentials: secrets,
    });
  });

  it("sin Instagram: solo Messenger", () => {
    const drafts = buildMetaDmDrafts({ name: "Nativa", fields: FIELDS, includeInstagram: false });
    expect(drafts.map((d) => d.provider)).toEqual(["MESSENGER"]);
  });

  it("el igBusinessId nunca acaba dentro de las credenciales de Messenger", () => {
    const [messenger] = buildMetaDmDrafts({ name: "Nativa", fields: FIELDS, includeInstagram: true });
    expect(messenger.credentials).not.toHaveProperty("igBusinessId");
    expect(messenger.config).not.toHaveProperty("igBusinessId");
  });

  it("ignora claves que el registro no declara (no se cifran ni se guardan)", () => {
    const [messenger, instagram] = buildMetaDmDrafts({
      name: "Nativa",
      fields: { ...FIELDS, otra: "x" },
      includeInstagram: true,
    });
    for (const d of [messenger, instagram]) {
      expect(d.credentials).not.toHaveProperty("otra");
      expect(d.config).not.toHaveProperty("otra");
    }
  });

  it("los secretos nunca van a config", () => {
    for (const d of buildMetaDmDrafts({ name: "Nativa", fields: FIELDS, includeInstagram: true })) {
      expect(Object.keys(d.config)).not.toContain("pageAccessToken");
      expect(Object.keys(d.config)).not.toContain("appSecret");
    }
  });

  it("la marca visible vacía no se guarda", () => {
    const [messenger] = buildMetaDmDrafts({ name: "Nativa", fields: { ...FIELDS, brand: "  " }, includeInstagram: false });
    expect(messenger.config).toEqual({ pageId: "PAGE-1" });
  });
});

describe("findMetaDmConflicts", () => {
  const MESSENGER = { id: "m1", name: "Messenger | DM Nativa", provider: "MESSENGER", config: { pageId: "PAGE-1" } };
  const IG = { id: "i1", name: "IG - Nativa", provider: "INSTAGRAM", config: { pageId: "PAGE-1", igBusinessId: "IG-1" } };
  const target = { pageId: "PAGE-1", includeInstagram: true, igBusinessId: "IG-1" };

  it("sin cuentas para esa Página no hay choque", () => {
    expect(findMetaDmConflicts([{ ...MESSENGER, config: { pageId: "PAGE-9" } }], target)).toEqual([]);
  });

  it("un Messenger con la misma Página choca", () => {
    expect(findMetaDmConflicts([MESSENGER], target)).toEqual([
      { id: "m1", name: "Messenger | DM Nativa", provider: "MESSENGER", by: "pageId" },
    ]);
  });

  it("compara el pageId como texto (hay cuentas viejas con número)", () => {
    expect(findMetaDmConflicts([{ ...MESSENGER, config: { pageId: 123 } }], { ...target, pageId: "123" })).toHaveLength(1);
  });

  it("un Instagram con la misma Página choca solo si se incluye Instagram", () => {
    expect(findMetaDmConflicts([IG], target)).toEqual([{ id: "i1", name: "IG - Nativa", provider: "INSTAGRAM", by: "pageId" }]);
    expect(findMetaDmConflicts([IG], { ...target, includeInstagram: false })).toEqual([]);
  });

  it("un Instagram con el mismo igBusinessId en otra Página también choca", () => {
    const other = { ...IG, config: { pageId: "PAGE-9", igBusinessId: "IG-1" } };
    expect(findMetaDmConflicts([other], target)).toEqual([
      { id: "i1", name: "IG - Nativa", provider: "INSTAGRAM", by: "igBusinessId" },
    ]);
  });

  it("cuentas sin config no rompen", () => {
    expect(findMetaDmConflicts([{ ...MESSENGER, config: null }], target)).toEqual([]);
  });
});

describe("mensajes", () => {
  it("el duplicado nombra la cuenta existente", () => {
    const text = conflictMessage(
      [{ id: "m1", name: "Messenger | DM Nativa", provider: "MESSENGER", by: "pageId" }],
      { pageId: "PAGE-1" }
    );
    expect(text).toContain("«Messenger | DM Nativa»");
    expect(text).toContain("PAGE-1");
    expect(text).toContain("no se creó nada");
  });

  it("si solo choca Instagram, sugiere desmarcarlo", () => {
    const text = conflictMessage(
      [{ id: "i1", name: "IG - Nativa", provider: "INSTAGRAM", by: "igBusinessId" }],
      { pageId: "PAGE-1", igBusinessId: "IG-1" }
    );
    expect(text).toContain("«IG - Nativa»");
    expect(text).toContain("IG-1");
    expect(text).toContain("Desmarca «Incluir Instagram»");
  });

  it("Página sin Instagram vinculado", () => {
    expect(noLinkedInstagramMessage("Nativa Tulum")).toContain("«Nativa Tulum» no tiene una cuenta de Instagram Business vinculada");
    expect(noLinkedInstagramMessage("")).toContain("«sin nombre»");
  });

  it("ID de Instagram que no es el de la Página: dice cuál es el bueno", () => {
    const text = igMismatchMessage({ id: "IG-1", username: "nativatulum" }, "IG-9", "Nativa Tulum");
    expect(text).toContain("IG-9");
    expect(text).toContain("@nativatulum (IG-1)");
  });
});
