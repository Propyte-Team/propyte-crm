import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { leadConnector: { findFirst: (...a: unknown[]) => findFirst(...a), findMany: (...a: unknown[]) => findMany(...a) } },
}));

const markConnectorLead = vi.fn();
vi.mock("@/lib/intake/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intake/connectors")>();
  return { ...actual, markConnectorLead: (...a: unknown[]) => markConnectorLead(...a) };
});

import {
  resolveConnectorByIgBusinessId,
  resolveConnectorByPageId,
  getSocialPageToken,
  markSocialConnectorsSignatureRejected,
} from "./social-accounts";

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  markConnectorLead.mockReset();
  markConnectorLead.mockResolvedValue(undefined);
});

describe("resolveConnectorByIgBusinessId", () => {
  it("consulta por provider INSTAGRAM y config.igBusinessId (JSONB path), no por credentials", async () => {
    findFirst.mockResolvedValue({ id: "conn_ig" });
    const r = await resolveConnectorByIgBusinessId("17841453458089530");
    expect(r?.id).toBe("conn_ig");
    const where = findFirst.mock.calls[0][0].where;
    expect(where.provider).toBe("INSTAGRAM");
    expect(where.status).toBe("ACTIVE");
    expect(where.config).toEqual({ path: ["igBusinessId"], equals: "17841453458089530" });
  });
});

describe("resolveConnectorByPageId", () => {
  it("consulta por provider MESSENGER y config.pageId", async () => {
    findFirst.mockResolvedValue(null);
    await resolveConnectorByPageId("103981554499114");
    const where = findFirst.mock.calls[0][0].where;
    expect(where.provider).toBe("MESSENGER");
    expect(where.config).toEqual({ path: ["pageId"], equals: "103981554499114" });
  });
});

describe("markSocialConnectorsSignatureRejected", () => {
  it("consulta conectores ACTIVE de INSTAGRAM/MESSENGER y marca cada uno con el motivo (#767)", async () => {
    findMany.mockResolvedValue([{ id: "conn_ig" }, { id: "conn_msn" }]);
    await markSocialConnectorsSignatureRejected("firma inválida (401)");

    const where = findMany.mock.calls[0][0].where;
    expect(where.provider).toEqual({ in: ["INSTAGRAM", "MESSENGER"] });
    expect(where.status).toBe("ACTIVE");
    expect(where.deletedAt).toBeNull();

    expect(markConnectorLead).toHaveBeenCalledTimes(2);
    expect(markConnectorLead).toHaveBeenCalledWith("conn_ig", "firma inválida (401)");
    expect(markConnectorLead).toHaveBeenCalledWith("conn_msn", "firma inválida (401)");
  });

  it("sin conectores activos, no llama a markConnectorLead", async () => {
    findMany.mockResolvedValue([]);
    await markSocialConnectorsSignatureRejected("firma inválida (401)");
    expect(markConnectorLead).not.toHaveBeenCalled();
  });

  // Best-effort a propósito: un fallo al marcar el rechazo nunca debe impedir que el 401
  // ya decidido se responda — es monitoreo, no parte del contrato del webhook.
  it("si la consulta falla, se traga el error en vez de propagarlo", async () => {
    findMany.mockRejectedValue(new Error("db caída"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(markSocialConnectorsSignatureRejected("firma inválida (401)")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("getSocialPageToken", () => {
  it("devuelve el token descifrado y null si falta", () => {
    const conn = { id: "c1" } as never;
    expect(getSocialPageToken(conn, () => ({ pageAccessToken: "T" }))).toBe("T");
    expect(getSocialPageToken(conn, () => ({}))).toBeNull();
    expect(getSocialPageToken(conn, () => null)).toBeNull();
  });
});
