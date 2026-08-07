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
const commentRuleLogFindFirst = vi.fn();
const commentRuleLogUpdateMany = vi.fn();
const slaTimerFindFirst = vi.fn();

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
    commentRuleLog: {
      findFirst: (...a: unknown[]) => commentRuleLogFindFirst(...a),
      updateMany: (...a: unknown[]) => commentRuleLogUpdateMany(...a),
    },
    slaTimer: { findFirst: (...a: unknown[]) => slaTimerFindFirst(...a) },
  },
}));
vi.mock("@/lib/intake/capture-lead", () => ({ captureLead: (...a: unknown[]) => captureLead(...a) }));
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));
vi.mock("@/lib/workflows/sla", () => ({ meetSlaTimers: (...a: unknown[]) => meetSlaTimers(...a) }));
const autoRouteLead = vi.fn();
vi.mock("@/lib/workflows/routing", () => ({
  autoRouteLead: (...a: unknown[]) => autoRouteLead(...a),
}));
const linkCommentOrigin = vi.fn();
// Solo se stubea linkCommentOrigin: isCommentOriginDetail se deja REAL para que
// el ruteo del primer reply se rompa aquí —y no en producción— si alguien
// cambia el prefijo de la marca de origen.
vi.mock("@/lib/comments/link-comment-origin", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/comments/link-comment-origin")>()),
  linkCommentOrigin: (...a: unknown[]) => linkCommentOrigin(...a),
}));
const emitEvent = vi.fn();
vi.mock("@/lib/workflows/events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));
const fetchProfileForMessage = vi.fn();
vi.mock("./profile", () => ({ fetchProfileForMessage: (...a: unknown[]) => fetchProfileForMessage(...a) }));
const isSenderBlocked = vi.fn();
vi.mock("@/lib/moderation/is-blocked", () => ({
  isSenderBlocked: (...a: unknown[]) => isSenderBlocked(...a),
}));
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
    commentRuleLogFindFirst, commentRuleLogUpdateMany, linkCommentOrigin, autoRouteLead,
    slaTimerFindFirst,
  ].forEach((m) => m.mockReset());
  autoRouteLead.mockResolvedValue("u-nuevo");
  slaTimerFindFirst.mockResolvedValue(null); // por defecto: nunca se enrutó
  contactFindUnique.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", custom: {} });
  commentRuleLogFindFirst.mockResolvedValue(null);
  linkCommentOrigin.mockResolvedValue(null);
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
  isSenderBlocked.mockReset();
  isSenderBlocked.mockResolvedValue(false);
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

  // Fix 1 (code review): la defensa contra el eco del propio DM era escribir
  // nosotros el opener con el message_id de la Send API, para que el eco choque
  // con Message.externalMessageId @unique. Eso es una CARRERA, no una garantía:
  // si el create() del eco commitea primero, este código ya evaluó
  // conversation.status === "BOT" y ya disparó el takeover; nuestro create choca
  // con P2002 y se descarta en silencio, demasiado tarde. La comprobación contra
  // CommentRuleLog.dmExternalMessageId es determinista y no depende de quién
  // gane la carrera.
  describe("Fix 1 — comprobación determinista contra CommentRuleLog", () => {
    it("eco de un DM disparado por regla de comentarios → sender BOT y SIN takeover", async () => {
      msgFindUnique.mockResolvedValue(null);
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
      commentRuleLogFindFirst.mockResolvedValue({ id: "log-1" });
      await handleInboundMessage(echo);
      expect(commentRuleLogFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { dmExternalMessageId: "mid-echo-1" } })
      );
      expect(msgCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sender: "BOT" }) })
      );
      // Solo el update de lastMessageAt; NUNCA el takeover a HUMAN.
      expect(convUpdate).toHaveBeenCalledTimes(1);
    });

    it("eco normal (sin log de comentarios) → sigue ADVISOR y SÍ aplica el takeover si estaba en BOT (regresión)", async () => {
      msgFindUnique.mockResolvedValue(null);
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
      commentRuleLogFindFirst.mockResolvedValue(null);
      convUpdate.mockResolvedValueOnce({ id: "conv1", status: "BOT", botEnabled: true });
      await handleInboundMessage(echo);
      expect(msgCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sender: "ADVISOR" }) })
      );
      expect(convUpdate).toHaveBeenCalledTimes(2);
      const takeover = convUpdate.mock.calls[1][0];
      expect(takeover.data.status).toBe("HUMAN");
    });

    it("la consulta a CommentRuleLog lanza → el eco sigue el camino de siempre (ADVISOR + takeover), no rompe la ingesta", async () => {
      msgFindUnique.mockResolvedValue(null);
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
      commentRuleLogFindFirst.mockRejectedValue(new Error("relation \"comment_rule_logs\" does not exist"));
      convUpdate.mockResolvedValueOnce({ id: "conv1", status: "BOT", botEnabled: true });
      const r = await handleInboundMessage(echo);
      expect(r).toBeTruthy();
      expect(msgCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sender: "ADVISOR" }) })
      );
      expect(convUpdate).toHaveBeenCalledTimes(2);
      expect(convUpdate.mock.calls[1][0].data.status).toBe("HUMAN");
    });
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

