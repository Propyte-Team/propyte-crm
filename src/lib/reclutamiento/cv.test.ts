import { describe, it, expect, vi, beforeEach } from "vitest";

const candFindFirst = vi.fn();
const fileFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    recruitCandidate: { findFirst: (...a: unknown[]) => candFindFirst(...a) },
    recruitCandidateFile: { findFirst: (...a: unknown[]) => fileFindFirst(...a) },
  },
}));
const copiarDeChatMedia = vi.fn();
vi.mock("@/lib/storage/crm-attachments", () => ({ copiarDeChatMedia: (...a: unknown[]) => copiarDeChatMedia(...a) }));
const registrarCvDeCandidato = vi.fn();
vi.mock("@/server/reclutamiento", () => ({ registrarCvDeCandidato: (...a: unknown[]) => registrarCvDeCandidato(...a) }));

import { esMimeDeCv, ligarCv } from "./cv";

beforeEach(() => {
  candFindFirst.mockReset();
  fileFindFirst.mockReset();
  copiarDeChatMedia.mockReset();
  registrarCvDeCandidato.mockReset();
});

describe("esMimeDeCv", () => {
  it("acepta PDF y Word; rechaza imagen, audio y video (mismas reglas que la subida manual)", () => {
    expect(esMimeDeCv("application/pdf")).toBe(true);
    expect(esMimeDeCv("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(esMimeDeCv("application/msword")).toBe(true);
    expect(esMimeDeCv("image/jpeg")).toBe(false);
    expect(esMimeDeCv("audio/ogg")).toBe(false);
    expect(esMimeDeCv("video/mp4")).toBe(false);
    expect(esMimeDeCv(null)).toBe(false);
  });
  it("normaliza mayúsculas y parámetros del MIME", () => {
    expect(esMimeDeCv("Application/PDF; charset=binary")).toBe(true);
  });
});

describe("ligarCv", () => {
  const msg = { id: "m1", contactId: "k1", mediaUrl: "2026-11/abc.pdf", mediaMimeType: "application/pdf", mediaFilename: "CV Ana.pdf" };
  it("copia el adjunto al bucket de CV y lo registra con origen CHAT", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(12345);
    registrarCvDeCandidato.mockResolvedValue({ id: "f1", duplicado: false });
    expect(await ligarCv(msg)).toBe(true);
    const [origen, destino, mime] = copiarDeChatMedia.mock.calls[0] as [string, string, string];
    expect(origen).toBe("2026-11/abc.pdf");
    expect(destino).toMatch(/^candidates\/c1\/cv\/[0-9a-f-]{36}\.pdf$/);
    expect(mime).toBe("application/pdf");
    expect(registrarCvDeCandidato).toHaveBeenCalledWith({
      candidateId: "c1", storagePath: destino, fileName: "CV Ana.pdf", mimeType: "application/pdf",
      sizeBytes: 12345, source: "CHAT", sourceRef: "m1", uploadedById: null,
    });
  });
  it("sin nombre de archivo usa uno por extensión", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(1);
    registrarCvDeCandidato.mockResolvedValue({ id: "f1", duplicado: false });
    await ligarCv({ ...msg, mediaFilename: null, mediaMimeType: "application/msword" });
    expect((registrarCvDeCandidato.mock.calls[0][0] as { fileName: string }).fileName).toBe("cv.doc");
    expect((copiarDeChatMedia.mock.calls[0] as string[])[1]).toMatch(/\.doc$/);
  });
  it("nombre sin extensión: la toma del MIME (ruta y nombre terminan en .pdf)", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(1);
    registrarCvDeCandidato.mockResolvedValue({ id: "f1", duplicado: false });
    await ligarCv({ ...msg, mediaFilename: "CV Ana" });
    expect((copiarDeChatMedia.mock.calls[0] as string[])[1]).toMatch(/^candidates\/c1\/cv\/[0-9a-f-]{36}\.pdf$/);
    expect((registrarCvDeCandidato.mock.calls[0][0] as { fileName: string }).fileName).toBe("CV Ana.pdf");
  });
  it("extensión ajena al MIME (cv.bin con PDF): se reemplaza por .pdf", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(1);
    registrarCvDeCandidato.mockResolvedValue({ id: "f1", duplicado: false });
    await ligarCv({ ...msg, mediaFilename: "cv.bin" });
    expect((copiarDeChatMedia.mock.calls[0] as string[])[1]).toMatch(/\.pdf$/);
    expect((registrarCvDeCandidato.mock.calls[0][0] as { fileName: string }).fileName).toBe("cv.pdf");
  });
  it("MIME con mayúsculas y parámetros: se acepta y se guarda normalizado", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(1);
    registrarCvDeCandidato.mockResolvedValue({ id: "f1", duplicado: false });
    expect(await ligarCv({ ...msg, mediaMimeType: "Application/PDF; charset=binary" })).toBe(true);
    expect((copiarDeChatMedia.mock.calls[0] as string[])[2]).toBe("application/pdf");
    expect((registrarCvDeCandidato.mock.calls[0][0] as { mimeType: string }).mimeType).toBe("application/pdf");
  });
  it("el mismo mensaje no se registra dos veces (no copia de nuevo)", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue({ id: "f1" });
    expect(await ligarCv(msg)).toBe(false);
    expect(copiarDeChatMedia).not.toHaveBeenCalled();
  });
  it("sin candidato, media externa (no del bucket), sin media o mime no válido → false", async () => {
    candFindFirst.mockResolvedValue(null);
    expect(await ligarCv(msg)).toBe(false);
    candFindFirst.mockResolvedValue({ id: "c1" });
    expect(await ligarCv({ ...msg, mediaUrl: "https://cdn.meta.com/x.pdf" })).toBe(false);
    expect(await ligarCv({ ...msg, mediaUrl: null })).toBe(false);
    expect(await ligarCv({ ...msg, mediaMimeType: "image/jpeg" })).toBe(false);
    expect(copiarDeChatMedia).not.toHaveBeenCalled();
  });
  it("si la copia falla no registra nada", async () => {
    candFindFirst.mockResolvedValue({ id: "c1" });
    fileFindFirst.mockResolvedValue(null);
    copiarDeChatMedia.mockResolvedValue(null);
    expect(await ligarCv(msg)).toBe(false);
    expect(registrarCvDeCandidato).not.toHaveBeenCalled();
  });
  it("sin migrar (P2022) → false sin lanzar", async () => {
    candFindFirst.mockRejectedValue(Object.assign(new Error(), { code: "P2022" }));
    expect(await ligarCv(msg)).toBe(false);
  });
});
