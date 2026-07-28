import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const contactFindUnique = vi.fn();
const contactUpdate = vi.fn();
const adAttrFindUnique = vi.fn();
const adAttrCreate = vi.fn();
const convFindFirst = vi.fn();
const convCreate = vi.fn();
const convUpdate = vi.fn();
const msgCreate = vi.fn();
const msgFindUnique = vi.fn();
const activityCreate = vi.fn();
const notifCreate = vi.fn();
const captureLead = vi.fn();
const botRespond = vi.fn();
const meetSlaTimers = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      findUnique: (...a: unknown[]) => contactFindUnique(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
    },
    adAttribution: {
      findUnique: (...a: unknown[]) => adAttrFindUnique(...a),
      create: (...a: unknown[]) => adAttrCreate(...a),
    },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      create: (...a: unknown[]) => convCreate(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    message: { create: (...a: unknown[]) => msgCreate(...a), findUnique: (...a: unknown[]) => msgFindUnique(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { create: (...a: unknown[]) => notifCreate(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
  },
}));
vi.mock("@/lib/intake/capture-lead", () => ({ captureLead: (...a: unknown[]) => captureLead(...a) }));
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));
vi.mock("@/lib/workflows/sla", () => ({ meetSlaTimers: (...a: unknown[]) => meetSlaTimers(...a) }));
const emitEvent = vi.fn();
vi.mock("@/lib/workflows/events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));
const fetchProfileForMessage = vi.fn();
vi.mock("./profile", () => ({ fetchProfileForMessage: (...a: unknown[]) => fetchProfileForMessage(...a) }));
const mirrorExternalMedia = vi.fn();
vi.mock("@/lib/storage/chat-media", () => ({
  mirrorExternalMedia: (...a: unknown[]) => mirrorExternalMedia(...a),
  isStoragePath: (v: string) => !/^https?:\/\//i.test(v),
}));
const userFindFirst = vi.fn();
const contactTxUpdate = vi.fn();
const withChangeSourceSpy = vi.fn();
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (opts: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    withChangeSourceSpy(opts);
    return fn({ contact: { update: (...a: unknown[]) => contactTxUpdate(...a) } });
  },
}));

import { handleInboundMessage } from "./core";

beforeEach(() => {
  [
    contactFindFirst, contactFindUnique, contactUpdate, adAttrFindUnique, adAttrCreate,
    convFindFirst, convCreate, convUpdate, msgCreate, msgFindUnique, activityCreate,
    notifCreate, captureLead, botRespond, meetSlaTimers, emitEvent,
    fetchProfileForMessage, contactTxUpdate, withChangeSourceSpy,
  ].forEach((m) => m.mockReset());
  contactFindUnique.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", custom: {} });
  contactUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    assignedToId: "u1",
    firstName: (data.firstName as string) ?? "A",
    lastName: (data.lastName as string) ?? "B",
    custom: data.custom ?? {},
  }));
  adAttrFindUnique.mockResolvedValue(null);
  adAttrCreate.mockResolvedValue({});
  convFindFirst.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
  convUpdate.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
  msgCreate.mockResolvedValue({ id: "m1" });
  activityCreate.mockResolvedValue({});
  fetchProfileForMessage.mockResolvedValue(null);
  mirrorExternalMedia.mockReset();
  mirrorExternalMedia.mockResolvedValue(null);
});

const base = { channel: "INSTAGRAM" as const, senderId: "IG-1", externalMessageId: "mid-1", text: "hola", profileName: "Ana" };

