import { describe, expect, it } from "vitest";
import { toolDescriptor } from "./rpc";
import { REVISION_TOOLS } from "./tools";

/**
 * Guardias del catálogo.
 *
 * No prueban que las descripciones sean BUENAS —eso no lo prueba un test—, sino que una
 * tool nueva no entre sin el contrato. Ese es el fallo probable: alguien agrega la décima
 * tool en seis meses, se le olvida la descripción, y el cliente la vuelve invisible sin
 * ningún síntoma. Ya pasó en este ecosistema.
 */

describe("catálogo de la puerta de revisión", () => {
  it("expone las 9 tools del spec", () => {
    expect(REVISION_TOOLS).toHaveLength(9);
  });

  it("todos los nombres llevan el prefijo del producto y son únicos", () => {
    const nombres = REVISION_TOOLS.map((t) => t.name);
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const n of nombres) expect(n).toMatch(/^crm_/);
  });

  it.each(REVISION_TOOLS.map((t) => [t.name, t] as const))(
    "%s tiene descripción con las cuatro partes del contrato",
    (_nombre, tool) => {
      expect(tool.description.trim().length).toBeGreaterThan(200);
      // Intención · cuándo usarla · ejemplo · limitación. Las dos marcas explícitas son
      // lo único verificable de forma mecánica; sostienen la estructura para quien agregue
      // la siguiente tool.
      expect(tool.description).toMatch(/Úsala/);
      expect(tool.description).toMatch(/Ejemplo/);
    },
  );

  it("TODAS declaran readOnlyHint en el handshake, no solo en un test", () => {
    // Si la promesa "no escribo" vive únicamente en la suite, el cliente no puede verla.
    for (const t of REVISION_TOOLS) {
      expect(t.annotations?.readOnlyHint, `${t.name} sin readOnlyHint`).toBe(true);
    }
  });

  it("todos los inputSchema son objetos JSON Schema válidos y cerrados", () => {
    for (const t of REVISION_TOOLS) {
      expect(t.inputSchema.type, `${t.name}`).toBe("object");
      // `additionalProperties: false` hace que un argumento mal escrito falle en el
      // cliente en vez de ignorarse en silencio.
      expect(t.inputSchema.additionalProperties, `${t.name}`).toBe(false);
      expect(() => JSON.stringify(t.inputSchema)).not.toThrow();
    }
  });

  it("el descriptor público no filtra el handler", () => {
    for (const t of REVISION_TOOLS) {
      expect(Object.keys(toolDescriptor(t))).not.toContain("handler");
    }
  });

  it("las tools con argumentos documentan cada propiedad", () => {
    for (const t of REVISION_TOOLS) {
      const props = (t.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [k, v] of Object.entries(props)) {
        expect(v.description, `${t.name}.${k} sin description`).toBeTruthy();
      }
    }
  });
});