// Fix 3 (code review): el mock de @/lib/db no declaraba commentRuleLog, así que en
// CADA test no-WhatsApp de handleInboundMessage el hook a linkCommentOrigin (real,
// no mockeado) reventaba con TypeError al tocar prisma.commentRuleLog.findFirst — su
// propio try/catch lo absorbía en silencio. Ninguna aserción cubría el hook: una
// regresión que rompiera el guard de WhatsApp no hacía fallar ningún test.
describe("handleInboundMessage — hook a linkCommentOrigin (Fix 3)", () => {
  it("inbound de Instagram/Messenger → llama a linkCommentOrigin con (contact.id, channel, senderId)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(linkCommentOrigin).toHaveBeenCalledWith("c1", "INSTAGRAM", "IG-1");
  });

  it("inbound de WhatsApp → NO llama a linkCommentOrigin", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage(wa);
    expect(linkCommentOrigin).not.toHaveBeenCalled();
  });
});

describe("handleInboundMessage — remitente bloqueado", () => {
  it("descarta el mensaje sin tocar contactos", async () => {
    isSenderBlocked.mockResolvedValue(true);

    const res = await handleInboundMessage({
      channel: "INSTAGRAM",
      senderId: "IGSID-1",
      externalMessageId: "MID-BLOQ-1",
      text: "hola",
    } as never);

    expect(res).toBeNull();
    expect(isSenderBlocked).toHaveBeenCalledWith("INSTAGRAM", "IGSID-1");
    expect(contactFindFirst).not.toHaveBeenCalled();
  });

  it("consulta la lista con el canal y el senderId de WhatsApp", async () => {
    isSenderBlocked.mockResolvedValue(true);

    await handleInboundMessage({
      channel: "WHATSAPP",
      senderId: "+5219981234567",
      externalMessageId: "MID-BLOQ-2",
      text: "hola",
    } as never);

    expect(isSenderBlocked).toHaveBeenCalledWith("WHATSAPP", "+5219981234567");
    expect(contactFindFirst).not.toHaveBeenCalled();
  });

  it("un remitente no bloqueado sigue el camino normal", async () => {
    isSenderBlocked.mockResolvedValue(false);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });

    await handleInboundMessage({
      channel: "INSTAGRAM",
      senderId: "IGSID-2",
      externalMessageId: "MID-BLOQ-3",
      text: "hola",
    } as never);

    expect(contactFindFirst).toHaveBeenCalled();
  });
});