describe("handleInboundMessage", () => {
  it("DM de desconocido → captureLead con source y id social", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(base);
    expect(captureLead).toHaveBeenCalledWith(
      expect.objectContaining({ source: "INSTAGRAM", instagramId: "IG-1", firstName: "Ana" })
    );
    expect(convUpdate).toHaveBeenCalled();
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "INSTAGRAM", direction: "INBOUND", externalMessageId: "mid-1" }) })
    );
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activityType: "INSTAGRAM_IN" }) })
    );
  });

  it("contacto conocido por instagramId → no captura", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(captureLead).not.toHaveBeenCalled();
  });

  it("reentrega con mismo externalMessageId → idempotente (no duplica)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    msgCreate.mockRejectedValueOnce({ code: "P2002" });
    msgFindUnique.mockResolvedValue({ id: "m-existing" });
    const r = await handleInboundMessage(base);
    expect(msgFindUnique).toHaveBeenCalledWith({ where: { externalMessageId: "mid-1" } });
    expect(r).toEqual({ id: "m-existing" });
  });

  it("status BOT + botEnabled → botRespond con channel", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
  });

  // Coalescing por batch (BUG 2026-07-24): los webhooks ingieren todo el batch con
  // triggerBot:false y disparan el bot una vez al final — el core NO debe dispararlo.
  it("triggerBot:false NO dispara el bot (el webhook coalescente lo hace al final)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    const r = await handleInboundMessage(base, { triggerBot: false });
    expect(r).toBeTruthy(); // la ingesta normal sí ocurre
    expect(botRespond).not.toHaveBeenCalled();
  });

  // BUG 2026-07-24 (bot mudo): contacto SIN asignar → la actividad se creaba con
  // userId = contact.id (¡un contacto como user!) → FK violada → TODO el pipeline
  // moría tras persistir el mensaje: sin actividad, sin SLA, sin eventos y SIN BOT.
  describe("contacto sin asignar (assignedToId null)", () => {
    beforeEach(() => {
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: null, firstName: "A", lastName: "B" });
      userFindFirst.mockResolvedValue({ id: "u-admin" });
    });

    it("la actividad se atribuye a un ADMIN activo, jamás a contact.id", async () => {
      await handleInboundMessage(base);
      expect(activityCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: "u-admin" }) })
      );
    });

    it("sin ADMIN disponible: se salta la actividad pero el bot IGUAL responde", async () => {
      userFindFirst.mockResolvedValue(null);
      await handleInboundMessage(base);
      expect(activityCreate).not.toHaveBeenCalled();
      expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
    });
  });

  // Defensa en profundidad: los side-effects post-persistencia (actividad, SLA,
  // eventos) NUNCA deben matar la ingesta ni enmudecer al bot.
  describe("side-effects no matan el pipeline", () => {
    beforeEach(() => {
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    });

    it("activity.create truena → el bot igual responde y la ingesta regresa el mensaje", async () => {
      activityCreate.mockRejectedValue(new Error("FK violation"));
      const r = await handleInboundMessage(base);
      expect(r).toBeTruthy();
      expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
    });

    it("meetSlaTimers truena → el bot igual responde", async () => {
      meetSlaTimers.mockRejectedValue(new Error("db down"));
      await handleInboundMessage(base);
      expect(botRespond).toHaveBeenCalled();
    });

    it("emitEvent truena (canal WHATSAPP) → el bot igual responde", async () => {
      emitEvent.mockRejectedValue(new Error("engine error"));
      await handleInboundMessage({ ...base, channel: "WHATSAPP" as const, senderId: "+525576330809" });
      expect(botRespond).toHaveBeenCalledWith("c1", { channel: "WHATSAPP" });
    });
  });
});

describe("handleInboundMessage – identidad social (perfil Graph)", () => {
  const msgMs = { channel: "MESSENGER" as const, senderId: "PSID-1", externalMessageId: "mid-9", text: "hola", connectorId: "conn-nativa" };

  it("desconocido con conector → captureLead con nombre real del perfil", async () => {
    contactFindFirst.mockResolvedValue(null);
    fetchProfileForMessage.mockResolvedValue({ firstName: "Ana", lastName: "García", avatarUrl: null });
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(msgMs);
    expect(fetchProfileForMessage).toHaveBeenCalledWith(msgMs);
    expect(captureLead).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Ana", lastName: "García", messengerPsid: "PSID-1" })
    );
    expect(contactTxUpdate).not.toHaveBeenCalled(); // sin avatar no hay update extra
  });

  it("desconocido con avatar → guarda custom.avatarUrl tras captureLead", async () => {
    contactFindFirst.mockResolvedValue(null);
    fetchProfileForMessage.mockResolvedValue({ firstName: "Ana", lastName: "García", avatarUrl: "https://cdn/p.jpg" });
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    contactTxUpdate.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Ana", lastName: "García", assignedTo: null });
    await handleInboundMessage(msgMs);
    expect(withChangeSourceSpy).toHaveBeenCalledWith(expect.objectContaining({ source: "social_profile" }));
    expect(contactTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({ custom: expect.objectContaining({ avatarUrl: "https://cdn/p.jpg" }) }),
      })
    );
  });

  it("perfil falla → placeholder actual (regresión cero)", async () => {
    contactFindFirst.mockResolvedValue(null);
    fetchProfileForMessage.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(msgMs);
    expect(captureLead).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Messenger", lastName: "(por identificar)" })
    );
  });

  it("contacto existente '(por identificar)' → se repara vía withChangeSource", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Messenger", lastName: "(por identificar)", custom: { foo: 1 } });
    fetchProfileForMessage.mockResolvedValue({ firstName: "Ana", lastName: "García", avatarUrl: "https://cdn/p.jpg" });
    contactTxUpdate.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Ana", lastName: "García", custom: { foo: 1, avatarUrl: "https://cdn/p.jpg" }, assignedTo: null });
    await handleInboundMessage(msgMs);
    expect(contactTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({
          firstName: "Ana",
          lastName: "García",
          custom: expect.objectContaining({ foo: 1, avatarUrl: "https://cdn/p.jpg" }),
        }),
      })
    );
    // la actividad sale ya con el nombre reparado
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subject: expect.stringContaining("Ana García") }) })
    );
  });

  it("contacto existente con nombre real → NO consulta Graph", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(msgMs);
    expect(fetchProfileForMessage).not.toHaveBeenCalled();
  });

  it("update del perfil falla → el intake sigue (mensaje se crea)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Messenger", lastName: "(por identificar)", custom: null });
    fetchProfileForMessage.mockResolvedValue({ firstName: "Ana", lastName: "García", avatarUrl: null });
    contactTxUpdate.mockRejectedValue(new Error("db"));
    const r = await handleInboundMessage(msgMs);
    expect(r).toEqual({ id: "m1" });
  });
});

