import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { webhookConfig: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { dispatchWebhook } from "./dispatcher";

beforeEach(() => vi.clearAllMocks());

describe("dispatchWebhook", () => {
  it("firma con el secret leído de BD (no de la UI)", async () => {
    findMany.mockResolvedValue([{ url: "https://x.test/h", secret: "s3cr3t-bd" }]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await dispatchWebhook("deal.won", { id: 1 });
    const init = fetchMock.mock.calls[0][1] as { body: string; headers: Record<string, string> };
    const esperado = createHmac("sha256", "s3cr3t-bd").update(init.body).digest("hex");
    expect(init.headers["X-Webhook-Signature"]).toBe(esperado);
    vi.unstubAllGlobals();
  });
});
