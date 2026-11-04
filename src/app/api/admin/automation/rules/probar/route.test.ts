// POST /api/admin/automation/rules/probar: permisos y que sea de solo lectura.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "ADMIN" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(hasSession ? session : null) }));

const dealFind = vi.fn();
const escritura = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    deal: { findFirst: (...a: unknown[]) => dealFind(...a), create: (...a: unknown[]) => escritura(...a), update: (...a: unknown[]) => escritura(...a) },
    contact: { update: (...a: unknown[]) => escritura(...a), create: (...a: unknown[]) => escritura(...a) },
  },
}));

const cargar = vi.fn();
vi.mock("@/lib/workflows/engine", () => ({
  loadEntityContext: (...a: unknown[]) => cargar(...a),
  isBusinessHoursNow: () => Promise.resolve(true),
}));

import { POST } from "./route";

const rule = {
  triggerType: "EVENT",
  triggerConfig: { eventType: "lead.captured" },
  conditions: { field: "contact.score", op: "gte", value: 50 },
  actions: [{ type: "update_score", config: { delta: 5 } }],
};
const req = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  [dealFind, escritura, cargar].forEach((m) => m.mockReset());
  hasSession = true;
  session.user = { id: "u1", role: "ADMIN" };
  dealFind.mockResolvedValue(null);
  cargar.mockResolvedValue({ contact: { id: "c1", firstName: "Ana", lastName: "Paz", score: 80 } });
});

describe("POST /api/admin/automation/rules/probar", () => {
  it("sin rol de mando → 403 y no lee nada", async () => {
    session.user = { id: "u1", role: "ASESOR" };
    expect((await POST(req({ contactId: "c1", rule }))).status).toBe(403);
    expect(cargar).not.toHaveBeenCalled();
  });

  it("cuerpo inválido → 400", async () => {
    expect((await POST(req({ rule }))).status).toBe(400);
  });

  it("contacto inexistente → 404", async () => {
    cargar.mockResolvedValue({ contact: null });
    expect((await POST(req({ contactId: "zz", rule }))).status).toBe(404);
  });

  it("evalúa la regla sin guardar y sin escribir en la base", async () => {
    const res = await POST(req({ contactId: "c1", rule }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.contacto).toEqual({ id: "c1", nombre: "Ana Paz" });
    expect(data.correria).toBe(true);
    expect(data.condiciones[0]).toMatchObject({ cumple: true, actual: "80" });
    expect(escritura).not.toHaveBeenCalled();
  });
});
