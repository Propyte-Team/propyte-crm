import { describe, it, expect, vi, beforeEach } from "vitest";

const msgFindFirst = vi.fn();
const msgCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    message: {
      findFirst: (...a: unknown[]) => msgFindFirst(...a),
      create: (...a: unknown[]) => msgCreate(...a),
    },
  },
}));

import {
  describeBotSendFailure,
  recordBotSendFailure,
  recordBotSilence,
  BOT_SEND_REJECTED_PREFIX,
  BOT_SILENCE_PREFIX,
} from "./send-failure";
import { GraphSendError } from "./graph";

function graphErr(code: number, message: string, subcode?: number) {
  return new GraphSendError("Graph send", 400, { code, message, error_subcode: subcode });
}

describe("describeBotSendFailure", () => {
  // Caso real 2026-10-10: DM a @propytemx sin respuesta porque la bandeja de
  // Meta Business Suite era la dueña del hilo.
  it.each([
    "(#10) The app is not the thread owner",
    "Cannot send message: this app is not the owner of the thread",
    "Message failed because another app is controlling this thread",
  ])("otra app dueña del hilo (%s) → ruteo de conversaciones", (meta) => {
    const text = describeBotSendFailure(graphErr(10, meta));
    expect(text).toContain(
      "Meta rechazó la respuesta del bot: otra app tiene el control de esta conversación (ruteo de conversaciones)"
    );
    expect(text).toContain(`Detalle de Meta: Graph send 10: ${meta}`);
  });

  it("code 10 de permisos → mensaje de pages_messaging", () => {
    const text = describeBotSendFailure(graphErr(10, "(#10) Requires pages_messaging permission to manage the object"));
    expect(text).toContain("no tiene permiso para enviar mensajes desde esta cuenta");
    expect(text).toContain("pages_messaging");
    expect(text).toContain("Detalle de Meta: Graph send 10: (#10) Requires pages_messaging permission");
  });

  it("fuera de la ventana de 24 h (code 10 con subcódigo) NO se reporta como permisos", () => {
    const text = describeBotSendFailure(
      graphErr(10, "(#10) This message is sent outside of allowed window.", 2534022)
    );
    expect(text).toContain("pasaron más de 24 h");
    expect(text).not.toContain("permiso");
  });

  it("cualquier otro rechazo de Meta → el error crudo de Graph", () => {
    expect(describeBotSendFailure(graphErr(551, "This person isn't available right now"))).toBe(
      `${BOT_SEND_REJECTED_PREFIX}: Graph send 551: This person isn't available right now`
    );
  });

  it("un fallo antes de llegar a Meta también se explica (no es 'Meta rechazó')", () => {
    expect(describeBotSendFailure(new Error("Conector INSTAGRAM inválido o inactivo"))).toBe(
      "No se pudo enviar la respuesta del bot: Conector INSTAGRAM inválido o inactivo"
    );
  });

  it("nunca deja pasar algo que parezca un token", () => {
    const text = describeBotSendFailure(new Error("fallo en /me/messages?access_token=EAAB-SECRETO&x=1"));
    expect(text).not.toContain("EAAB-SECRETO");
    expect(text).toContain("access_token=[oculto]");
  });

  // 2026-10-12: WhatsApp también deja la nota. Su transporte lanza Error (no GraphSendError)
  // con el código de Meta en el texto: esos son rechazos de Meta, el resto falló antes.
  it.each([
    "Meta Cloud API 131030: Recipient phone number not in allowed list",
    "Fuera de la ventana de 24h de WhatsApp (131047): se requiere plantilla aprobada. Re-engagement message",
    "WhatsApp (131062): este tipo de mensaje no acepta destinatario por BSUID — hace falta el teléfono. x",
  ])("WhatsApp: rechazo de la Cloud API (%s) → «Meta rechazó…» con el texto del transporte", (msg) => {
    expect(describeBotSendFailure(new Error(msg))).toBe(`${BOT_SEND_REJECTED_PREFIX}: ${msg}`);
  });

  it("WhatsApp: un fallo antes de llegar a Meta NO se reporta como rechazo de Meta", () => {
    expect(describeBotSendFailure(new Error("Contacto sin teléfono ni Usuario de WhatsApp"))).toBe(
      "No se pudo enviar la respuesta del bot: Contacto sin teléfono ni Usuario de WhatsApp"
    );
  });
});

