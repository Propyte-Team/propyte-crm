import { describe, expect, it } from "vitest";
import { autorizarRevision } from "./auth";

const TOKEN = "a".repeat(64);

function post(headers: Record<string, string> = {}, url = "https://crm.propyte.com/api/mcp/revision") {
  return new Request(url, { method: "POST", headers });
}

describe("autorizarRevision", () => {
  it("acepta el token por cabecera Bearer", () => {
    expect(autorizarRevision(post({ authorization: `Bearer ${TOKEN}` }), TOKEN).ok).toBe(true);
  });

  it("acepta el token en el segmento de la URL, que es el único camino de claude.ai", () => {
    expect(autorizarRevision(post(), TOKEN, TOKEN).ok).toBe(true);
  });

  it("acepta el token por query, para clientes que recortan el path", () => {
    const req = post({}, `https://crm.propyte.com/api/mcp/revision?token=${TOKEN}`);
    expect(autorizarRevision(req, TOKEN).ok).toBe(true);
  });

  it("una cabecera equivocada NO invalida una URL correcta", () => {
    // El cliente que autentica por URL puede traer un `Authorization` de su propia
    // infraestructura que no tiene nada que ver con esta puerta.
    const req = post({ authorization: "Bearer de-otra-cosa" });
    expect(autorizarRevision(req, TOKEN, TOKEN).ok).toBe(true);
  });

  it("rechaza sin token", () => {
    const r = autorizarRevision(post(), TOKEN);
    expect(r).toMatchObject({ ok: false, status: 401, error: "unauthorized" });
  });

  it("rechaza un token equivocado del mismo largo", () => {
    expect(autorizarRevision(post({ authorization: `Bearer ${"b".repeat(64)}` }), TOKEN).ok).toBe(false);
  });

  it("rechaza un token de otro largo sin reventar", () => {
    // `timingSafeEqual` lanza si los buffers miden distinto: la diferencia se resuelve
    // antes y devuelve `false`, no una excepción.
    expect(() => autorizarRevision(post({ authorization: "Bearer corto" }), TOKEN)).not.toThrow();
    expect(autorizarRevision(post({ authorization: "Bearer corto" }), TOKEN).ok).toBe(false);
  });

  it("🚨 un servidor SIN token configurado rechaza todo, incluida la URL vacía", () => {
    // Sin esta guarda, un deploy sin la variable compararía cadena vacía contra cadena
    // vacía y CUALQUIER URL abriría la puerta a los datos del CRM.
    expect(autorizarRevision(post(), "", "").ok).toBe(false);
    expect(autorizarRevision(post({ authorization: "Bearer " }), "").ok).toBe(false);
  });

  it("contesta 405 a métodos que no son POST, con el motivo", () => {
    const req = new Request("https://crm.propyte.com/api/mcp/revision", { method: "GET" });
    const r = autorizarRevision(req, TOKEN, TOKEN);
    expect(r).toMatchObject({ ok: false, status: 405 });
    if (!r.ok) expect(r.hint).toMatch(/POST/);
  });

  it("el 401 nombra SU variable y advierte de la que escribe", () => {
    // Con cuatro secretos MCP distintos, un hint que nombra la variable equivocada manda
    // a rotar la que sí estaba bien.
    const r = autorizarRevision(post(), TOKEN);
    if (r.ok) throw new Error("debía fallar");
    expect(r.hint).toContain("MCP_REVISION_TOKEN");
    expect(r.hint).toContain("CRM_MCP_API_TOKEN");
  });

  it("decodifica un token doblemente escapado en la URL", () => {
    const conSimbolos = "abc/def+ghi=";
    expect(autorizarRevision(post(), conSimbolos, encodeURIComponent(conSimbolos)).ok).toBe(true);
  });
});
