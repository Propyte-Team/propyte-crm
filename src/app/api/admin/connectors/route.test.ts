// POST /api/admin/connectors — WhatsApp (2026-10-09): el accessToken es obligatorio porque
// con él se responde y se descargan fotos y audios de ese número. Sin token el conector
// quedaría guardado pero mudo, así que se rechaza antes de tocar la base.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const connectorCreate = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { create: (...a: unknown[]) => connectorCreate(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

// Cifrar necesita la llave de PII del entorno; aquí solo importa si se intenta guardar.
vi.mock("@/lib/intake/connectors", () => ({ writeCredentials: () => "cifrado" }));

import { POST } from "./route";

function req(body: unknown) {
  return { json: () => Promise.resolve(body) } as never;
}

const WA_OK = {
  name: "WhatsApp | Nativa",
  provider: "WHATSAPP",
  config: { phoneNumberId: "123" },
  credentials: { accessToken: "tok-test" },
};

beforeEach(() => {
  for (const m of [connectorCreate, auditCreate]) m.mockReset();
  session.user.role = "ADMIN";
  connectorCreate.mockResolvedValue({ id: "c1", name: WA_OK.name, provider: "WHATSAPP", status: "PAUSED" });
  auditCreate.mockResolvedValue({});
});

describe("POST /api/admin/connectors · WHATSAPP", () => {
  it("sin accessToken → 400 y no guarda nada", async () => {
    const res = await POST(req({ ...WA_OK, credentials: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("accessToken requerido para WhatsApp");
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("con credentials pero sin accessToken → 400", async () => {
    const res = await POST(req({ ...WA_OK, credentials: { otro: "x" } }));
    expect(res.status).toBe(400);
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("sin phoneNumberId sigue respondiendo 400 por el ID", async () => {
    const res = await POST(req({ ...WA_OK, config: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("phoneNumberId");
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("con phoneNumberId y accessToken → 201 y queda en PAUSED", async () => {
    const res = await POST(req(WA_OK));
    expect(res.status).toBe(201);
    expect(connectorCreate).toHaveBeenCalledTimes(1);
    expect(connectorCreate.mock.calls[0][0].data.status).toBe("PAUSED");
  });
});
