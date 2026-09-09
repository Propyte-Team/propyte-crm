import { describe, it, expect, vi, beforeEach } from "vitest";

// sendWhatsAppMessage es el embudo de side-effects de TODO WhatsApp saliente
// (dispatcher/bot L2, workflows SEND_WHATSAPP, agent tools, API manual): verifica
// que el markdown se convierte ANTES de entregar y que Message/Activity persisten
// exactamente el texto que salió por la red.

const deliverWhatsApp = vi.fn();
vi.mock("@/lib/whatsapp/transport", () => ({
  deliverWhatsApp: (...a: unknown[]) => deliverWhatsApp(...a),
  mediaSupportsCaption: (t: string) => ["image", "document", "video", "gif"].includes(t),
}));

const msgCreate = vi.fn();
const actCreate = vi.fn();
const convUpdate = vi.fn();
vi.mock("@/lib/db", () => {
  const db = {
    message: { create: (...a: unknown[]) => msgCreate(...a) },
    activity: { create: (...a: unknown[]) => actCreate(...a) },
    conversation: { update: (...a: unknown[]) => convUpdate(...a) },
  };
  return { default: db, prisma: db };
});

const ensureConversation = vi.fn();
vi.mock("@/lib/messaging/conversations", () => ({
  ensureConversation: (...a: unknown[]) => ensureConversation(...a),
}));

const meetSlaTimers = vi.fn();
vi.mock("@/lib/workflows/sla", () => ({
  meetSlaTimers: (...a: unknown[]) => meetSlaTimers(...a),
}));

const resolveWhatsAppSender = vi.fn();
vi.mock("@/lib/whatsapp/accounts", () => ({
  resolveWhatsAppSender: (...a: unknown[]) => resolveWhatsAppSender(...a),
}));

import { sendWhatsAppMessage } from "./whatsapp";

beforeEach(() => {
  vi.resetAllMocks();
  deliverWhatsApp.mockResolvedValue({ externalId: "wamid.X", status: "SENT" });
  ensureConversation.mockResolvedValue({ id: "conv1" });
  convUpdate.mockResolvedValue({ id: "conv1" });
  msgCreate.mockResolvedValue({ id: "m1" });
  actCreate.mockResolvedValue({ id: "a1" });
  meetSlaTimers.mockResolvedValue(undefined);
  // Sin connector → número global del env (setup de una sola línea).
  resolveWhatsAppSender.mockResolvedValue(null);
});

describe("sendWhatsAppMessage — markdown → formato WhatsApp (todos los emisores)", () => {
  it("entrega el texto convertido y persiste el MISMO texto en Message y Activity", async () => {
    await sendWhatsAppMessage(
      "+5219991112233",
      "Agendo para **mañana a las 7 AM** — un asesor te contacta.",
      "c1",
      "u1"
    );

    const expected = "Agendo para *mañana a las 7 AM* — un asesor te contacta.";
    expect(deliverWhatsApp).toHaveBeenCalledWith(expect.any(String), expected, undefined, null);
    expect(msgCreate.mock.calls[0][0].data.body).toBe(expected);
    expect(actCreate.mock.calls[0][0].data.description).toBe(expected);
  });

  it("texto sin markdown pasa sin cambios", async () => {
    await sendWhatsAppMessage("+5219991112233", "hola, ¿cómo vas?", "c1", "u1");
    expect(deliverWhatsApp).toHaveBeenCalledWith(expect.any(String), "hola, ¿cómo vas?", undefined, null);
    expect(msgCreate.mock.calls[0][0].data.body).toBe("hola, ¿cómo vas?");
  });
});

describe("sendWhatsAppMessage — multicuenta", () => {
  // El bug: se ignoraba el connector y TODA respuesta salía por el número global
  // del env, así que con 2+ marcas activas el cliente recibía la contestación
  // desde otro número.
  it("responde por la línea del connector con el que entró la conversación", async () => {
    const sender = { phoneNumberId: "PN_NATIVA", accessToken: "tok_nativa", brand: "Nativa" };
    resolveWhatsAppSender.mockResolvedValue(sender);

    await sendWhatsAppMessage("+5219991112233", "va", "c1", "u1", "connector-nativa");

    expect(resolveWhatsAppSender).toHaveBeenCalledWith("connector-nativa");
    expect(deliverWhatsApp).toHaveBeenCalledWith(expect.any(String), "va", undefined, sender);
  });

  it("el texto aparte de un sticker también sale por la misma línea", async () => {
    const sender = { phoneNumberId: "PN_NATIVA", accessToken: "tok_nativa" };
    resolveWhatsAppSender.mockResolvedValue(sender);

    await sendWhatsAppMessage("+5219991112233", "toma", "c1", "u1", "connector-nativa", {
      path: "2026-07/s.webp", url: "https://sb/s.webp", type: "sticker", mimeType: "image/webp",
    });

    // Las DOS entregas (texto suelto + media) llevan el mismo emisor: si solo una
    // lo llevara, el cliente vería la conversación partida entre dos números.
    expect(deliverWhatsApp).toHaveBeenNthCalledWith(1, expect.any(String), "toma", undefined, sender);
    expect(deliverWhatsApp).toHaveBeenNthCalledWith(2, expect.any(String), "toma",
      expect.objectContaining({ url: "https://sb/s.webp" }), sender);
  });

  it("si el connector está mal configurado NO se envía por el número equivocado", async () => {
    resolveWhatsAppSender.mockRejectedValue(new Error("no tiene phoneNumberId o accessToken"));

    await expect(
      sendWhatsAppMessage("+5219991112233", "va", "c1", "u1", "connector-roto"),
    ).rejects.toThrow(/phoneNumberId/);

    expect(deliverWhatsApp).not.toHaveBeenCalled();
  });
});

