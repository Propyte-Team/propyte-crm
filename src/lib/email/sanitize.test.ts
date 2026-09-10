import { describe, it, expect, vi, afterEach } from "vitest";
import { sanitizeEmailHtml } from "./sanitize";

// Auditoría 2026-09-10. Cada caso de "vectores" es una forma real de ejecutar código con
// `dangerouslySetInnerHTML`, que es lo que hacía email-thread.tsx con el HTML de Gmail sin
// sanear. El ataque sólo necesita MANDAR UN CORREO al asesor.

afterEach(() => vi.restoreAllMocks());

describe("sanitizeEmailHtml — vectores de ejecución", () => {
  it("quita <script>", () => {
    const out = sanitizeEmailHtml('<p>hola</p><script>fetch("/api/contacts")</script>');
    expect(out).toContain("hola");
    expect(out).not.toContain("script");
    expect(out).not.toContain("fetch");
  });

  it("🚨 quita onerror de <img> — el vector que SÍ ejecuta con innerHTML", () => {
    const out = sanitizeEmailHtml('<img src=x onerror="alert(document.cookie)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("quita onload de <svg>", () => {
    const out = sanitizeEmailHtml('<svg onload="alert(1)"></svg>');
    expect(out).not.toContain("onload");
    expect(out).not.toContain("svg");
  });

  it("quita cualquier manejador en atributo", () => {
    const out = sanitizeEmailHtml(
      '<div onclick="x()" onmouseover="y()" onfocus="z()">texto</div>',
    );
    expect(out).toContain("texto");
    for (const h of ["onclick", "onmouseover", "onfocus"]) expect(out).not.toContain(h);
  });

  it("quita <iframe>", () => {
    const out = sanitizeEmailHtml('<iframe src="javascript:alert(1)"></iframe>');
    expect(out).not.toContain("iframe");
  });

  it("neutraliza href javascript:", () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">clic</a>');
    expect(out).not.toContain("javascript:");
    expect(out).toContain("clic");
  });

  it("neutraliza href data:text/html", () => {
    const out = sanitizeEmailHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">clic</a>');
    expect(out).not.toContain("data:text/html");
  });

  it("quita <form> e <input> — un correo no debe imitar la interfaz del CRM", () => {
    const out = sanitizeEmailHtml(
      '<form action="https://malo.example"><input name="password"></form>',
    );
    expect(out).not.toContain("form");
    expect(out).not.toContain("input");
  });

  it("quita <style>, que puede repintar la página entera", () => {
    const out = sanitizeEmailHtml("<style>body{display:none}</style><p>hola</p>");
    expect(out).not.toContain("style>");
    expect(out).not.toContain("display:none");
    expect(out).toContain("hola");
  });

  it("descarta position/z-index en style aunque el resto pase", () => {
    const out = sanitizeEmailHtml(
      '<div style="color:#ff0000;position:fixed;z-index:9999">x</div>',
    );
    expect(out).not.toContain("position");
    expect(out).not.toContain("z-index");
    expect(out).toContain("color");
  });

  it("descarta url(javascript:) dentro de style", () => {
    const out = sanitizeEmailHtml(
      '<div style="background-color:url(javascript:alert(1))">x</div>',
    );
    expect(out).not.toContain("javascript");
  });
});

describe("sanitizeEmailHtml — lo que un correo legítimo necesita SÍ sobrevive", () => {
  it("conserva el formato de texto", () => {
    const out = sanitizeEmailHtml("<p><strong>Hola</strong> <em>Ana</em><br>¿cómo vas?</p>");
    expect(out).toContain("<strong>Hola</strong>");
    expect(out).toContain("<em>Ana</em>");
    expect(out).toContain("¿cómo vas?");
  });

  it("conserva tablas, que es como maqueta la mitad del correo comercial", () => {
    const out = sanitizeEmailHtml(
      '<table border="1"><tr><td colspan="2">Depto 101</td></tr></table>',
    );
    expect(out).toContain("<table");
    expect(out).toContain("<td");
    expect(out).toContain("colspan");
    expect(out).toContain("Depto 101");
  });

  it("conserva listas y citas del hilo", () => {
    const out = sanitizeEmailHtml("<blockquote><ul><li>uno</li></ul></blockquote>");
    expect(out).toContain("blockquote");
    expect(out).toContain("<li>uno</li>");
  });

  it("conserva imágenes http/https y las incrustadas del correo", () => {
    expect(sanitizeEmailHtml('<img src="https://x.test/a.png">')).toContain("https://x.test/a.png");
    expect(sanitizeEmailHtml('<img src="cid:logo123">')).toContain("cid:logo123");
  });

  it("un enlace legítimo se conserva y sale con noopener a otra pestaña", () => {
    const out = sanitizeEmailHtml('<a href="https://propyte.com">web</a>');
    expect(out).toContain('href="https://propyte.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener");
  });

  it("mailto y tel siguen funcionando", () => {
    expect(sanitizeEmailHtml('<a href="mailto:a@b.com">m</a>')).toContain("mailto:a@b.com");
    expect(sanitizeEmailHtml('<a href="tel:+5219981234567">t</a>')).toContain("tel:+52");
  });
});

describe("sanitizeEmailHtml — entradas raras", () => {
  it("vacío, espacios y no-cadenas devuelven cadena vacía (la vista cae al texto plano)", () => {
    for (const v of ["", "   ", null, undefined, 42, {}, []]) {
      expect(sanitizeEmailHtml(v)).toBe("");
    }
  });

  it("HTML roto no lanza", () => {
    expect(() => sanitizeEmailHtml("<p><div><span>sin cerrar")).not.toThrow();
  });

  it("si el saneador reventara, se descarta el HTML — nunca se devuelve el original", () => {
    // La dirección del fallo importa: devolver el original ante un error sería
    // reabrir exactamente el agujero que este módulo cierra.
    const malicioso = { toString: () => '<img src=x onerror="alert(1)">' };
    expect(sanitizeEmailHtml(malicioso)).toBe("");
  });
});