// Paridad con WhatsApp: responder por IG/Messenger emite la misma señal de "el
// lead respondió" y asciende a MQL igual (lib/lifecycle/transitions.ts). Sin
// esto, un contacto que solo habla por IG se quedaba clavado en LEAD para
// siempre — incluido el comentarista que el DM de una regla da de alta como
// provisional, que ya no pasa por captureLead cuando contesta.
describe("handleInboundMessage — señal 'el lead respondió'", () => {
  const known = { id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" };

  /** Todas las señales de respuesta emitidas, sea cual sea el canal. */
  function repliedCalls() {
    return emitEvent.mock.calls.filter(
      (c) => c[0] === "social.replied" || c[0] === "whatsapp.replied"
    );
  }

  it("INSTAGRAM: emite social.replied sobre la conversación", async () => {
    contactFindFirst.mockResolvedValue(known);
    await handleInboundMessage(base);
    expect(emitEvent).toHaveBeenCalledWith("social.replied", "conversation", "conv1", {
      contactId: "c1",
      channel: "INSTAGRAM",
      body: "hola",
    });
  });

  it("MESSENGER: emite social.replied con su propio canal", async () => {
    contactFindFirst.mockResolvedValue(known);
    await handleInboundMessage({
      ...base,
      channel: "MESSENGER" as const,
      senderId: "PSID-1",
      externalMessageId: "mid-ms-1",
    });
    expect(emitEvent).toHaveBeenCalledWith("social.replied", "conversation", "conv1", {
      contactId: "c1",
      channel: "MESSENGER",
      body: "hola",
    });
  });

  // El nombre viejo NO se reusa: hay un agente sembrado escuchando
  // whatsapp.replied (scripts/seed-agentes.ts) que se ampliaría en silencio.
  it("IG/Messenger NO emiten whatsapp.replied", async () => {
    contactFindFirst.mockResolvedValue(known);
    await handleInboundMessage(base);
    expect(emitEvent).not.toHaveBeenCalledWith(
      "whatsapp.replied", expect.anything(), expect.anything(), expect.anything()
    );
  });

  it("WHATSAPP no emite social.replied: sigue con la suya (no-regresión)", async () => {
    contactFindFirst.mockResolvedValue({ ...known, whatsappOptOut: false });
    await handleInboundMessage(wa);
    expect(emitEvent).toHaveBeenCalledWith(
      "whatsapp.replied", "conversation", "conv1", expect.objectContaining({ contactId: "c1" })
    );
    expect(emitEvent).not.toHaveBeenCalledWith(
      "social.replied", expect.anything(), expect.anything(), expect.anything()
    );
  });

  it("un echo NO emite ninguna señal de respuesta: no respondió el lead, respondió la Página", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue(known);
    convUpdate.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true });
    await handleInboundMessage(echo);
    expect(repliedCalls()).toHaveLength(0);
  });
});

// El contacto que crea una regla de comentarios nace SIN dueño (provisional).
// Cuando contesta ya es un lead de verdad, pero como el contacto existe el
// intake no vuelve a pasar por captureLead: si no se enruta en este punto, se
// queda huérfano — sin dueño, sin SLA y sin notificación — y si Sage escala,
// escalateToHuman lo deja en HUMAN con controlledById null y sin aviso.
describe("handleInboundMessage — el provisional deja de serlo al responder", () => {
  const MARCA = "comentario:MEDIA-1";
  const provisional = {
    id: "c1", assignedToId: null, firstName: "luisf", lastName: "(por identificar)",
    leadSourceDetail: MARCA,
  };

  it("sin dueño + marca de comentario → se enruta, con un reason que lo explica", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    await handleInboundMessage(base);
    expect(autoRouteLead).toHaveBeenCalledTimes(1);
    expect(autoRouteLead).toHaveBeenCalledWith("c1", { reason: "primer reply de comentario" });
  });

  it("CON dueño no se re-enruta (aunque conserve la marca de origen)", async () => {
    contactFindFirst.mockResolvedValue({ ...provisional, assignedToId: "u1" });
    await handleInboundMessage(base);
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  // Un gerente pudo desasignar a propósito: sin marca de origen no se le
  // deshace la decisión.
  it("sin dueño pero SIN marca (desasignado a mano) NO se enruta", async () => {
    contactFindFirst.mockResolvedValue({ ...provisional, leadSourceDetail: null });
    await handleInboundMessage(base);
    expect(autoRouteLead).not.toHaveBeenCalled();

    contactFindFirst.mockResolvedValue({ ...provisional, leadSourceDetail: "web:landing-tulum" });
    await handleInboundMessage({ ...base, externalMessageId: "mid-2" });
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  it("el segundo inbound ya no enruta: el primero le puso dueño", async () => {
    contactFindFirst.mockResolvedValueOnce(provisional);
    contactFindFirst.mockResolvedValue({ ...provisional, assignedToId: "u-nuevo" });

    await handleInboundMessage(base);
    await handleInboundMessage({ ...base, externalMessageId: "mid-2" });

    expect(autoRouteLead).toHaveBeenCalledTimes(1);
  });

  // El pago de todo esto: el aviso deja de irse al vacío.
  it("hilo en HUMAN sin controlledById: el aviso va al dueño recién enrutado, no se pierde", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    convFindFirst.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true, controlledById: null });
    convUpdate.mockResolvedValue({ id: "conv1", status: "HUMAN", botEnabled: true, controlledById: null });

    await handleInboundMessage(base);

    expect(notifCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u-nuevo" }) })
    );
  });

  it("si el ruteo truena, la ingesta sigue: el mensaje ya está en el hilo", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    autoRouteLead.mockRejectedValue(new Error("boom"));
    await expect(handleInboundMessage(base)).resolves.toBeTruthy();
  });
});