describe("handleInboundMessage – username de IG (custom.ig_username)", () => {
  const msgIg = { channel: "INSTAGRAM" as const, senderId: "IGSID-1", externalMessageId: "mid-u1", text: "hola", connectorId: "conn-ig" };

  it("desconocido IG con username (sin avatar) → guarda custom.ig_username tras captureLead", async () => {
    contactFindFirst.mockResolvedValue(null);
    fetchProfileForMessage.mockResolvedValue({ firstName: "Ana", lastName: "(@ana.g)", avatarUrl: null, username: "ana.g" });
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    contactTxUpdate.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Ana", lastName: "(@ana.g)", custom: { ig_username: "ana.g" }, assignedTo: null });
    await handleInboundMessage(msgIg);
    expect(contactTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({ custom: expect.objectContaining({ ig_username: "ana.g" }) }),
      })
    );
    // names:false — captureLead ya puso el nombre; el update extra NO lo pisa
    const data = contactTxUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("firstName");
  });

  it("existente '(por identificar)' IG con username + avatar → custom lleva ambos", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Instagram", lastName: "(por identificar)", custom: { foo: 1 } });
    fetchProfileForMessage.mockResolvedValue({ firstName: "Ana", lastName: "María García", avatarUrl: "https://cdn/ig.jpg", username: "ana.g" });
    contactTxUpdate.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Ana", lastName: "María García", custom: { foo: 1, avatarUrl: "https://cdn/ig.jpg", ig_username: "ana.g" }, assignedTo: null });
    await handleInboundMessage(msgIg);
    expect(contactTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firstName: "Ana",
          lastName: "María García",
          custom: expect.objectContaining({ foo: 1, avatarUrl: "https://cdn/ig.jpg", ig_username: "ana.g" }),
        }),
      })
    );
  });
});

describe("handleInboundMessage — atribución de referral (Caso 2)", () => {
  it("referral con adId y contacto sin AdAttribution → crea AdAttribution y guarda custom.meta_referral", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", custom: { foo: "bar" } });
    adAttrFindUnique.mockResolvedValue(null);
    const referral = { ref: "campana-1", source: "ADS", type: "OPEN_THREAD", adId: "AD-1" };
    await handleInboundMessage({ ...base, referral });
    expect(adAttrFindUnique).toHaveBeenCalledWith({ where: { contactId: "c1" } });
    expect(adAttrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "c1", network: "META_DM", utmSource: "instagram_ctm", utmContent: "AD-1", utmCampaign: "campana-1",
        }),
      })
    );
    expect(contactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({ custom: expect.objectContaining({ foo: "bar", meta_referral: referral }) }),
      })
    );
  });

  it("referral con ref pero sin adId → igual crea atribución (utmContent null)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", custom: {} });
    adAttrFindUnique.mockResolvedValue(null);
    await handleInboundMessage({ ...base, referral: { ref: "campana-2", source: "SHORTLINK" } });
    expect(adAttrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ utmContent: null, utmCampaign: "campana-2" }) })
    );
  });

  it("contacto YA tiene AdAttribution → NO crea otra, solo actualiza custom", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", custom: {} });
    adAttrFindUnique.mockResolvedValue({ id: "attr1" });
    await handleInboundMessage({ ...base, referral: { adId: "AD-3" } });
    expect(adAttrCreate).not.toHaveBeenCalled();
    expect(contactUpdate).toHaveBeenCalled();
  });

  it("referral sin adId ni ref (solo source/type) → no toca AdAttribution ni custom", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", custom: {} });
    await handleInboundMessage({ ...base, referral: { source: "ADS", type: "OPEN_THREAD" } });
    expect(adAttrFindUnique).not.toHaveBeenCalled();
    expect(adAttrCreate).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("sin referral → no toca AdAttribution (regresión)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", custom: {} });
    await handleInboundMessage(base);
    expect(adAttrFindUnique).not.toHaveBeenCalled();
    expect(adAttrCreate).not.toHaveBeenCalled();
  });

  it("channel MESSENGER con referral adId → utmSource messenger_ctm", async () => {
    contactFindFirst.mockResolvedValue({ id: "c2", assignedToId: "u1", firstName: "A", lastName: "B", custom: {} });
    adAttrFindUnique.mockResolvedValue(null);
    await handleInboundMessage({
      channel: "MESSENGER", senderId: "PSID-1", externalMessageId: "mid-m1", text: "hola",
      referral: { adId: "AD-4" },
    });
    expect(adAttrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ utmSource: "messenger_ctm" }) })
    );
  });
});

