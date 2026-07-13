import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ default: { leadConnector: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

const getSocialPageToken = vi.fn();
vi.mock("./social-accounts", () => ({ getSocialPageToken: (...a: unknown[]) => getSocialPageToken(...a) }));

import { fetchSocialProfile, fetchProfileForMessage } from "./profile";

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  findUnique.mockReset();
  getSocialPageToken.mockReset();
  vi.unstubAllGlobals();
});

describe("fetchSocialProfile — MESSENGER", () => {
  it("pide first_name,last_name,profile_pic al PSID y arma el perfil", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({ first_name: "Ana", last_name: "García", profile_pic: "https://cdn/pic.jpg" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const p = await fetchSocialProfile("MESSENGER", "PSID-1", "TOKEN");
    expect(p).toEqual({ firstName: "Ana", lastName: "García", avatarUrl: "https://cdn/pic.jpg" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/PSID-1?fields=first_name,last_name,profile_pic");
    expect(url).toContain("access_token=TOKEN");
  });

  it("sin first_name → null (no inventa nombres)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ profile_pic: "x" })));
    expect(await fetchSocialProfile("MESSENGER", "PSID-1", "T")).toBeNull();
  });
});

describe("fetchSocialProfile — INSTAGRAM", () => {
  it("pide name,username,profile_pic y parte el nombre en primer token / resto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({ name: "Ana María García", username: "ana.g", profile_pic: "https://cdn/ig.jpg" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const p = await fetchSocialProfile("INSTAGRAM", "IGSID-1", "T");
    expect(p).toEqual({ firstName: "Ana", lastName: "María García", avatarUrl: "https://cdn/ig.jpg" });
    expect(fetchMock.mock.calls[0][0]).toContain("?fields=name,username,profile_pic");
  });

  it("nombre de una sola palabra → apellido (@username)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ name: "Ana", username: "ana.g" })));
    const p = await fetchSocialProfile("INSTAGRAM", "IGSID-1", "T");
    expect(p).toEqual({ firstName: "Ana", lastName: "(@ana.g)", avatarUrl: null });
  });

  it("solo username → @username como nombre", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ username: "ana.g" })));
    const p = await fetchSocialProfile("INSTAGRAM", "IGSID-1", "T");
    expect(p).toEqual({ firstName: "@ana.g", lastName: null, avatarUrl: null });
  });
});

describe("fetchSocialProfile — defensivo (nunca lanza)", () => {
  it("HTTP !ok → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await fetchSocialProfile("MESSENGER", "P", "T")).toBeNull();
  });

  it("error de Graph en body → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ error: { code: 100, message: "perm" } })));
    expect(await fetchSocialProfile("MESSENGER", "P", "T")).toBeNull();
  });

  it("fetch lanza (timeout/abort) → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("aborted")));
    expect(await fetchSocialProfile("INSTAGRAM", "I", "T")).toBeNull();
  });

  it("JSON inválido → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error("bad json"); } }));
    expect(await fetchSocialProfile("MESSENGER", "P", "T")).toBeNull();
  });
});

describe("fetchProfileForMessage", () => {
  it("WHATSAPP → null sin tocar BD ni red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchProfileForMessage({ channel: "WHATSAPP", senderId: "+5299", connectorId: "c1" });
    expect(r).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin connectorId → null", async () => {
    expect(await fetchProfileForMessage({ channel: "MESSENGER", senderId: "P", connectorId: null })).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("conector inexistente o sin token → null", async () => {
    findUnique.mockResolvedValue(null);
    expect(await fetchProfileForMessage({ channel: "MESSENGER", senderId: "P", connectorId: "c1" })).toBeNull();

    findUnique.mockResolvedValue({ id: "c1" });
    getSocialPageToken.mockReturnValue(null);
    expect(await fetchProfileForMessage({ channel: "MESSENGER", senderId: "P", connectorId: "c1" })).toBeNull();
  });

  it("happy path: resuelve conector, descifra token y trae el perfil", async () => {
    findUnique.mockResolvedValue({ id: "c1" });
    getSocialPageToken.mockReturnValue("PAGE-TOKEN");
    const fetchMock = vi.fn().mockResolvedValue(okJson({ first_name: "Luis", last_name: "P" }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchProfileForMessage({ channel: "MESSENGER", senderId: "PSID-9", connectorId: "c1" });
    expect(r).toEqual({ firstName: "Luis", lastName: "P", avatarUrl: null });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(fetchMock.mock.calls[0][0]).toContain("access_token=PAGE-TOKEN");
  });

  it("prisma lanza → null (nunca rompe el intake)", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    expect(await fetchProfileForMessage({ channel: "INSTAGRAM", senderId: "I", connectorId: "c1" })).toBeNull();
  });
});
