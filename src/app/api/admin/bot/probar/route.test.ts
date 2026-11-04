import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const brandFind = vi.fn();
const agentFind = vi.fn();
const playbookFind = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    brand: { findFirst: (...a: unknown[]) => brandFind(...a) },
    botAgentProfile: { findFirst: (...a: unknown[]) => agentFind(...a) },
    botPlaybook: { findFirst: (...a: unknown[]) => playbookFind(...a) },
  },
}));

const askClaude = vi.fn();
vi.mock("@/lib/bot/claude", async (orig) => ({
  ...(await orig<typeof import("@/lib/bot/claude")>()),
  askClaude: (...a: unknown[]) => askClaude(...a),
}));

let cfg: Record<string, unknown> = {};
vi.mock("@/lib/bot/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/bot/config")>()),
  getBotConfig: () => Promise.resolve({ ...cfg }),
}));

import { POST } from "./route";
import { DEFAULT_BOT_CONFIG } from "@/lib/bot/config";

function req(body: unknown) {
  return new Request("http://t/api/admin/bot/probar", { method: "POST", body: JSON.stringify(body) }) as never;
}

beforeEach(() => {
  for (const m of [brandFind, agentFind, playbookFind, askClaude]) m.mockReset();
  session.user.role = "ADMIN";
  cfg = { ...DEFAULT_BOT_CONFIG, activePlaybookId: null };
  askClaude.mockResolvedValue("Hola Ana, ¿qué zona te interesa?");
});

describe("POST /api/admin/bot/probar", () => {
  it("rechaza roles sin acceso", async () => {
    session.user.role = "ASESOR";
    expect((await POST(req({ message: "hola" }))).status).toBe(403);
  });

  it("valida el mensaje", async () => {
    expect((await POST(req({ message: "  " }))).status).toBe(400);
  });

  it("responde sin escribir nada y devuelve el origen general", async () => {
    const res = await POST(req({ message: "hola" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ respuesta: "Hola Ana, ¿qué zona te interesa?", escalaria: false, origen: "Configuración general" });
    expect(askClaude.mock.calls[0][0].messages).toEqual([{ role: "user", content: "hola" }]);
  });

  it("detecta el token de escalamiento y lo quita del texto", async () => {
    askClaude.mockResolvedValue("Te paso con un asesor. [ESCALAR]");
    const json = await (await POST(req({ message: "quiero apartar" }))).json();
    expect(json.escalaria).toBe(true);
    expect(json.respuesta).toBe("Te paso con un asesor.");
  });

  it("con marca usa su estilo y su guion, no el general", async () => {
    brandFind.mockResolvedValue({ name: "Nativa", persona: null, knowledge: null, slug: "nativa", isDefault: false, tonePreset: "EJECUTIVO_SOBRIO", playbookId: "pb1" });
    playbookFind.mockResolvedValue({ tasks: [{ key: "k", order: 0, objective: "saber el presupuesto", targetField: "budgetMax", required: true, skipIfFilled: true }] });
    const json = await (await POST(req({ message: "hola", brandId: "b1" }))).json();
    expect(json).toMatchObject({ origen: "Marca Nativa", tono: "EJECUTIVO_SOBRIO", usaGuion: true });
    expect(playbookFind.mock.calls[0][0].where.id).toBe("pb1");
    expect(askClaude.mock.calls[0][0].system).toContain("saber el presupuesto");
  });

  it("devuelve 503 con mensaje claro si no hay llave de IA", async () => {
    askClaude.mockImplementation(async (_o: unknown, diag: { sinRespuesta?: unknown }) => {
      diag.sinRespuesta = { motivo: "sin_api_key" };
      return null;
    });
    const res = await POST(req({ message: "hola" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("llave");
  });
});
