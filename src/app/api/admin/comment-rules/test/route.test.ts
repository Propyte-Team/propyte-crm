import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const ruleFindMany = vi.fn();
const logCount = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commentRule: { findMany: (...a: unknown[]) => ruleFindMany(...a) },
    commentRuleLog: { count: (...a: unknown[]) => logCount(...a) },
  },
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }) as never;
}

const RULE = {
  id: "rule-1",
  name: "Info Tulum",
  isActive: true,
  priority: 100,
  phrases: ["info"],
  postFilter: [],
  publicReplies: ["Te escribo al DM 📩", "Ya te mandé privado 📩"],
  dmTemplate: "Hola {{usuario}}, aquí va la info.",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  ruleFindMany.mockReset();
  logCount.mockReset();
  logCount.mockResolvedValue(0);
  // El permiso ya no vive aquí: lo decide canManageCommentRules (@/lib/comments/roles).
  // Historia: MARKETING se sacó en su día "pareado con el guard de /admin/page.tsx";
  // ago-2026 volvió a entrar junto con la puerta propia /admin/comentarios, que sí
  // lo admite. El caso feliz se prueba con ADMIN; el acceso por rol se prueba abajo.
  session.user.role = "ADMIN";
});

describe("POST /api/admin/comment-rules/test", () => {
  it("devuelve la regla, la frase y los textos ya renderizados", async () => {
    ruleFindMany.mockResolvedValue([RULE]);
    const res = await POST(req({ connectorId: "conn-ig", commentText: "mándame INFO", usuario: "luisf" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      match: {
        ruleId: "rule-1",
        ruleName: "Info Tulum",
        phrase: "info",
        publicText: "Te escribo al DM 📩",
        dmText: "Hola luisf, aquí va la info.",
      },
      pausedMatch: null,
    });
  });

  it("muestra la variante que toca según los disparos previos", async () => {
    ruleFindMany.mockResolvedValue([RULE]);
    logCount.mockResolvedValue(1);
    const res = await POST(req({ connectorId: "conn-ig", commentText: "info" }));
    expect((await res.json()).match.publicText).toBe("Ya te mandé privado 📩");
  });

  it("sin match activo, avisa si una regla EN PAUSA habría disparado", async () => {
    ruleFindMany.mockResolvedValue([{ ...RULE, isActive: false }]);
    const res = await POST(req({ connectorId: "conn-ig", commentText: "info" }));
    expect(await res.json()).toEqual({
      match: null,
      pausedMatch: { ruleId: "rule-1", ruleName: "Info Tulum", phrase: "info" },
    });
  });

  it("sin ninguna coincidencia devuelve match y pausedMatch en null", async () => {
    ruleFindMany.mockResolvedValue([RULE]);
    const res = await POST(req({ connectorId: "conn-ig", commentText: "qué bonito" }));
    expect(await res.json()).toEqual({ match: null, pausedMatch: null });
  });

  it("400 sin texto de comentario", async () => {
    expect((await POST(req({ connectorId: "conn-ig", commentText: "" }))).status).toBe(400);
  });

  it("403 para rol sin permiso", async () => {
    session.user.role = "ASESOR";
    expect((await POST(req({ connectorId: "c", commentText: "info" }))).status).toBe(403);
  });

  it("MARKETING puede usar el probador", async () => {
    session.user.role = "MARKETING";
    ruleFindMany.mockResolvedValue([RULE]);
    expect((await POST(req({ connectorId: "conn-ig", commentText: "info" }))).status).toBe(200);
  });
});