describe("recordBotSendFailure", () => {
  beforeEach(() => {
    msgFindFirst.mockReset();
    msgCreate.mockReset();
    msgFindFirst.mockResolvedValue(null);
    msgCreate.mockResolvedValue({ id: "note-1" });
  });

  const args = {
    contactId: "c1",
    conversationId: "conv1",
    channel: "INSTAGRAM" as const,
    err: graphErr(10, "(#10) The app is not the thread owner"),
  };

  it("deja una nota interna en la conversación (nunca se manda al cliente)", async () => {
    await recordBotSendFailure(args);
    expect(msgCreate).toHaveBeenCalledTimes(1);
    const data = msgCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      contactId: "c1",
      conversationId: "conv1",
      channel: "INSTAGRAM",
      direction: "OUTBOUND",
      sender: "SYSTEM",
      internalNote: true,
      status: "FAILED",
    });
    expect(data.body).toContain("otra app tiene el control de esta conversación");
    expect(data.externalMessageId).toBeUndefined();
  });

  it("no repite la misma nota si ya está en la conversación (últimas 24 h)", async () => {
    msgFindFirst.mockResolvedValue({ id: "note-vieja" });
    await recordBotSendFailure(args);
    expect(msgFindFirst.mock.calls[0][0].where).toMatchObject({
      conversationId: "conv1",
      internalNote: true,
      sender: "SYSTEM",
      body: expect.stringContaining("otra app tiene el control"),
    });
    expect(msgCreate).not.toHaveBeenCalled();
  });

  it("un error de la base no se reporta como envío fallido (el mensaje pudo haber salido)", async () => {
    const prismaErr = Object.assign(new Error("Unique constraint failed"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    await recordBotSendFailure({ ...args, err: prismaErr });
    expect(msgCreate).not.toHaveBeenCalled();
  });

  it("si la nota no se puede escribir, no lanza (no tapa el error original)", async () => {
    msgCreate.mockRejectedValue(new Error("db caída"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordBotSendFailure(args)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// 2026-10-12: silencios del agente. Mismo rastro que los rechazos (nota interna SYSTEM,
// deduplicada, nunca lanza), con su propio prefijo para que el monitoreo los distinga.
describe("recordBotSilence", () => {
  beforeEach(() => {
    msgFindFirst.mockReset();
    msgCreate.mockReset();
    msgFindFirst.mockResolvedValue(null);
    msgCreate.mockResolvedValue({ id: "note-1" });
  });

  const args = {
    contactId: "c1",
    conversationId: "conv1",
    channel: "WHATSAPP" as const,
    reason: "el canal WhatsApp no está activado en la configuración general del agente (canales activos: ninguno).",
  };

  it("el prefijo de los silencios es distinto del de los rechazos (el monitoreo busca los dos)", () => {
    expect(BOT_SILENCE_PREFIX).toBe("El agente no contestó");
    expect(BOT_SILENCE_PREFIX).not.toBe(BOT_SEND_REJECTED_PREFIX);
  });

  it("deja la nota interna «El agente no contestó: {motivo}» en la conversación (WhatsApp incluido)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordBotSilence(args);
    expect(msgCreate).toHaveBeenCalledTimes(1);
    expect(msgCreate.mock.calls[0][0].data).toEqual({
      contactId: "c1",
      conversationId: "conv1",
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body: `El agente no contestó: ${args.reason}`,
      status: "FAILED",
      sender: "SYSTEM",
      internalNote: true,
    });
    // y el motivo también va a los registros
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(args.reason), expect.anything());
    warn.mockRestore();
  });

  it("no repite la misma nota de las últimas 24 h en esa conversación", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    msgFindFirst.mockResolvedValue({ id: "note-vieja" });
    await recordBotSilence(args);
    const where = msgFindFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      conversationId: "conv1",
      internalNote: true,
      sender: "SYSTEM",
      body: `El agente no contestó: ${args.reason}`,
    });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(msgCreate).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("un motivo distinto en la misma conversación sí deja su nota", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordBotSilence(args);
    await recordBotSilence({ ...args, reason: "la IA no devolvió respuesta." });
    expect(msgCreate).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("sin conversación: no toca la base, solo deja el aviso con el motivo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordBotSilence({ ...args, conversationId: null });
    expect(msgFindFirst).not.toHaveBeenCalled();
    expect(msgCreate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(args.reason), expect.anything());
    warn.mockRestore();
  });

  it.each([
    ["la lectura del deduplicado", () => msgFindFirst.mockRejectedValue(new Error("db caída"))],
    ["la escritura de la nota", () => msgCreate.mockRejectedValue(new Error("db caída"))],
  ])("si falla %s, no lanza y lo registra", async (_caso, romper) => {
    romper();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordBotSilence(args)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    warn.mockRestore();
  });

  it("nunca deja pasar algo que parezca un secreto (token, Bearer, llave de Anthropic)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordBotSilence({
      ...args,
      reason: "x access_token=EAAB-SECRETO&y Authorization: Bearer EAAG-OTRO llave sk-ant-api03-abc_DEF-123 fin",
    });
    const body = msgCreate.mock.calls[0][0].data.body as string;
    expect(body).not.toContain("EAAB-SECRETO");
    expect(body).not.toContain("EAAG-OTRO");
    expect(body).not.toContain("sk-ant-api03-abc_DEF-123");
    expect(body).toContain("access_token=[oculto]");
    expect(body).toContain("Bearer [oculto]");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-ant-api03");
    warn.mockRestore();
  });
});
