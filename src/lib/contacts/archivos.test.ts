import { describe, it, expect } from "vitest";
import {
  CV_MAX_BYTES,
  extension,
  motivoRechazo,
  nombreLimpio,
  puedeBorrar,
  puedeSubir,
  rutaCv,
  rutaEsDelContacto,
  tamanoLegible,
} from "./archivos";

// #917 — reglas de los CV de la ficha.

const C = "11111111-1111-4111-8111-111111111111";

describe("qué archivos se aceptan", () => {
  it("PDF, DOC y DOCX hasta 10 MB", () => {
    expect(motivoRechazo({ fileName: "cv.pdf", mimeType: "application/pdf", sizeBytes: 200_000 })).toBeNull();
    expect(motivoRechazo({ fileName: "CV Ana.DOC", mimeType: "application/msword", sizeBytes: 1 })).toBeNull();
    expect(
      motivoRechazo({
        fileName: "cv.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: CV_MAX_BYTES,
      })
    ).toBeNull();
    // Word sin tipo (algunos navegadores en Windows) también entra.
    expect(motivoRechazo({ fileName: "cv.docx", mimeType: "", sizeBytes: 10 })).toBeNull();
  });

  it("rechaza otras extensiones, tipos que no cuadran, vacíos y de más de 10 MB", () => {
    expect(motivoRechazo({ fileName: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 10 })).toMatch(/PDF o Word/);
    expect(motivoRechazo({ fileName: "sin-extension", mimeType: "application/pdf", sizeBytes: 10 })).toMatch(/PDF o Word/);
    expect(motivoRechazo({ fileName: "truco.pdf", mimeType: "text/html", sizeBytes: 10 })).toMatch(/no parece/);
    expect(motivoRechazo({ fileName: "cv.pdf", mimeType: "application/pdf", sizeBytes: 0 })).toMatch(/vacío/);
    expect(motivoRechazo({ fileName: "cv.pdf", mimeType: "application/pdf", sizeBytes: CV_MAX_BYTES + 1 })).toMatch(/10 MB/);
  });

  it("extension", () => {
    expect([extension("a.PDF"), extension("a.b.docx"), extension(".pdf"), extension("x")]).toEqual(["pdf", "docx", "", ""]);
  });
});

describe("rutas del bucket", () => {
  it("cada subida va a contacts/<id>/cv/<uuid>.<ext>, sin el nombre original", () => {
    const r = rutaCv(C, "Currículum Ana López.pdf");
    expect(r).toMatch(new RegExp(`^contacts/${C}/cv/[0-9a-f-]{36}\\.pdf$`));
    expect(r).not.toContain("Ana");
    expect(rutaCv(C, "a.pdf")).not.toBe(rutaCv(C, "a.pdf"));
  });

  it("solo se confirma una ruta de ESTE contacto y con forma de CV", () => {
    const r = rutaCv(C, "cv.docx");
    expect(rutaEsDelContacto(r, C)).toBe(true);
    expect(rutaEsDelContacto(r, "22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(rutaEsDelContacto(`contacts/${C}/cv/../../otro/x.pdf`, C)).toBe(false);
    expect(rutaEsDelContacto(`contacts/${C}/cv/${"a".repeat(36)}.exe`, C)).toBe(false);
  });
});

describe("permisos", () => {
  it("solo lectura (Marketing, desarrollador externo) no sube; los demás sí", () => {
    expect(["ADMIN", "DIRECTOR", "GERENTE", "ASESOR", "TEAM_LEADER"].every(puedeSubir)).toBe(true);
    expect(["MARKETING", "DEVELOPER_EXT"].some(puedeSubir)).toBe(false);
  });

  it("borra quien lo subió o un Admin/Director", () => {
    const archivo = { uploadedById: "u1" };
    expect(puedeBorrar({ id: "u1", role: "ASESOR" }, archivo)).toBe(true);
    expect(puedeBorrar({ id: "u2", role: "ASESOR" }, archivo)).toBe(false);
    expect(puedeBorrar({ id: "u2", role: "GERENTE" }, archivo)).toBe(false);
    expect(puedeBorrar({ id: "u3", role: "ADMIN" }, archivo)).toBe(true);
    expect(puedeBorrar({ id: "u4", role: "DIRECTOR" }, archivo)).toBe(true);
    expect(puedeBorrar({ id: "u1", role: "MARKETING" }, archivo)).toBe(false);
  });
});

describe("presentación", () => {
  it("nombreLimpio quita rutas y caracteres de control", () => {
    expect(nombreLimpio("C:\\Users\\ana\\CV.pdf")).toBe("CV.pdf");
    expect(nombreLimpio("../../x\u0000.pdf")).toBe("x.pdf");
    expect(nombreLimpio("   ")).toBe("CV");
  });

  it("tamanoLegible", () => {
    expect([tamanoLegible(500), tamanoLegible(220 * 1024), tamanoLegible(2.5 * 1024 * 1024)]).toEqual(["500 B", "220 KB", "2.5 MB"]);
  });
});