const echo = {
  channel: "MESSENGER" as const,
  senderId: "PSID-user", // ya normalizado por el adapter a recipient.id (el usuario)
  externalMessageId: "mid-echo-1",
  text: "le respondimos desde Business Suite",
  isEcho: true,
  echoAppId: "263902037430900",
  connectorId: "conn_ms",
};

describe("handleInboundMessage — echoes (Caso 4)", () => {
  it("echo cuyo mid ya existe como Message (envío del propio CRM) → skip total, devuelve el existente", async () => {
    msgFindUnique.mockResolvedValue({ id: "m-own", externalMessageId: "mid-echo-1" });
    const r = await handleInboundMessage(echo);
    expect(msgFindUnique).toHaveBeenCalledWith({ where: { externalMessageId: "mid-echo-1" } });
    expect(r).toEqual({ id: "m-own", externalMessageId: "mid-echo-1" });
    expect(contactFindFirst).not.toHaveBeenCalled();
    expect(msgCreate).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("echo sin contacto existente → skip (NO crea contacto desde echoes)", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue(null);
    const r = await handleInboundMessage(echo);
    expect(r).toBeNull();
    expect(captureLead).not.toHaveBeenCalled();
    expect(msgCreate).not.toHaveBeenCalled();
  });

  it("echo con contacto → registra OUTBOUND sender ADVISOR (humano externo), aiGenerated false", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(echo);
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "c1",
          channel: "MESSENGER",
          direction: "OUTBOUND",
          sender: "ADVISOR",
          aiGenerated: false,
          externalMessageId: "mid-echo-1",
        }),
      })
    );
  });

  it("echo: actualiza lastMessageAt pero NO lastInboundAt ni unreadCount (es saliente)", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    convUpdate.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true });
    await handleInboundMessage(echo);
    const data = convUpdate.mock.calls[0][0].data;
    expect(data.lastMessageAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("lastInboundAt");
    expect(data).not.toHaveProperty("unreadCount");
  });

  it("takeover suave: conversación en BOT → pasa a HUMAN con controlledById del asesor asignado", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    convUpdate.mockResolvedValueOnce({ id: "conv1", status: "BOT", botEnabled: true });
    await handleInboundMessage(echo);
    expect(convUpdate).toHaveBeenCalledTimes(2);
    const takeover = convUpdate.mock.calls[1][0];
    expect(takeover.where).toEqual({ id: "conv1" });
    expect(takeover.data.status).toBe("HUMAN");
    expect(takeover.data.controlledById).toBe("u1");
    expect(takeover.data.takeoverAt).toBeInstanceOf(Date);
  });

  it("conversación ya en HUMAN → no repite takeover", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    convFindFirst.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true });
    convUpdate.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true });
    await handleInboundMessage(echo);
    expect(convUpdate).toHaveBeenCalledTimes(1);
  });

  it("echo NO dispara side-effects de inbound: sin actividad IN, sin notificación, sin botRespond", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    convUpdate.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true });
    await handleInboundMessage(echo);
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notifCreate).not.toHaveBeenCalled();
    expect(botRespond).not.toHaveBeenCalled();
  });

  it("echo SÍ marca SLA de primera respuesta como cumplido (igual que un envío del dispatcher)", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    convUpdate.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true });
    await handleInboundMessage(echo);
    expect(meetSlaTimers).toHaveBeenCalledWith("c1");
  });

  it("echo idempotente: carrera P2002 al crear → devuelve el mensaje ya persistido", async () => {
    msgFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "m-race" });
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    convUpdate.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true });
    msgCreate.mockRejectedValueOnce({ code: "P2002" });
    const r = await handleInboundMessage(echo);
    expect(r).toEqual({ id: "m-race" });
  });

  it("echo NUNCA dispara el fetch de perfil Graph (el emisor es la Página), ni con contacto placeholder", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Messenger", lastName: "(por identificar)" });
    convUpdate.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true });
    await handleInboundMessage(echo);
    expect(fetchProfileForMessage).not.toHaveBeenCalled();
    expect(contactTxUpdate).not.toHaveBeenCalled();
  });
});

