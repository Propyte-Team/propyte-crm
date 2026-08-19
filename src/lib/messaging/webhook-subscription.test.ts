import { describe, it, expect, vi } from "vitest";
import { probePageSubscription, missingCommentFields, COMMENT_FIELDS } from "./webhook-subscription";

function fetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe("probePageSubscription", () => {
  it("devuelve los campos suscritos de nuestra app", async () => {
    const f = fetchOk({ data: [{ subscribed_fields: ["messages", "feed", "messaging_postbacks"] }] });
    const out = await probePageSubscription("PAGE-1", "TOKEN", f);
    expect(out.subscribedFields).toEqual(["messages", "feed", "messaging_postbacks"]);
    expect(out.error).toBeNull();
  });

  it("el token va en la cabecera, nunca en la URL", async () => {
    const f = fetchOk({ data: [] });
    await probePageSubscription("PAGE-1", "SECRETO", f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).not.toContain("SECRETO");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SECRETO");
  });

  it("página sin ninguna app suscrita devuelve lista vacía, no error", async () => {
    const out = await probePageSubscription("PAGE-1", "TOKEN", fetchOk({ data: [] }));
    expect(out.subscribedFields).toEqual([]);
    expect(out.error).toBeNull();
  });

  it("un error de Graph se reporta como texto, sin lanzar", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: false,
      status: 190,
      json: () => Promise.resolve({ error: { code: 190, message: "Token caducado" } }),
    }) as unknown as typeof fetch;
    const out = await probePageSubscription("PAGE-1", "TOKEN", f);
    expect(out.subscribedFields).toEqual([]);
    expect(out.error).toContain("Token caducado");
  });

  it("una red caída tampoco lanza", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ETIMEDOUT")) as unknown as typeof fetch;
    const out = await probePageSubscription("PAGE-1", "TOKEN", f);
    expect(out.error).toContain("ETIMEDOUT");
  });
});

describe("missingCommentFields", () => {
  it("con feed suscrito no falta nada", () => {
    expect(missingCommentFields(["messages", "feed"])).toEqual([]);
  });

  it("sin feed, los comentarios de Facebook nunca llegan", () => {
    expect(missingCommentFields(["messages"])).toEqual(["feed"]);
  });

  it("lista vacía reporta todos los requeridos", () => {
    expect(missingCommentFields([])).toEqual([...COMMENT_FIELDS]);
  });
});
