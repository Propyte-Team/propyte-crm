// Parte pura de la asignación masiva del panel de huérfanos (2026-10-14, #883).
import { describe, it, expect } from "vitest";
import { contactosMarcables, enLotes, esMarcable, resumenLote, sumarResultados } from "./orphan-bulk";
import type { OrphanLeads } from "@/server/orphan-leads";

const fila = (id: string, owner: { name: string; email: string } | null) => ({
  id,
  name: id,
  leadSource: "WHATSAPP_DIRECTO",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastMessageAt: null,
  brandIds: [],
  owner,
});
const hilo = (contactId: string, owner: { name: string; email: string } | null) => ({
  conversationId: `conv-${contactId}`,
  contactId,
  name: contactId,
  leadSource: "WHATSAPP_DIRECTO",
  createdAt: "2026-10-01T00:00:00.000Z",
  lastMessageAt: null,
  noteAt: "2026-10-01T00:00:00.000Z",
  account: null,
  brandIds: [],
  owner,
});
const QA = { name: "Agentes", email: "agentes@propyte.local" };
const ANA = { name: "Ana", email: "ana@propyte.com" };

describe("esMarcable", () => {
  it("sin dueño o con dueño técnico → sí; con dueño de verdad → no", () => {
    expect(esMarcable(null)).toBe(true);
    expect(esMarcable(QA)).toBe(true);
    expect(esMarcable(ANA)).toBe(false);
  });
});

describe("contactosMarcables", () => {
  it("junta las tres secciones sin repetir y deja fuera los hilos con dueño de verdad", () => {
    const data: OrphanLeads = {
      unowned: { rows: [fila("a", null), fila("b", null)], total: 2 },
      technical: { rows: [fila("c", QA)], total: 1 },
      unregistered: { rows: [hilo("a", null), hilo("d", ANA), hilo("e", QA)], total: 3 },
    };
    expect(contactosMarcables(data)).toEqual(["a", "b", "c", "e"]);
  });
});

describe("enLotes", () => {
  it("parte en trozos del tope", () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(enLotes(Array.from({ length: 111 }, (_, i) => i), 200)).toHaveLength(1);
    expect(enLotes([], 200)).toEqual([]);
  });
});

describe("resumenLote", () => {
  it("cifras, quién y por qué falló lo que falló", () => {
    const r = sumarResultados([
      { asignados: 100, yaEranSuyos: 1, fallidos: [{ contactId: "x", code: "ya-asignado" }] },
      { asignados: 9, yaEranSuyos: 0, fallidos: [{ contactId: "y", code: "ya-asignado" }, { contactId: "z", code: "conflicto" }] },
    ]);
    expect(r.asignados).toBe(109);
    expect(resumenLote(r, "ti")).toBe(
      "109 prospectos asignados a ti. 1 ya era suyo. 3 no se pudieron: 2 con dueño, 1 con cambios recientes (vuelve a intentar).",
    );
  });

  it("singular y sin fallas", () => {
    expect(resumenLote({ asignados: 1, yaEranSuyos: 0, fallidos: [] }, "Pedro Ruiz")).toBe("1 prospecto asignado a Pedro Ruiz.");
  });
});