describe("sendWhatsAppMessage — media", () => {
  it("sticker con texto → texto aparte primero, luego media; Message persiste media", async () => {
    await sendWhatsAppMessage("+5219991112233", "toma", "c1", "u1", null, {
      path: "2026-07/s.webp", url: "https://sb/s.webp", type: "sticker", mimeType: "image/webp",
    });
    expect(deliverWhatsApp).toHaveBeenNthCalledWith(1, expect.any(String), "toma", undefined, null);
    expect(deliverWhatsApp).toHaveBeenNthCalledWith(2, expect.any(String), "toma",
      expect.objectContaining({ url: "https://sb/s.webp", type: "sticker" }), null);
    expect(msgCreate.mock.calls[0][0].data).toMatchObject({
      mediaUrl: "2026-07/s.webp", mediaType: "sticker", mediaMimeType: "image/webp",
    });
  });

  it("imagen sin texto → 1 sola entrega y body placeholder", async () => {
    await sendWhatsAppMessage("+5219991112233", "", "c1", "u1", null, {
      path: "2026-07/a.jpg", url: "https://sb/a.jpg", type: "image",
    });
    expect(deliverWhatsApp).toHaveBeenCalledTimes(1);
    expect(msgCreate.mock.calls[0][0].data.body).toBe("[Imagen]");
  });
});

// Tarjeta #687. La fila del mensaje nacía siempre con `sender: "ADVISOR"`, y quien enviaba
// en nombre del bot tenía que CORREGIRLA con un segundo update. En `lib/agents/tools.ts`
// ese update llevaba `.catch(() => {})`: si fallaba, un WhatsApp escrito por un agente
// quedaba en el hilo indistinguible de uno escrito por una persona — sin aviso en ninguna
// capa, y con la tool devolviendo `{ sent: true }`.
//
// Crear-y-corregir tiene una ventana en la que la fila está mal. Esa ventana no se cierra
// reportando mejor el error: se cierra no abriéndola.
describe("sendWhatsAppMessage — la autoría nace con la fila (#687)", () => {
  /** Los campos con los que se creó el Message. */
  function filaCreada(): Record<string, unknown> {
    return msgCreate.mock.calls[0][0].data;
  }

  it("sin opciones sigue siendo un mensaje de asesor, como antes", async () => {
    await sendWhatsAppMessage("+5219991112233", "voy para allá", "c1", "u1");

    expect(filaCreada().sender).toBe("ADVISOR");
    expect(filaCreada().aiGenerated).toBe(false);
    expect(filaCreada().aiAutonomy).toBeNull();
  });

  it("con autoriaBot los tres campos nacen puestos, en la misma escritura", async () => {
    await sendWhatsAppMessage("+5219991112233", "hola, soy el bot", "c1", "u1", null, undefined, {
      autoriaBot: true,
    });

    // Los tres juntos: `sender` decide cómo se pinta en el hilo, `aiGenerated` es lo que
    // filtran los reportes de actividad del bot, y `aiAutonomy` el nivel declarado.
    expect(filaCreada().sender).toBe("BOT");
    expect(filaCreada().aiGenerated).toBe(true);
    expect(filaCreada().aiAutonomy).toBe("L2");
  });

  it("autoriaBot: false es explícitamente humano, no ambiguo", async () => {
    await sendWhatsAppMessage("+5219991112233", "lo escribo yo", "c1", "u1", null, undefined, {
      autoriaBot: false,
    });

    expect(filaCreada().sender).toBe("ADVISOR");
    expect(filaCreada().aiGenerated).toBe(false);
  });

  it("solo `true` marca bot: un valor raro no convierte un mensaje humano en automático", async () => {
    // La comprobación es `=== true` a propósito. Si fuera un truthy suelto, un
    // `{ autoriaBot: undefined }` mal construido en un llamador nuevo daría un resultado
    // distinto según cómo llegara el objeto.
    await sendWhatsAppMessage("+5219991112233", "hm", "c1", "u1", null, undefined, {
      autoriaBot: undefined,
    });

    expect(filaCreada().sender).toBe("ADVISOR");
  });

  it("la autoría no se pierde por llevar adjunto", async () => {
    await sendWhatsAppMessage(
      "+5219991112233",
      "te mando el plano",
      "c1",
      "u1",
      null,
      { path: "2026-09/plano.pdf", url: "https://sb/plano", type: "document", filename: "plano.pdf" },
      { autoriaBot: true },
    );

    expect(filaCreada().sender).toBe("BOT");
    expect(filaCreada().mediaFilename).toBe("plano.pdf");
  });

  it("y sigue siendo UNA sola escritura del mensaje: no hay update que corregir", async () => {
    await sendWhatsAppMessage("+5219991112233", "hola", "c1", "u1", null, undefined, {
      autoriaBot: true,
    });

    expect(msgCreate).toHaveBeenCalledOnce();
  });
});