// Tercer tramo del guard: la marca de origen no se borra nunca (es
// procedencia), así que sin esto un contacto que vino de un comentario y al que
// un gerente desasignó a mano —con la feature de asignación del Inbox— se
// volvía a enrutar con su siguiente mensaje, deshaciéndole la decisión.
describe("handleInboundMessage — no re-enrutar a quien desasignaron a propósito", () => {
  const provisional = {
    id: "c1", assignedToId: null, firstName: "luisf", lastName: "(por identificar)",
    leadSourceDetail: "comentario:MEDIA-1",
  };

  it("primer inbound, sin FIRST_TOUCH previo → sí enruta", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    slaTimerFindFirst.mockResolvedValue(null);
    await handleInboundMessage(base);
    expect(autoRouteLead).toHaveBeenCalledTimes(1);
  });

  it("ya tuvo FIRST_TOUCH (se enrutó y luego lo desasignaron) → NO se re-enruta", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    slaTimerFindFirst.mockResolvedValue({ id: "sla-1" });
    await handleInboundMessage(base);
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  // Cualquier estado del timer sirve de prueba de que hubo ruteo: MET y
  // BREACHED también. Por eso el where no filtra por status.
  it("busca el FIRST_TOUCH del contacto sin filtrar por status", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    await handleInboundMessage(base);
    expect(slaTimerFindFirst).toHaveBeenCalledWith({
      where: { contactId: "c1", type: "FIRST_TOUCH" },
      select: { id: true },
    });
  });

  // autoRouteLead sale antes de createSlaTimer si no encuentra candidato, así
  // que un ruteo fallido no deja timer y debe reintentarse.
  it("ruteo que falló (devolvió null, sin timer) → reintenta en el siguiente inbound", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    slaTimerFindFirst.mockResolvedValue(null);
    autoRouteLead.mockResolvedValue(null);

    await handleInboundMessage(base);
    await handleInboundMessage({ ...base, externalMessageId: "mid-2" });

    expect(autoRouteLead).toHaveBeenCalledTimes(2);
  });

  // La query es el tramo caro: no debe correr en cada inbound.
  it("no consulta los timers si el contacto ya tiene dueño o no trae la marca", async () => {
    contactFindFirst.mockResolvedValue({ ...provisional, assignedToId: "u1" });
    await handleInboundMessage(base);
    expect(slaTimerFindFirst).not.toHaveBeenCalled();

    contactFindFirst.mockResolvedValue({ ...provisional, leadSourceDetail: null });
    await handleInboundMessage({ ...base, externalMessageId: "mid-2" });
    expect(slaTimerFindFirst).not.toHaveBeenCalled();
  });
});
