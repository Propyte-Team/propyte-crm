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
const messageFindFirst = vi.fn();
const contactUpdateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    message: {
      updateMany: (...a: unknown[]) => messageUpdateMany(...a),
      findFirst: (...a: unknown[]) => messageFindFirst(...a),
    },
    contact: { updateMany: (...a: unknown[]) => contactUpdateMany(...a) },
  },
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
  messageFindFirst.mockReset();
  messageFindFirst.mockResolvedValue(null);
  contactUpdateMany.mockReset();
  contactUpdateMany.mockResolvedValue({ count: 1 });
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

// ---------------------------------------------------------------------------
// BSUID (business-scoped user id) — 2026-09-30
//
// Meta manda `contacts[].user_id` en TODOS los webhooks entrantes desde abril de
// 2026 y hasta hoy se tiraba. El teléfono (`wa_id`) es CONDICIONAL: solo viene si
// hubo interacción en los últimos 30 días o el usuario está en el contact book, y
// esa ventana se evalúa POR NÚMERO DE NEGOCIO. El BSUID, en cambio, siempre está.
//
// Este paso es deliberadamente ADITIVO: guarda el identificador y NO toca el
// emparejado de contactos, que sigue yendo por teléfono. Cambiar el matcher es el
// paso siguiente del diseño y el de mayor riesgo (duplicados); mezclarlo aquí es
// justo lo que el orden del diseño prohíbe.
// ---------------------------------------------------------------------------
describe("webhook de WhatsApp Cloud — BSUID", () => {
  /** Un batch con un mensaje cuyo contacto trae `user_id`. */
  function cuerpoConBsuid(contacts: unknown[], from = "5219981234567") {
    return JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn-1" },
                contacts,
                messages: [{ id: "wamid.1", from, type: "text", text: { body: "hola" } }],
              },
            },
          ],
        },
      ],
    });
  }

  it("persiste el user_id en el contacto que acaba de ingerir", async () => {
    const res = await POST(
      postFirmado(
        cuerpoConBsuid([
          { profile: { name: "Ana" }, wa_id: "5219981234567", user_id: "MX.13491208655302741918" },
        ]),
      ),
    );

    expect(res.status).toBe(200);
    expect(contactUpdateMany).toHaveBeenCalledTimes(1);
    const [args] = contactUpdateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(args.data).toEqual({ whatsappUserId: "MX.13491208655302741918" });
    expect(args.where.id).toBe("c1");
  });

  // El BSUID se manda COMPLETO —país + punto + alfanuméricos—; recortar el país o
  // el punto hace fallar la petición de envío contra Meta. Se guarda tal cual llega.
  it("guarda el BSUID íntegro, con su prefijo de país y su punto", async () => {
    await POST(
      postFirmado(
        cuerpoConBsuid([{ wa_id: "5219981234567", user_id: "US.13491208655302741918" }]),
      ),
    );
    const [args] = contactUpdateMany.mock.calls[0] as [{ data: { whatsappUserId: string } }];
    expect(args.data.whatsappUserId).toBe("US.13491208655302741918");
  });

  // No pisar un BSUID ya guardado: la condición viaja en el WHERE, no en un
  // read-then-write, para que dos mensajes del mismo batch no se pisen entre ellos.
  it("no pisa un BSUID ya guardado: la condición va en el WHERE", async () => {
    await POST(
      postFirmado(cuerpoConBsuid([{ wa_id: "5219981234567", user_id: "MX.111" }])),
    );
    const [args] = contactUpdateMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where.whatsappUserId).toBeNull();
  });

  // Escribir el BSUID EQUIVOCADO en un contacto es peor que no escribir ninguno:
  // queda un identificador único apuntando a otra persona. `contacts[]` trae una
  // entrada por remitente, así que se empareja por wa_id contra el `from` del
  // mensaje en vez de tomar `contacts[0]` a ciegas.
  it("con dos remitentes en el batch, a cada contacto le toca SU user_id", async () => {
    const cuerpo = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn-1" },
                contacts: [
                  { wa_id: "5219990000000", user_id: "MX.otro" },
                  { wa_id: "5219981234567", user_id: "MX.correcto" },
                ],
                messages: [
                  { id: "wamid.1", from: "5219981234567", type: "text", text: { body: "hola" } },
                ],
              },
            },
          ],
        },
      ],
    });

    await POST(postFirmado(cuerpo));

    expect(contactUpdateMany).toHaveBeenCalledTimes(1);
    const [args] = contactUpdateMany.mock.calls[0] as [{ data: { whatsappUserId: string } }];
    expect(args.data.whatsappUserId).toBe("MX.correcto");
  });

  // Si no se puede saber de quién es el user_id, no se escribe: adivinar deja el
  // identificador en el contacto equivocado y el UNIQUE lo vuelve irreversible.
  it("no adivina: con varios remitentes y ninguno que case, no escribe nada", async () => {
    const cuerpo = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn-1" },
                contacts: [
                  { wa_id: "5219990000000", user_id: "MX.uno" },
                  { wa_id: "5219991111111", user_id: "MX.dos" },
                ],
                messages: [
                  { id: "wamid.1", from: "5219982222222", type: "text", text: { body: "hola" } },
                ],
              },
            },
          ],
        },
      ],
    });

    await POST(postFirmado(cuerpo));

    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  // Fuera de la ventana de 30 días Meta omite `wa_id` y el identificador que viaja
  // en el mensaje es el propio BSUID. El emparejado por user_id cubre ese caso.
  it("empareja por user_id cuando el webhook llega sin wa_id", async () => {
    await POST(
      postFirmado(
        cuerpoConBsuid([{ profile: { name: "Ana" }, user_id: "MX.sin-telefono" }], "MX.sin-telefono"),
      ),
    );
    const [args] = contactUpdateMany.mock.calls[0] as [{ data: { whatsappUserId: string } }];
    expect(args.data.whatsappUserId).toBe("MX.sin-telefono");
  });

  it("un webhook sin user_id no escribe nada", async () => {
    await POST(postFirmado(CUERPO_OK));
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it("si no hubo contacto (opt-out, no capturable) no escribe nada", async () => {
    handleInboundWhatsApp.mockResolvedValue(null);
    await POST(
      postFirmado(cuerpoConBsuid([{ wa_id: "5219981234567", user_id: "MX.111" }])),
    );
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  // Guardar el BSUID es best-effort: es un dato de más, no un requisito de la
  // ingesta. Un choque de UNIQUE o una caída de la BD no puede tumbar el webhook,
  // porque Meta reintenta y el mensaje acabaría duplicándose en el inbox.
  it("🚨 si la escritura del BSUID falla, la ingesta NO se cae", async () => {
    contactUpdateMany.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await POST(
      postFirmado(cuerpoConBsuid([{ wa_id: "5219981234567", user_id: "MX.111" }])),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 1 });
  });
});

// ---------------------------------------------------------------------------
// #827 — a handleInboundWhatsApp le llega el teléfono REAL (wa_id), nunca el BSUID
// disfrazado de teléfono, y el BSUID viaja aparte en WhatsAppUserId.
// ---------------------------------------------------------------------------
describe("webhook de WhatsApp Cloud — #827 From real vs. BSUID-only", () => {
  function cuerpoConBsuid(contacts: unknown[], from = "5219981234567") {
    return JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn-1" },
                contacts,
                messages: [{ id: "wamid.1", from, type: "text", text: { body: "hola" } }],
              },
            },
          ],
        },
      ],
    });
  }

  it("con wa_id presente: From lleva el teléfono real y WhatsAppUserId el BSUID (comportamiento de siempre)", async () => {
    await POST(
      postFirmado(cuerpoConBsuid([{ wa_id: "5219981234567", user_id: "MX.123" }])),
    );
    const [payload] = handleInboundWhatsApp.mock.calls[0] as [Record<string, unknown>];
    expect(payload.From).toBe("whatsapp:+5219981234567");
    expect(payload.WhatsAppUserId).toBe("MX.123");
  });

  it("sin wa_id (fuera de la ventana de 30 días): From es null, NUNCA el BSUID disfrazado de teléfono", async () => {
    await POST(
      postFirmado(cuerpoConBsuid([{ user_id: "MX.sin-telefono" }], "MX.sin-telefono")),
    );
    const [payload] = handleInboundWhatsApp.mock.calls[0] as [Record<string, unknown>];
    expect(payload.From).toBeNull();
    expect(payload.WhatsAppUserId).toBe("MX.sin-telefono");
  });

  it("batch ambiguo (varios remitentes, ninguno casa): From null y sin BSUID — no adivina a quién pertenece el mensaje", async () => {
    const cuerpo = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn-1" },
                contacts: [
                  { wa_id: "5219990000000", user_id: "MX.uno" },
                  { wa_id: "5219991111111", user_id: "MX.dos" },
                ],
                messages: [{ id: "wamid.1", from: "5219982222222", type: "text", text: { body: "hola" } }],
              },
            },
          ],
        },
      ],
    });
    await POST(postFirmado(cuerpo));
    const [payload] = handleInboundWhatsApp.mock.calls[0] as [Record<string, unknown>];
    expect(payload.From).toBeNull();
    expect(payload.WhatsAppUserId).toBeNull();
  });
});

