import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKey = vi.fn();
vi.mock("@/lib/auth/api-key", () => ({
  authenticateApiKey: (...a: unknown[]) => authenticateApiKey(...a),
}));

const dealCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { deal: { create: (...a: unknown[]) => dealCreate(...a) } },
}));

import { POST } from "./route";

// Auditoría 2026-09-10: los ids pasaron de "c1"/"u1" a uuids reales porque el POST ahora
// valida la forma. No es un ajuste cosmético del test: `Deal.contactId` referencia a
// `Contact.id`, que es `@default(uuid())`, y el PUT hermano de contactos ya exigía
// `z.string().uuid()`. Un "c1" nunca podría existir en la base — antes se enteraba Prisma
// y devolvía un 500 opaco; ahora se enteran aquí y es un 400 que dice qué campo.
const CONTACT_ID = "3f1c4a8e-6b2d-4c1a-9f7e-5d0b8a2c1e34";
const USER_ID = "7a2e9c1b-4d3f-4a8e-b6c5-1f0d9e8a7b62";

const DEAL_BASE = {
  contactId: CONTACT_ID,
  assignedToId: USER_ID,
  dealType: "NATIVA_CONTADO",
  estimatedValue: 1000000,
};

function req(body: unknown) {
  return new Request("http://localhost/api/webhooks/zapier/deals", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer pk_live_test",
    },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  authenticateApiKey.mockReset();
  authenticateApiKey.mockResolvedValue({ id: "key-1" });
  dealCreate.mockReset();
  dealCreate.mockResolvedValue({ id: "deal-1" });
});

describe("POST /api/webhooks/zapier/deals — expectedCloseDate", () => {
  it("responde 400 con un expectedCloseDate ilegible, con mensaje que incluye el valor recibido", async () => {
    // Antes del fix: `new Date(body.expectedCloseDate)` crudo. Un valor roto
    // producía un Invalid Date que Prisma rechazaba con un 500 opaco. Ahora
    // se valida antes y se responde 400 con un mensaje útil para depurar
    // desde el historial de un Zap.
    const res = await POST(
      req({ ...DEAL_BASE, expectedCloseDate: "no-es-fecha" }),
    );

    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.error).toContain("no-es-fecha");
  });

  it("responde 400 con una fecha de calendario imposible", async () => {
    const res = await POST(req({ ...DEAL_BASE, expectedCloseDate: "2026-02-30" }));

    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it("ancla una fecha sin hora a medianoche de Cancún antes de guardar", async () => {
    await POST(req({ ...DEAL_BASE, expectedCloseDate: "2026-07-30" }));

    const arg = dealCreate.mock.calls[0][0];
    expect(arg.data.expectedCloseDate.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  it("respeta un datetime con Z tal cual viene", async () => {
    await POST(req({ ...DEAL_BASE, expectedCloseDate: "2026-07-30T16:00:00.000Z" }));

    expect(dealCreate.mock.calls[0][0].data.expectedCloseDate.toISOString()).toBe(
      "2026-07-30T16:00:00.000Z",
    );
  });

  it("permite omitir expectedCloseDate y usa el default de 90 días", async () => {
    const res = await POST(req({ ...DEAL_BASE }));

    expect(res.status).toBe(201);
    expect(dealCreate).toHaveBeenCalledOnce();
    const arg = dealCreate.mock.calls[0][0];
    expect(arg.data.expectedCloseDate).toBeInstanceOf(Date);
  });
});

// Auditoría 2026-09-10: el POST comprobaba la PRESENCIA de cuatro campos y nada más; el
// resto entraba crudo en `prisma.deal.create`.
describe("POST /api/webhooks/zapier/deals — validación del cuerpo", () => {
  it("🚨 una probabilidad de 0 se guarda como 0, no como 5", async () => {
    // `body.probability || 5` convertía el 0 en 5, porque 0 es falsy. Un negocio al que
    // el asesor no le da ninguna probabilidad aparecía en el pipeline con un 5% que
    // nadie declaró.
    await POST(req({ ...DEAL_BASE, probability: 0 }));

    expect(dealCreate.mock.calls[0][0].data.probability).toBe(0);
  });

  it("sin probabilidad explícita sigue usando el default de 5", async () => {
    await POST(req({ ...DEAL_BASE }));

    expect(dealCreate.mock.calls[0][0].data.probability).toBe(5);
  });

  for (const [caso, cuerpo] of [
    ["contactId que no es uuid", { ...DEAL_BASE, contactId: "c1" }],
    ["dealType fuera del enum", { ...DEAL_BASE, dealType: "INVENTADO" }],
    ["stage fuera del enum", { ...DEAL_BASE, stage: "CASI_CERRADO" }],
    ["currency fuera del enum", { ...DEAL_BASE, currency: "EUR" }],
    ["estimatedValue como cadena", { ...DEAL_BASE, estimatedValue: "1000000" }],
    ["estimatedValue negativo", { ...DEAL_BASE, estimatedValue: -5 }],
    ["probability fuera de 0-100", { ...DEAL_BASE, probability: 500 }],
    ["falta contactId", { ...DEAL_BASE, contactId: undefined }],
  ] as const) {
    it(`responde 400 y no crea nada: ${caso}`, async () => {
      const res = await POST(req(cuerpo));

      expect(res.status).toBe(400);
      expect(dealCreate).not.toHaveBeenCalled();
    });
  }

  it("un campo mal escrito es 400, no un negocio creado a medias", async () => {
    // Sin `.strict()`, `estimated_value` se ignoraba en silencio y el negocio se creaba
    // sin valor... salvo que Prisma lo exige, así que salía 500. Con un campo opcional
    // mal escrito (`dealtype`) el negocio se habría creado con el default.
    const res = await POST(req({ ...DEAL_BASE, probabilidad: 50 }));

    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON da 400, no 500", async () => {
    const roto = new Request("http://localhost/api/webhooks/zapier/deals", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer pk_live_test" },
      body: "{no-json",
    }) as never;

    const res = await POST(roto);
    expect(res.status).toBe(400);
    expect(dealCreate).not.toHaveBeenCalled();
  });
});
