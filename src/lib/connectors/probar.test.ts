import { describe, it, expect, vi } from "vitest";
import { probarConector, credencialesParaProbar } from "./probar";

const meta = { provider: "MESSENGER", config: { pageId: 123 }, credentials: "x" } as never;

describe("credencialesParaProbar", () => {
  it("une config y credenciales; las credenciales ganan", () => {
    expect(credencialesParaProbar({ pageId: 1, igBusinessId: "9", ignorado: { a: 1 } }, { pageAccessToken: "t", pageId: "2" })).toEqual({
      pageId: "2", igBusinessId: "9", pageAccessToken: "t",
    });
  });
  it("config vacía o inválida no rompe", () => {
    expect(credencialesParaProbar(null, { a: "b" })).toEqual({ a: "b" });
  });
});

describe("probarConector", () => {
  it("éxito: pasa las credenciales unidas y devuelve el nombre de la cuenta", async () => {
    const probar = vi.fn().mockResolvedValue({ ok: true, accountName: "Nativa Tulum" });
    const r = await probarConector(meta, { leerCredenciales: () => ({ pageAccessToken: "tok" }), probar });
    expect(r).toEqual({ ok: true, detalle: "Conexión válida · Nativa Tulum" });
    expect(probar).toHaveBeenCalledWith("MESSENGER", { pageId: "123", pageAccessToken: "tok" });
  });
  it("fallo: traduce el error de Meta y conserva el crudo", async () => {
    const crudo = "(#190) Error validating access token: Session has expired";
    const r = await probarConector(meta, {
      leerCredenciales: () => ({ pageAccessToken: "tok" }),
      probar: async () => ({ ok: false, detail: crudo }),
    });
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/caducó/);
    expect(r.error).toBe(crudo);
  });
  it("credenciales ilegibles: no llama al proveedor", async () => {
    const probar = vi.fn();
    const r = await probarConector(meta, { leerCredenciales: () => null, probar });
    expect(r.ok).toBe(false);
    expect(probar).not.toHaveBeenCalled();
  });
  it("proveedor sin prueba", async () => {
    const r = await probarConector({ provider: "YOUTUBE", config: {}, credentials: null } as never);
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/no se puede probar/);
  });
});