// #829: el acuse (sent/delivered/read) sigue emparejándose con su Message SOLO por
// wamid (twilioSid = statuses[].id) — eso no cambia aquí, a propósito (no hay un caso
// conocido donde falle). Lo nuevo es aprovechar el BSUID que trae el acuse para
// completar Contact.whatsappUserId cuando todavía no lo teníamos, best-effort.
function cuerpoConStatus(status: Record<string, unknown>) {
  return JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "pn-1" }, statuses: [status] } }] }],
  });
}

describe("webhook de WhatsApp Cloud — #829 BSUID del destinatario en los acuses", () => {
  it("acuse con recipient_user_id: el Message se actualiza por wamid igual que siempre", async () => {
    await POST(postFirmado(cuerpoConStatus({ id: "wamid.1", status: "delivered", recipient_user_id: "MX.1" })));
    expect(messageUpdateMany).toHaveBeenCalledWith({
      where: { twilioSid: "wamid.1" },
      data: { status: "DELIVERED" },
    });
  });

  it("con recipient_user_id, busca el contactId del Message y completa su BSUID si faltaba", async () => {
    messageFindFirst.mockResolvedValue({ contactId: "c1" });
    await POST(postFirmado(cuerpoConStatus({ id: "wamid.1", status: "sent", recipient_user_id: "MX.1" })));
    expect(messageFindFirst).toHaveBeenCalledWith({ where: { twilioSid: "wamid.1" }, select: { contactId: true } });
    expect(contactUpdateMany).toHaveBeenCalledWith({
      where: { id: "c1", whatsappUserId: null },
      data: { whatsappUserId: "MX.1" },
    });
  });

  it("también lo toma de contacts[].user_id si recipient_user_id no viene", async () => {
    messageFindFirst.mockResolvedValue({ contactId: "c1" });
    await POST(
      postFirmado(
        cuerpoConStatus({ id: "wamid.1", status: "read", contacts: [{ wa_id: "521999", user_id: "MX.2" }] }),
      ),
    );
    expect(contactUpdateMany).toHaveBeenCalledWith({
      where: { id: "c1", whatsappUserId: null },
      data: { whatsappUserId: "MX.2" },
    });
  });

  it("sin BSUID en el acuse (failed, p. ej.): ni siquiera busca el Message — no hay nada que completar", async () => {
    await POST(postFirmado(cuerpoConStatus({ id: "wamid.1", status: "failed" })));
    expect(messageFindFirst).not.toHaveBeenCalled();
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it("BSUID presente pero no se encuentra el Message: no truena, simplemente no completa nada", async () => {
    messageFindFirst.mockResolvedValue(null);
    await expect(
      POST(postFirmado(cuerpoConStatus({ id: "wamid.fantasma", status: "sent", recipient_user_id: "MX.1" }))),
    ).resolves.toBeDefined();
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it("status desconocido: se descarta antes de llegar al BSUID — ni status ni completar el contacto", async () => {
    messageFindFirst.mockResolvedValue({ contactId: "c1" });
    await POST(postFirmado(cuerpoConStatus({ id: "wamid.1", status: "deleted", recipient_user_id: "MX.1" })));
    expect(messageUpdateMany).not.toHaveBeenCalled();
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });
});
