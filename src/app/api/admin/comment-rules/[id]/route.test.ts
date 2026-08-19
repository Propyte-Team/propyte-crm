import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const ruleFindFirst = vi.fn();
const ruleFindMany = vi.fn();
const ruleUpdate = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commentRule: {
      findFirst: (...a: unknown[]) => ruleFindFirst(...a),
      findMany: (...a: unknown[]) => ruleFindMany(...a),
      update: (...a: unknown[]) => ruleUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { PATCH, DELETE } from "./route";

function req(body: unknown) {
  return new Request("http://t/api/admin/comment-rules/rule-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as never;
}

function ctx(id = "rule-1") {
  return { params: { id } };
}

const CURRENT = { id: "rule-1", connectorId: "conn-ig", phrases: ["info"] };

beforeEach(() => {
  for (const m of [ruleFindFirst, ruleFindMany, ruleUpdate, auditCreate]) m.mockReset();
  session.user.role = "ADMIN";
  ruleFindFirst.mockResolvedValue(CURRENT);
  ruleFindMany.mockResolvedValue([]);
  ruleUpdate.mockResolvedValue({ id: "rule-1", name: "Info Tulum", isActive: true });
  auditCreate.mockResolvedValue({});
});

describe("PATCH /api/admin/comment-rules/[id]", () => {
  it("editar una regla activa sin cambiar sus frases no choca contra sí misma (excluye su propio id)", async () => {
    // Simula lo que devolvería la base real: la propia regla nunca aparece
    // entre sus "hermanas" porque el where ya la excluye por id.
    ruleFindMany.mockResolvedValue([]);
    const res = await PATCH(req({ isActive: true }), ctx());
    expect(res.status).toBe(200);
    expect(ruleFindMany.mock.calls[0][0].where).toMatchObject({
      connectorId: "conn-ig",
      isActive: true,
      id: { not: "rule-1" },
    });
  });

  it("409 si otra regla activa de la misma cuenta ya usa una de las frases, la nombra", async () => {
    ruleFindMany.mockResolvedValue([
      { name: "Genérica", phrases: ["info"], isActive: true },
    ]);
    const res = await PATCH(req({ phrases: ["Info"] }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Genérica");
  });

  it("403 para rol sin permiso", async () => {
    session.user.role = "ASESOR";
    expect((await PATCH(req({ name: "Nueva" }), ctx())).status).toBe(403);
  });

  it("404 si la regla no existe (o ya está borrada)", async () => {
    ruleFindFirst.mockResolvedValue(null);
    expect((await PATCH(req({ name: "Nueva" }), ctx())).status).toBe(404);
  });
});

describe("DELETE /api/admin/comment-rules/[id]", () => {
  it("403 para rol sin permiso", async () => {
    session.user.role = "ASESOR";
    expect((await DELETE(req(null), ctx())).status).toBe(403);
  });

  it("404 si la regla no existe", async () => {
    ruleFindFirst.mockResolvedValue(null);
    expect((await DELETE(req(null), ctx())).status).toBe(404);
  });
});

// Ver la nota en ../route.test.ts: la matriz de roles vive en
// @/lib/comments/roles.test.ts; aquí solo se fija que esta ruta la consulte.
describe("acceso por rol", () => {
  it("MARKETING puede editar y pausar una regla", async () => {
    session.user.role = "MARKETING";
    expect((await PATCH(req({ isActive: true }), ctx())).status).toBe(200);
  });

  it("un rol de venta recibe 403 y no llega a escribir", async () => {
    session.user.role = "ASESOR_JR";
    expect((await PATCH(req({ isActive: true }), ctx())).status).toBe(403);
    expect((await DELETE(req(null), ctx())).status).toBe(403);
    expect(ruleUpdate).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/comment-rules/[id] — negativas y tope", () => {
  it("guarda las negativas normalizadas y el tope nuevo", async () => {
    const res = await PATCH(req({ excludePhrases: ["ARQUITECTURA"], dailyCap: 25 }), ctx());
    expect(res.status).toBe(200);
    expect(ruleUpdate.mock.calls[0][0].data).toMatchObject({
      excludePhrases: ["arquitectura"],
      dailyCap: 25,
    });
  });

  it("400 si la negativa nueva es idéntica a una frase YA guardada", async () => {
    const res = await PATCH(req({ excludePhrases: ["info"] }), ctx());
    expect(res.status).toBe(400);
    expect(ruleUpdate).not.toHaveBeenCalled();
  });

  it("no toca las negativas si el PATCH no las manda", async () => {
    await PATCH(req({ priority: 5 }), ctx());
    expect(ruleUpdate.mock.calls[0][0].data).not.toHaveProperty("excludePhrases");
  });
});
