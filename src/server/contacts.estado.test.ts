// ?estado= de /contacts: la primera página se filtra por el estado nuevo (contacts.estado).
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a), count: (...a: unknown[]) => contactCount(...a) },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => ({ user: { id: "adm-1", role: "ADMIN", plaza: "PDC" } }) }));
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: async () => "ALL" }));

import { getContacts } from "./contacts";

beforeEach(() => {
  contactFindMany.mockReset().mockResolvedValue([]);
  contactCount.mockReset().mockResolvedValue(0);
});

const whereUsado = () => contactFindMany.mock.calls[0][0].where;

describe("getContacts — estado", () => {
  it("filtra por el estado nuevo y no por contactStatus", async () => {
    await getContacts({ estado: "CONTACTADO" });
    expect(whereUsado().AND).toEqual([{ estado: "CONTACTADO" }]);
    expect(JSON.stringify(whereUsado())).not.toContain("contactStatus");
    expect(contactCount.mock.calls[0][0].where).toBe(whereUsado());
  });
  it("«Por clasificar» busca estado nulo", async () => {
    await getContacts({ estado: "SIN_ESTADO" });
    expect(whereUsado().AND).toEqual([{ estado: null }]);
  });
  it("un valor que no existe no filtra", async () => {
    await getContacts({ estado: "PROSPECTO" });
    expect(whereUsado().AND).toBeUndefined();
    await getContacts({});
    expect(contactFindMany.mock.calls[1][0].where.AND).toBeUndefined();
  });
});
