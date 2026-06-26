import { describe, it, expect } from "vitest";
import { renderVars, plainToHtml, resolveEmailContent, resolveEmailSender } from "./compose";

describe("renderVars", () => {
  it("reemplaza variables y quita la línea si queda una sin resolver", () => {
    const out = renderVars("Hola {{contact.firstName}}\nSaldo {{x}}\nFin", { "contact.firstName": "Ana" });
    expect(out).toBe("Hola Ana\nFin");
  });
});

describe("plainToHtml", () => {
  it("escapa HTML y convierte saltos de línea en <br>", () => {
    expect(plainToHtml("a<b>\nc")).toContain("a&lt;b&gt;");
    expect(plainToHtml("a\nc")).toContain("<br>");
  });
});

describe("resolveEmailContent", () => {
  const vars = { "contact.firstName": "Ana" };
  it("usa el template (subject+body) y renderiza variables", () => {
    const r = resolveEmailContent({ template: { subject: "Hola {{contact.firstName}}", body: "Cuerpo {{contact.firstName}}" }, configSubject: undefined, configBody: undefined, vars });
    expect(r).toEqual({ subject: "Hola Ana", body: "Cuerpo Ana" });
  });
  it("usa config inline si no hay template", () => {
    const r = resolveEmailContent({ template: null, configSubject: "Asunto", configBody: "Texto {{contact.firstName}}", vars });
    expect(r).toEqual({ subject: "Asunto", body: "Texto Ana" });
  });
  it("sin body → null", () => {
    expect(resolveEmailContent({ template: null, configSubject: "x", configBody: undefined, vars })).toBeNull();
  });
  it("sin subject → null", () => {
    expect(resolveEmailContent({ template: null, configSubject: undefined, configBody: "x", vars })).toBeNull();
  });
});

describe("resolveEmailSender", () => {
  it("owner con Google conectado → gmail", async () => {
    expect(await resolveEmailSender("u1", async () => true)).toEqual({ kind: "gmail", userId: "u1" });
  });
  it("owner sin conexión → smtp conservando userId", async () => {
    expect(await resolveEmailSender("u1", async () => false)).toEqual({ kind: "smtp", userId: "u1" });
  });
  it("sin owner → smtp userId null", async () => {
    expect(await resolveEmailSender(null, async () => true)).toEqual({ kind: "smtp", userId: null });
  });
});
