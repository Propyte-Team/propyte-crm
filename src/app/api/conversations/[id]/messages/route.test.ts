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
  expect(sendChannelMessage).toHaveBeenCalledWith("INSTAGRAM", "c1", "hola", "u1", { connectorId: "conn_ig", media: null });
});

it("acepta media sin texto y lo pasa a sendChannelMessage", async () => {
  findUnique.mockResolvedValue({ id: "conv1", channel: "MESSENGER", status: "HUMAN", connectorId: "conn_ms", contact: { id: "c1", phone: null, doNotContact: false } });
  const media = { path: "2026-07/a.jpg", type: "image", filename: "a.jpg", mimeType: "image/jpeg" };
  const r = new Request("https://x", { method: "POST", body: JSON.stringify({ media }) }) as never;
  const res = await POST(r, { params: { id: "conv1" } });
  expect(res.status).toBe(201);
  expect(sendChannelMessage).toHaveBeenCalledWith("MESSENGER", "c1", "", "u1", { connectorId: "conn_ms", media });
});

it("rechaza mensaje sin texto NI media, nota interna con media, y media.path con URL", async () => {
  findUnique.mockResolvedValue({ id: "conv1", channel: "MESSENGER", status: "HUMAN", connectorId: "c", contact: { id: "c1", phone: null, doNotContact: false } });
  const cases = [
    {},
    { body: "nota", internalNote: true, media: { path: "a.jpg", type: "image" } },
    { media: { path: "https://evil.com/x.jpg", type: "image" } },
  ];
  for (const body of cases) {
    const r = new Request("https://x", { method: "POST", body: JSON.stringify(body) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(400);
  }
  expect(sendChannelMessage).not.toHaveBeenCalled();
});
