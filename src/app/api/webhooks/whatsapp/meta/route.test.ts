import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// Auditoría 2026-09-10: este webhook aceptaba CUALQUIER cuerpo sin firma cuando
// META_WA_APP_SECRET no estaba configurada (`if (!appSecret) return true`). La #754 cerró
// el mismo agujero en meta-dm y dejó su prueba; el de WhatsApp —el de mayor volumen— se
// quedó sin cambio y sin prueba. Esto es la otra mitad, con la batería equivalente.

const handleInboundWhatsApp = vi.fn();
const resolveConnectorByPhoneNumberId = vi.fn();
const resolveWaMediaToStorage = vi.fn();
const botRespond = vi.fn();
const messageUpdateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: { message: { updateMany: (...a: unknown[]) => messageUpdateMany(...a) } },
}));
vi.mock("@/lib/twilio/whatsapp", () => ({
  handleInboundWhatsApp: (...a: unknown[]) => handleInboundWhatsApp(...a),
}));
vi.mock("@/lib/whatsapp/accounts", () => ({
  resolveConnectorByPhoneNumberId: (...a: unknown[]) => resolveConnectorByPhoneNumberId(...a),
}));
vi.mock("@/lib/whatsapp/media", () => ({
  resolveWaMediaToStorage: (...a: unknown[]) => resolveWaMediaToStorage(...a),
}));
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));

import { GET, POST } from "./route";

const APP_SECRET = "test-wa-app-secret";
const URL_WEBHOOK = "https://x/api/webhooks/whatsapp/meta";

beforeEach(() => {
  handleInboundWhatsApp.mockReset();
  handleInboundWhatsApp.mockResolvedValue({ contactId: "c1" });
  resolveConnectorByPhoneNumberId.mockReset();
  resolveConnectorByPhoneNumberId.mockResolvedValue(null);
  resolveWaMediaToStorage.mockReset();
  botRespond.mockReset();
  messageUpdateMany.mockReset();
  messageUpdateMany.mockResolvedValue({ count: 0 });
  process.env.META_WA_VERIFY_TOKEN = "verifyme";
  process.env.META_WA_APP_SECRET = APP_SECRET;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// El GET de este route lee `req.nextUrl` (el de meta-dm usa `new URL(req.url)`), y un
// `Request` plano no lo trae: se añade a mano, que es lo que Next hace en producción.
function req(url: string, init?: RequestInit) {
  const r = new Request(url, init);
  Object.defineProperty(r, "nextUrl", { value: new URL(url), configurable: true });
  return r as unknown as import("next/server").NextRequest;
}

/** La firma HMAC-SHA256 que Meta manda en x-hub-signature-256. */
function firma(body: string) {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
}

function postFirmado(body: string) {
  return req(URL_WEBHOOK, { method: "POST", body, headers: { "x-hub-signature-256": firma(body) } });
}

/** Un batch mínimo con un mensaje de texto entrante. */
const CUERPO_OK = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "pn-1" },
            contacts: [{ profile: { name: "Ana" }, wa_id: "5219981234567" }],
            messages: [{ id: "wamid.1", from: "5219981234567", type: "text", text: { body: "hola" } }],
          },
        },
      ],
    },
  ],
});

describe("webhook de WhatsApp Cloud — verificación de suscripción", () => {
  it("GET responde el challenge con el verify token correcto", async () => {
    const res = await GET(
      req(`${URL_WEBHOOK}?hub.mode=subscribe&hub.verify_token=verifyme&hub.challenge=42`),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("GET rechaza un verify token incorrecto", async () => {
    const res = await GET(
      req(`${URL_WEBHOOK}?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=42`),
    );
    expect(res.status).toBe(403);
  });
});

describe("webhook de WhatsApp Cloud — la firma falla CERRADO", () => {
  it("🚨 rechaza con 401 si META_WA_APP_SECRET no está configurada", async () => {
    delete process.env.META_WA_APP_SECRET;
    const res = await POST(postFirmado(CUERPO_OK));
    expect(res.status).toBe(401);
    // Y sobre todo: no ingirió nada.
    expect(handleInboundWhatsApp).not.toHaveBeenCalled();
  });

  it("🚨 rechaza con 401 si la variable está pero vacía", async () => {
    process.env.META_WA_APP_SECRET = "   ";
    const res = await POST(postFirmado(CUERPO_OK));
    expect(res.status).toBe(401);
    expect(handleInboundWhatsApp).not.toHaveBeenCalled();
  });

  it("rechaza con 401 una firma que no corresponde al cuerpo", async () => {
    const res = await POST(
      req(URL_WEBHOOK, {
        method: "POST",
        body: CUERPO_OK,
        headers: { "x-hub-signature-256": firma("otro cuerpo") },
      }),
    );
    expect(res.status).toBe(401);
    expect(handleInboundWhatsApp).not.toHaveBeenCalled();
  });

  it("rechaza con 401 si falta el header de firma", async () => {
    const res = await POST(req(URL_WEBHOOK, { method: "POST", body: CUERPO_OK }));
    expect(res.status).toBe(401);
  });

  it("rechaza con 401 un header cuyo prefijo no es sha256=", async () => {
    const res = await POST(
      req(URL_WEBHOOK, {
        method: "POST",
        body: CUERPO_OK,
        headers: { "x-hub-signature-256": "sha1=deadbeef" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("con firma válida SÍ ingiere el mensaje", async () => {
    const res = await POST(postFirmado(CUERPO_OK));
    expect(res.status).toBe(200);
    expect(handleInboundWhatsApp).toHaveBeenCalledTimes(1);
    const [payload] = handleInboundWhatsApp.mock.calls[0] as [Record<string, unknown>];
    expect(payload.MessageSid).toBe("wamid.1");
    expect(payload.Body).toBe("hola");
  });
});

describe("webhook de WhatsApp Cloud — cuerpos que no son un objeto (gemelo de la #755)", () => {
  it("un cuerpo que no es JSON da 400, no 500", async () => {
    const res = await POST(postFirmado("{no-json"));
    expect(res.status).toBe(400);
  });

  // `JSON.parse("null")` no lanza: devuelve null y el catch no alcanza. Antes esto
  // reventaba en `body.entry` con un 500 no manejado.
  for (const cuerpo of ["null", "42", '"texto"']) {
    it(`el cuerpo \`${cuerpo}\` da 400 y no revienta`, async () => {
      const res = await POST(postFirmado(cuerpo));
      expect(res.status).toBe(400);
      expect(handleInboundWhatsApp).not.toHaveBeenCalled();
    });
  }
});
