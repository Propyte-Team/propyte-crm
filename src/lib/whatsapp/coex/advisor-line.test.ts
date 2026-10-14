// ¿Es el WhatsApp propio de un asesor? (2026-10-14, PR 2). Falla CERRADO: si no se puede leer la
// cuenta, se trata como de asesor (el bot calla). Sin la columna (migración sin aplicar), no.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ default: { leadConnector: { findUnique: (...a: unknown[]) => findUnique(...a), findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import { findAdvisorLineByPhoneNumberId, isAdvisorLine } from "./advisor-line";

beforeEach(() => {
  findUnique.mockReset();
  findFirst.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isAdvisorLine", () => {
  it("sin cuenta (número global) → false sin consultar", async () => {
    expect(await isAdvisorLine(null)).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("por el alcance de la cuenta", async () => {
    findUnique.mockResolvedValueOnce({ scope: "ADVISOR" }).mockResolvedValueOnce({ scope: "BRAND" }).mockResolvedValueOnce(null);
    expect(await isAdvisorLine("a")).toBe(true);
    expect(await isAdvisorLine("b")).toBe(false);
    expect(await isAdvisorLine("x")).toBe(false);
  });
  it("🚨 error de lectura → true (falla cerrado)", async () => {
    findUnique.mockRejectedValue(new Error("db caída"));
    expect(await isAdvisorLine("a")).toBe(true);
  });
  it("columna inexistente (P2022) → false: no puede haber cuentas de asesor", async () => {
    findUnique.mockRejectedValue(Object.assign(new Error("col"), { code: "P2022" }));
    expect(await isAdvisorLine("a")).toBe(false);
  });
});

describe("findAdvisorLineByPhoneNumberId", () => {
  it("busca en cualquier estado (pausada, en error o borrada), solo de asesor", async () => {
    findFirst.mockResolvedValue({ id: "conn-ana" });
    expect(await findAdvisorLineByPhoneNumberId("pn-1")).toEqual({ id: "conn-ana" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { provider: "WHATSAPP", scope: "ADVISOR", config: { path: ["phoneNumberId"], equals: "pn-1" } },
      select: { id: true },
    });
  });
});
