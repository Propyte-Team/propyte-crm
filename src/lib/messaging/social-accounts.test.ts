import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ default: { leadConnector: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import {
  resolveConnectorByIgBusinessId,
  resolveConnectorByPageId,
  getSocialPageToken,
} from "./social-accounts";

beforeEach(() => findFirst.mockReset());

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

describe("getSocialPageToken", () => {
  it("devuelve el token descifrado y null si falta", () => {
    const conn = { id: "c1" } as never;
    expect(getSocialPageToken(conn, () => ({ pageAccessToken: "T" }))).toBe("T");
    expect(getSocialPageToken(conn, () => ({}))).toBeNull();
    expect(getSocialPageToken(conn, () => null)).toBeNull();
  });
});