describe("handleInboundMessage – media", () => {
  const known = { id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" };

  it("media IG con URL externa → se espeja al bucket y persiste path + tipo", async () => {
    contactFindFirst.mockResolvedValue(known);
    mirrorExternalMedia.mockResolvedValue({ path: "2026-07/a.jpg", mimeType: "image/jpeg" });
    await handleInboundMessage({
      channel: "INSTAGRAM", senderId: "IG-1", externalMessageId: "mid-m1",
      text: "[Imagen]", mediaUrl: "https://cdn.fbsbx.com/x.jpg", mediaType: "image",
    });
    expect(mirrorExternalMedia).toHaveBeenCalledWith("https://cdn.fbsbx.com/x.jpg");
    expect(msgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mediaUrl: "2026-07/a.jpg", mediaType: "image", mediaMimeType: "image/jpeg" }),
    }));
  });

  it("espejo falla → conserva la URL efímera (renderiza mientras viva)", async () => {
    contactFindFirst.mockResolvedValue(known);
    mirrorExternalMedia.mockResolvedValue(null);
    await handleInboundMessage({
      channel: "MESSENGER", senderId: "P-1", externalMessageId: "mid-m2",
      text: "[GIF]", mediaUrl: "https://cdn.fbsbx.com/a.gif", mediaType: "gif",
    });
    expect(msgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mediaUrl: "https://cdn.fbsbx.com/a.gif", mediaType: "gif" }),
    }));
  });

  it("media ya en bucket (WA resuelto en webhook) → NO se re-espeja", async () => {
    contactFindFirst.mockResolvedValue({ ...known, whatsappOptOut: false });
    await handleInboundMessage({
      channel: "WHATSAPP", senderId: "+5299", externalMessageId: "wamid-m3",
      text: "[Sticker]", mediaUrl: "2026-07/s.webp", mediaType: "sticker", mediaMimeType: "image/webp",
    });
    expect(mirrorExternalMedia).not.toHaveBeenCalled();
    expect(msgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mediaUrl: "2026-07/s.webp", mediaType: "sticker", mediaMimeType: "image/webp" }),
    }));
  });

  it("sin mediaType → no intenta espejar (comportamiento legacy)", async () => {
    contactFindFirst.mockResolvedValue(known);
    await handleInboundMessage({
      channel: "INSTAGRAM", senderId: "IG-1", externalMessageId: "mid-m4",
      text: "hola", mediaUrl: null,
    });
    expect(mirrorExternalMedia).not.toHaveBeenCalled();
    expect(msgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mediaUrl: null, mediaType: null }),
    }));
  });
});

const wa = { channel: "WHATSAPP" as const, senderId: "+529991112233", externalMessageId: "wamid-1", text: "hola", profileName: "Ana" };

describe("handleInboundMessage – regresiones WhatsApp", () => {
  beforeEach(() => {
    convFindFirst.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
    convUpdate.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
    msgCreate.mockResolvedValue({ id: "m1" });
    activityCreate.mockResolvedValue({});
  });

  it("WHATSAPP: contacto con opt-out NO dispara el bot", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: true });
    await handleInboundMessage(wa);
    expect(botRespond).not.toHaveBeenCalled();
  });

  it("WHATSAPP: contacto sin opt-out SÍ dispara el bot", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage(wa);
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "WHATSAPP" });
  });

  it("WHATSAPP: emite el evento whatsapp.replied (no-regresión)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage(wa);
    expect(emitEvent).toHaveBeenCalledWith("whatsapp.replied", "conversation", "conv1", expect.objectContaining({ contactId: "c1" }));
  });

  it("WHATSAPP: nunca consulta el perfil Graph (ni en desconocidos)", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(wa);
    expect(fetchProfileForMessage).not.toHaveBeenCalled();
  });

  it("WHATSAPP: busca contacto con match flexible (exact OR endsWith last10)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage(wa);
    expect(contactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([{ phone: "+529991112233" }]) }) })
    );
  });
});
