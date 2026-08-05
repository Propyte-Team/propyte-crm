import { describe, it, expect, vi } from "vitest";
import { blockOnMeta } from "./meta-moderation";

function fetchOk(body: unknown = { success: true }) {
  return vi.fn().mockResolvedValue({ status: 200, json: async () => body } as unknown as Response);
}

function fetchErr(code: number, message = "boom") {
  return vi.fn().mockResolvedValue({
    status: 400,
    json: async () => ({ error: { code, message } }),
  } as unknown as Response);
}

describe("blockOnMeta — Instagram", () => {
  it("manda block_user y move_to_spam en dos llamadas a moderate_conversations", async () => {
    const f = fetchOk();
    const res = await blockOnMeta({
      channel: "INSTAGRAM",
      pageId: "PAGE-1",
      token: "TOKEN",
      identifier: "IGSID-1",
      fetchImpl: f,
    });

    expect(res).toEqual({ blockStatus: "SENT", spamStatus: "SENT" });
    expect(f).toHaveBeenCalledTimes(2);

    const [url1, init1] = f.mock.calls[0];
    expect(String(url1)).toBe("https://graph.facebook.com/v24.0/PAGE-1/moderate_conversations");
    expect(init1.method).toBe("POST");
    expect(JSON.parse(init1.body)).toEqual({
      user_ids: [{ id: "IGSID-1" }],
      actions: ["block_user"],
      access_token: "TOKEN",
    });

    expect(JSON.parse(f.mock.calls[1][1].body).actions).toEqual(["move_to_spam"]);
  });

  it("si el bloqueo falla no intenta el spam", async () => {
    const f = fetchErr(3801);
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1", fetchImpl: f,
    });

    expect(res.blockStatus).toBe("FAILED");
    expect(res.spamStatus).toBe("SKIPPED");
    expect(res.error).toContain("tope de personas bloqueadas");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("traduce el 3802 a un mensaje entendible", async () => {
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1", fetchImpl: fetchErr(3802),
    });
    expect(res.error).toContain("desbloqueaste");
  });

  it("explica el caso de que no exista conversación previa", async () => {
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1",
      fetchImpl: fetchErr(100, "No conversation exists between the user and the business"),
    });
    expect(res.blockStatus).toBe("FAILED");
    expect(res.error).toContain("conversación");
  });
});

describe("blockOnMeta — Messenger", () => {
  it("usa /blocked con psid y marca el spam como SKIPPED", async () => {
    const f = fetchOk();
    const res = await blockOnMeta({
      channel: "MESSENGER", pageId: "PAGE-1", token: "TOKEN", identifier: "PSID-1", fetchImpl: f,
    });

    expect(res).toEqual({ blockStatus: "SENT", spamStatus: "SKIPPED" });
    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.pathname).toBe("/v24.0/PAGE-1/blocked");
    expect(url.searchParams.get("psid")).toBe('["PSID-1"]');
    expect(url.searchParams.get("access_token")).toBe("TOKEN");
  });
});

describe("blockOnMeta — casos sin salida", () => {
  it("sin token devuelve SKIPPED sin llamar a nadie", async () => {
    const f = fetchOk();
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: null, identifier: "IGSID-1", fetchImpl: f,
    });
    expect(res).toEqual({ blockStatus: "SKIPPED", spamStatus: "SKIPPED", error: "conector sin pageAccessToken" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sin pageId devuelve SKIPPED", async () => {
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: null, token: "TOKEN", identifier: "IGSID-1", fetchImpl: fetchOk(),
    });
    expect(res.blockStatus).toBe("SKIPPED");
  });

  it("WhatsApp no tiene API de bloqueo: SKIPPED", async () => {
    const res = await blockOnMeta({
      channel: "WHATSAPP", pageId: "PAGE-1", token: "TOKEN", identifier: "+52199", fetchImpl: fetchOk(),
    });
    expect(res).toEqual({
      blockStatus: "SKIPPED",
      spamStatus: "SKIPPED",
      error: "WhatsApp no tiene API de bloqueo",
    });
  });

  it("nunca lanza: un fetch que revienta se convierte en FAILED", async () => {
    const f = vi.fn().mockRejectedValue(new Error("red caída"));
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1", fetchImpl: f,
    });
    expect(res.blockStatus).toBe("FAILED");
    expect(res.error).toContain("red caída");
  });
});
