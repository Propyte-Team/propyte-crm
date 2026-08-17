import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const ruleFindMany = vi.fn();
const ruleCreate = vi.fn();
const connectorFindFirst = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commentRule: {
      findMany: (...a: unknown[]) => ruleFindMany(...a),
      create: (...a: unknown[]) => ruleCreate(...a),
    },
    leadConnector: { findFirst: (...a: unknown[]) => connectorFindFirst(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET, POST } from "./route";

function req(body: unknown) {
  return new Request("http://t/api/admin/comment-rules", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const VALID = {
  name: "Info Tulum",
  connectorId: "conn-ig",
  phrases: ["INFO", "Información"],
  publicReplies: ["Te escribo al DM 📩"],
  dmTemplate: "Hola {{usuario}}, te paso la info.",
};

beforeEach(() => {
  for (const m of [ruleFindMany, ruleCreate, connectorFindFirst, auditCreate]) m.mockReset();
  session.user.role = "ADMIN";
  connectorFindFirst.mockResolvedValue({ id: "conn-ig", provider: "INSTAGRAM", name: "IG Propyte" });
  ruleFindMany.mockResolvedValue([]);
  ruleCreate.mockResolvedValue({ id: "rule-1", name: "Info Tulum" });
  auditCreate.mockResolvedValue({});
});

describe("POST /api/admin/comment-rules", () => {
  it("crea la regla en pausa y con las frases normalizadas", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(ruleCreate.mock.calls[0][0].data).toMatchObject({
      name: "Info Tulum",
      connectorId: "conn-ig",
      phrases: ["info", "informacion"],
      isActive: false,
      priority: 100,
      postFilter: [],
    });
  });

  it("403 para rol sin permiso", async () => {
    session.user.role = "ASESOR";
    expect((await POST(req(VALID))).status).toBe(403);
  });

  it("400 si faltan frases o respuestas", async () => {
    expect((await POST(req({ ...VALID, phrases: [] }))).status).toBe(400);
    expect((await POST(req({ ...VALID, publicReplies: [] }))).status).toBe(400);
  });

  it("400 si el conector no es de Instagram ni Messenger", async () => {
    connectorFindFirst.mockResolvedValue({ id: "c", provider: "TIKTOK" });
    const res = await POST(req(VALID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Instagram o Messenger/);
  });

  it("404 si el conector no existe", async () => {
    connectorFindFirst.mockResolvedValue(null);
    expect((await POST(req(VALID))).status).toBe(404);
  });

  it("409 si otra regla activa de la misma cuenta ya usa la frase", async () => {
    ruleFindMany.mockResolvedValue([
      { id: "otra", name: "Genérica", isActive: true, phrases: ["info"] },
    ]);
    const res = await POST(req(VALID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Genérica");
  });

  it("permite la misma frase si la otra regla está en pausa", async () => {
    ruleFindMany.mockResolvedValue([
      { id: "otra", name: "Pausada", isActive: false, phrases: ["info"] },
    ]);
    expect((await POST(req(VALID))).status).toBe(201);
  });

  it("409 con mensaje claro si el nombre choca con una regla eliminada (P2002)", async () => {
    ruleCreate.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`connectorId`,`name`)"), {
        code: "P2002",
      })
    );
    const res = await POST(req(VALID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/eliminada/);
  });
});

describe("GET /api/admin/comment-rules", () => {
  it("devuelve arreglo vacío si las tablas aún no existen (pre-migración)", async () => {
    ruleFindMany.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it("propaga cualquier otro error de Prisma", async () => {
    ruleFindMany.mockRejectedValue(Object.assign(new Error("boom"), { code: "P1001" }));
    expect((await GET()).status).toBe(500);
  });
});

// Quién puede entrar lo decide canManageCommentRules (@/lib/comments/roles), y la
// matriz completa de roles se prueba en su propio test. Lo que se fija aquí es que
// ESTA ruta lo consulte de verdad: si alguien vuelve a poner una lista literal,
// estos dos casos lo cachan.
describe("acceso por rol", () => {
  it("MARKETING lista y crea — el acceso de la diseñadora sin volverla ADMIN", async () => {
    session.user.role = "MARKETING";
    expect((await GET()).status).toBe(200);
    expect((await POST(req(VALID))).status).toBe(201);
  });

  it("un rol de venta sigue fuera en ambos verbos", async () => {
    session.user.role = "ASESOR_JR";
    expect((await GET()).status).toBe(403);
    expect((await POST(req(VALID))).status).toBe(403);
    expect(ruleCreate).not.toHaveBeenCalled();
  });
});
