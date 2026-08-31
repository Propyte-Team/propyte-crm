import { describe, it, expect, vi, beforeEach } from "vitest";

const leadConnectorUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { leadConnector: { update: (...a: unknown[]) => leadConnectorUpdate(...a) } },
}));

import { markConnectorLead } from "./connectors";

beforeEach(() => {
  leadConnectorUpdate.mockReset();
  leadConnectorUpdate.mockResolvedValue({});
});

describe("markConnectorLead", () => {
  it("sin error: sella lastLeadAt y limpia el contador", async () => {
    await markConnectorLead("conn-1");
    const arg = leadConnectorUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { lastLeadAt: Date; errorCount: number; lastError: null };
    };
    expect(arg.where).toEqual({ id: "conn-1" });
    expect(arg.data.lastLeadAt).toBeInstanceOf(Date);
    expect(arg.data.errorCount).toBe(0);
    expect(arg.data.lastError).toBeNull();
  });

  it("con error: incrementa el contador y NO toca lastLeadAt", async () => {
    await markConnectorLead("conn-1", "boom");
    const arg = leadConnectorUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({ errorCount: { increment: 1 }, lastError: "boom" });
    expect(arg.data).not.toHaveProperty("lastLeadAt");
  });

  it("recorta el detalle del error a 1000 caracteres (la columna no es infinita)", async () => {
    await markConnectorLead("conn-1", "x".repeat(5000));
    const arg = leadConnectorUpdate.mock.calls[0][0] as { data: { lastError: string } };
    expect(arg.data.lastError).toHaveLength(1000);
  });

  // El contrato es best-effort: la marca de monitoreo NUNCA debe tumbar la ingesta del
  // lead que la produjo. Si esto deja de cumplirse, un fallo de la columna de señal de
  // vida se lleva por delante un prospecto real.
  it("si la escritura falla, se traga el error en vez de propagarlo", async () => {
    leadConnectorUpdate.mockRejectedValue(new Error("db caída"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(markConnectorLead("conn-1")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
