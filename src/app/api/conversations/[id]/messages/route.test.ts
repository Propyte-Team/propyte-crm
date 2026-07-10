import { describe, it, expect, vi, beforeEach } from "vitest";

const sendChannelMessage = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => ({ user: { id: "u1", role: "ASESOR" } }) }));
vi.mock("@/lib/messaging/dispatcher", () => ({ sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a) }));
vi.mock("@/lib/db", () => ({ default: {
  conversation: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) },
  message: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
} }));

import { POST } from "./route";

beforeEach(() => { sendChannelMessage.mockReset().mockResolvedValue({ id: "m1" }); findUnique.mockReset(); update.mockReset(); });

it("pasa connectorId de la conversación a sendChannelMessage", async () => {
  findUnique.mockResolvedValue({ id: "conv1", channel: "INSTAGRAM", status: "HUMAN", connectorId: "conn_ig", contact: { id: "c1", phone: null, doNotContact: false } });
  const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
  await POST(r, { params: { id: "conv1" } });
  expect(sendChannelMessage).toHaveBeenCalledWith("INSTAGRAM", "c1", "hola", "u1", { connectorId: "conn_ig" });
});
