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
const fieldChangeFindFirst = vi.fn();
const leadConnectorUpdate = vi.fn();
const leadConnectorFindUnique = vi.fn();

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
    recordFieldChange: { findFirst: (...a: unknown[]) => fieldChangeFindFirst(...a) },
    leadConnector: {
      update: (...a: unknown[]) => leadConnectorUpdate(...a),
      findUnique: (...a: unknown[]) => leadConnectorFindUnique(...a),
    },
  },
}));
// Atribución contacto ↔ marca (2026-10-09): se mockean los dos módulos de marcas para no
// acoplar este archivo a sus consultas (attachBrand y getDefaultBrandId tienen sus propias pruebas).
const attachBrand = vi.fn();
vi.mock("@/lib/brands/attach", () => ({ attachBrand: (...a: unknown[]) => attachBrand(...a) }));
const getDefaultBrandId = vi.fn();
vi.mock("@/lib/brands/resolve", () => ({ getDefaultBrandId: (...a: unknown[]) => getDefaultBrandId(...a) }));
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

// Formulario de anuncio (2026-10-10): el detector de duplicados tiene sus propias
// pruebas; aquí solo importa que se llame cuando entra un teléfono o correo.
const detectDuplicatesForContact = vi.fn();
vi.mock("@/lib/contacts/duplicate-alert", () => ({
  detectDuplicatesForContact: (...a: unknown[]) => detectDuplicatesForContact(...a),
}));

// A quién se atribuye la actividad de inbound (2026-10-12): lo decide el helper común,
// que tiene sus propias pruebas (lib/users/actor-sistema.test.ts). Aquí solo importa que
// core.ts le pregunte a él, con el asesor y la cuenta del mensaje, y use lo que devuelva.
const resolveActorUserId = vi.fn();
vi.mock("@/lib/users/actor-sistema", () => ({
  resolveActorUserId: (...a: unknown[]) => resolveActorUserId(...a),
}));

// #858 (2026-10-14): a quién se avisa de un hilo HUMAN sin dueño y el dedup se prueban en
// aviso-sin-dueno.test.ts; aquí solo importa que core.ts lo pida cuando toca y no cuando no.
const avisarHiloSinDueno = vi.fn();
vi.mock("./aviso-sin-dueno", () => ({
  avisarHiloSinDueno: (...a: unknown[]) => avisarHiloSinDueno(...a),
}));

import { handleInboundMessage } from "./core";

beforeEach(() => {
  [
    contactFindFirst, contactFindUnique, contactUpdate, adAttrFindUnique, adAttrCreate,
    convFindFirst, convCreate, convUpdate, msgCreate, msgFindUnique, activityCreate,
    notifCreate, captureLead, botRespond, meetSlaTimers, emitEvent,
    fetchProfileForMessage, contactTxUpdate, withChangeSourceSpy,
    commentRuleLogFindFirst, commentRuleLogUpdateMany, linkCommentOrigin, autoRouteLead,
    slaTimerFindFirst, leadConnectorUpdate, leadConnectorFindUnique, attachBrand, getDefaultBrandId,
    resolveActorUserId, avisarHiloSinDueno, fieldChangeFindFirst,
  ].forEach((m) => m.mockReset());
  avisarHiloSinDueno.mockResolvedValue([]);
  // Por defecto el asesor asignado es una persona: el helper lo devuelve tal cual.
  resolveActorUserId.mockImplementation(async ({ assignedToId }: { assignedToId?: string | null }) => assignedToId ?? null);
  autoRouteLead.mockResolvedValue("u-nuevo");
  slaTimerFindFirst.mockResolvedValue(null); // por defecto: nunca se enrutó
  fieldChangeFindFirst.mockResolvedValue(null); // …ni se le asignó dueño a mano
  leadConnectorUpdate.mockResolvedValue({});
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
      expect.objectContaining({ source: "INSTAGRAM", instagramId: "IG-1", firstName: "Ana" }),
      { connectorId: undefined }
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
      resolveActorUserId.mockResolvedValue("u-admin");
    });

    it("la actividad se atribuye a quien diga el helper (un usuario), jamás a contact.id", async () => {
      await handleInboundMessage(base);
      expect(activityCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: "u-admin" }) })
      );
    });

    it("sin nadie a quien atribuirla: se salta la actividad pero el bot IGUAL responde", async () => {
      resolveActorUserId.mockResolvedValue(null);
      await handleInboundMessage(base);
      expect(activityCreate).not.toHaveBeenCalled();
      expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
    });
  });

  // 2026-10-12: la cronología mostraba los mensajes entrantes hechos «por Audit Temp
  // (Claude)». La firma de la actividad ya no la elige core.ts: se la pide al helper común,
  // con el asesor del contacto y la cuenta por la que llegó el mensaje (de ahí sale la marca).
  describe("firma de la actividad de inbound (helper común)", () => {
    it("le pregunta al helper con el asesor del contacto y la cuenta del mensaje", async () => {
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u-agentes", firstName: "A", lastName: "B" });
      await handleInboundMessage({ ...base, connectorId: "conn-ig" });
      expect(resolveActorUserId).toHaveBeenCalledWith({ assignedToId: "u-agentes", connectorId: "conn-ig" });
    });

    it("asesor técnico: la actividad sale a nombre de quien devuelve el helper, y el contacto NO cambia de dueño", async () => {
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u-agentes", firstName: "A", lastName: "B" });
      resolveActorUserId.mockResolvedValue("u-marketing");
      await handleInboundMessage({ ...base, connectorId: "conn-ig" });

      expect(activityCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: "u-marketing", activityType: "INSTAGRAM_IN" }) })
      );
      // El mensaje entrante sigue colgando del dueño del contacto, y nadie toca la asignación.
      expect(msgCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: "u-agentes" }) })
      );
      for (const [arg] of contactUpdate.mock.calls) {
        expect((arg as { data: Record<string, unknown> }).data).not.toHaveProperty("assignedToId");
      }
      expect(autoRouteLead).not.toHaveBeenCalled();
    });

    it("sin cuenta (número global) pasa connectorId null", async () => {
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
      await handleInboundMessage(base);
      expect(resolveActorUserId).toHaveBeenCalledWith({ assignedToId: "u1", connectorId: null });
    });

    it("si el helper lanza, la actividad se omite pero la ingesta y el bot siguen", async () => {
      contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
      resolveActorUserId.mockRejectedValue(new Error("db down"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await handleInboundMessage(base);
      expect(r).toBeTruthy();
      expect(activityCreate).not.toHaveBeenCalled();
      expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
      err.mockRestore();
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
      expect.objectContaining({ firstName: "Ana", lastName: "García", messengerPsid: "PSID-1" }),
      { connectorId: "conn-nativa" }
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
      expect.objectContaining({ firstName: "Messenger", lastName: "(por identificar)" }),
      { connectorId: "conn-nativa" }
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

// ---------------------------------------------------------------------------
// #827 — reconocer al contacto por teléfono O por BSUID (evitar duplicados)
//
// Hoy (#826) el BSUID solo se GUARDA sobre un contacto ya resuelto por teléfono.
// El problema que #827 cierra es el de ARRIBA: cuando Meta manda el mensaje SIN
// `wa_id` (fuera de ventana de 30 días), `senderId` deja de ser un teléfono real —
// tratarlo como tal (bug original) producía un contacto fantasma por cada persona
// que ya existía con su teléfono real.
// ---------------------------------------------------------------------------
describe("handleInboundMessage – #827 BSUID en la resolución de contacto", () => {
  beforeEach(() => {
    convFindFirst.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
    convUpdate.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
    msgCreate.mockResolvedValue({ id: "m1" });
    activityCreate.mockResolvedValue({});
  });

  it("con teléfono real, añade whatsappUserId al OR (match aditivo, no-regresión)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage({ ...wa, whatsappUserId: "MX.123" });
    expect(contactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ phone: "+529991112233" }, { whatsappUserId: "MX.123" }]),
        }),
      }),
    );
  });

  it("sin teléfono real (senderIdIsPhone:false), el OR busca SOLO por whatsappUserId — nunca por el BSUID como si fuera teléfono", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage({ ...wa, senderId: "MX.sin-telefono", senderIdIsPhone: false, whatsappUserId: "MX.sin-telefono" });
    const [args] = contactFindFirst.mock.calls[0] as [{ where: { OR: unknown[] } }];
    expect(args.where.OR).toEqual([{ whatsappUserId: "MX.sin-telefono" }]);
  });

  it("mensaje sin teléfono que SÍ matchea un contacto existente por BSUID: no crea uno nuevo", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-existente", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    const result = await handleInboundMessage({
      ...wa, senderId: "MX.sin-telefono", senderIdIsPhone: false, whatsappUserId: "MX.sin-telefono",
    });
    expect(captureLead).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "m1" });
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: "c-existente" }) }),
    );
  });

  it("mensaje sin teléfono y sin match por BSUID: NO inventa un contacto con un teléfono basura (descarta, no llama a captureLead)", async () => {
    contactFindFirst.mockResolvedValue(null);
    const result = await handleInboundMessage({
      ...wa, senderId: "MX.nuevo-sin-telefono", senderIdIsPhone: false, whatsappUserId: "MX.nuevo-sin-telefono",
    });
    expect(captureLead).not.toHaveBeenCalled();
    expect(msgCreate).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("mensaje sin teléfono y sin BSUID (caso límite): ni siquiera consulta — nada con qué buscar", async () => {
    const result = await handleInboundMessage({
      ...wa, senderId: "desconocido", senderIdIsPhone: false, whatsappUserId: null,
    });
    expect(contactFindFirst).not.toHaveBeenCalled();
    expect(captureLead).not.toHaveBeenCalled();
    expect(result).toBeNull();
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
// escalateToHuman lo dejaba en HUMAN con controlledById null y sin aviso (eso último
// lo cerró la #858; el reparto de aquí sigue siendo lo que le da dueño).
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
    expect(autoRouteLead).toHaveBeenCalledWith("c1", { reason: "primer reply de comentario", connectorId: null });
  });

  it("CON dueño no se re-enruta (aunque conserve la marca de origen)", async () => {
    contactFindFirst.mockResolvedValue({ ...provisional, assignedToId: "u1" });
    await handleInboundMessage(base);
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  // #748 (2026-10-14): hasta aquí, sin la marca de comentario NO se enrutaba, con la idea de
  // que un contacto sin dueño y sin marca era uno que un gerente había desasignado. En
  // producción no era así: de los 29 contactos vivos sin dueño, ninguno tiene un cambio de
  // asesor en la cronología — nacieron sin dueño y ningún mensaje posterior los volvía a
  // repartir. Lo que protege la decisión de un gerente ahora es que haya TENIDO dueño
  // (FIRST_TOUCH o cambio de asesor registrado), no la marca de origen.
  it("sin dueño y SIN marca, que nunca tuvo dueño → también se enruta (#748)", async () => {
    contactFindFirst.mockResolvedValue({ ...provisional, leadSourceDetail: null });
    await handleInboundMessage(base);
    expect(autoRouteLead).toHaveBeenCalledWith("c1", { reason: "INSTAGRAM de un contacto sin dueño", connectorId: null });
  });

  it("sin dueño y desasignado a mano (hay cambio de asesor en la cronología) NO se enruta", async () => {
    contactFindFirst.mockResolvedValue({ ...provisional, leadSourceDetail: "web:landing-tulum" });
    fieldChangeFindFirst.mockResolvedValue({ id: "rfc-1" });
    await handleInboundMessage(base);
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

// El guard: un contacto que ya tuvo dueño y hoy no lo tiene es decisión de alguien
// (desasignación desde el Inbox), y su siguiente mensaje no se la deshace. Antes esto era el
// tercer tramo de un guard que además exigía la marca de comentario; desde la #748 es el
// único, y mira dos pruebas: un FIRST_TOUCH (lo dejó el reparto) o un cambio de
// `assignedToId` en la cronología (lo deja también la asignación manual, que no crea timer).
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
    expect(fieldChangeFindFirst).not.toHaveBeenCalled(); // con el timer basta
  });

  // La asignación manual (lib/inbox/assign.ts) no crea FIRST_TOUCH: sin mirar la cronología,
  // un contacto asignado y desasignado a mano se volvería a repartir con su siguiente mensaje.
  it("tuvo dueño según la cronología (asignado a mano, sin timer) → NO se re-enruta", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    fieldChangeFindFirst.mockResolvedValue({ id: "rfc-1" });
    await handleInboundMessage(base);
    expect(autoRouteLead).not.toHaveBeenCalled();
    expect(fieldChangeFindFirst).toHaveBeenCalledWith({
      where: { entityType: "contact", entityId: "c1", field: "assignedToId" },
      select: { id: true },
    });
  });

  it("si la cronología no se puede leer, no se reparte esta vez (se reintenta en el siguiente mensaje)", async () => {
    contactFindFirst.mockResolvedValue(provisional);
    fieldChangeFindFirst.mockRejectedValue(new Error("db caída"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handleInboundMessage(base)).resolves.toBeTruthy();
    expect(autoRouteLead).not.toHaveBeenCalled();
    error.mockRestore();
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

  // Las consultas son el tramo caro: con dueño no corre ninguna (el caso común no paga nada).
  it("no consulta timers ni cronología si el contacto ya tiene dueño", async () => {
    contactFindFirst.mockResolvedValue({ ...provisional, assignedToId: "u1" });
    await handleInboundMessage(base);
    expect(slaTimerFindFirst).not.toHaveBeenCalled();
    expect(fieldChangeFindFirst).not.toHaveBeenCalled();
  });
});

/**
 * #653 — la señal de vida del conector.
 *
 * Antes de esto, `lastLeadAt` y `errorCount` solo los escribía `processIncomingLead`,
 * la vía de los formularios de anuncio. Los prospectos que entran por DM —hoy la única
 * vía viva de INSTAGRAM/MESSENGER— no tocaban ninguno de los dos, así que un conector
 * caído se veía exactamente igual que uno sano en crm_pulso: en cero y sin errores.
 */
describe("señal de vida del conector en el intake de DM", () => {
  const conBoton = { ...base, connectorId: "conn_ig" };

  it("contacto NUEVO con conector → sella lastLeadAt", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(conBoton);
    expect(captureLead).toHaveBeenCalledWith(expect.any(Object), { connectorId: "conn_ig" });
    const marca = leadConnectorUpdate.mock.calls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data.lastLeadAt instanceof Date,
    );
    expect(marca?.[0]).toMatchObject({ where: { id: "conn_ig" } });
  });

  // El caso que la tarjeta llama «el conector que solo recibe de gente ya registrada».
  // Si la marca dependiera del alta de contacto, este conector envejecería como si
  // estuviera caído aunque estuviera entregando todos los días.
  it("contacto CONOCIDO con conector → también sella lastLeadAt", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(conBoton);
    expect(captureLead).not.toHaveBeenCalled();
    expect(leadConnectorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conn_ig" } }),
    );
  });

  it("sin conector resuelto → no escribe en ninguno", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(leadConnectorUpdate).not.toHaveBeenCalled();
  });

  it("captura fallida → incrementa el contador de errores del conector", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: null, isNew: false, assignedToId: null, error: "telefono invalido" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await handleInboundMessage(conBoton);
    expect(r).toBeNull();
    expect(leadConnectorUpdate).toHaveBeenCalledWith({
      where: { id: "conn_ig" },
      data: { errorCount: { increment: 1 }, lastError: "telefono invalido" },
    });
    warn.mockRestore();
  });

  // Best-effort de verdad: si la marca no se puede escribir, el mensaje ya persistido
  // no se pierde. Lo contrario sería cambiar un hueco de monitoreo por uno de datos.
  it("si la marca falla, la ingesta sigue", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    leadConnectorUpdate.mockRejectedValue(new Error("db caída"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleInboundMessage(conBoton);
    expect(r).toEqual({ id: "m1" });
    err.mockRestore();
  });
});

// Seguimiento de marcas (2026-10-09, spec marcas-agente §4.1): la fila de contact_brands solo se
// registraba dentro de captureLead, o sea al ALTA de un contacto. Un contacto que ya existía y
// escribía por WhatsApp / IG / Messenger a una cuenta con marca nunca quedaba atribuido a esa
// marca. handleInboundMessage ahora la registra también para el contacto existente. Todo es
// best-effort: la atribución jamás debe romper la entrada del mensaje.
describe("handleInboundMessage — marca de la cuenta para un contacto que ya existía", () => {
  const conBoton = { ...base, connectorId: "conn_ig" };
  const conocido = { id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" };

  beforeEach(() => {
    contactFindFirst.mockResolvedValue(conocido);
    leadConnectorFindUnique.mockResolvedValue({ brandId: "b-yax" });
    getDefaultBrandId.mockResolvedValue("b-def");
    attachBrand.mockResolvedValue(undefined);
  });

  it("cuenta con marca → attachBrand con el brandId de la cuenta y contactIsNew:false", async () => {
    await handleInboundMessage(conBoton);
    expect(leadConnectorFindUnique).toHaveBeenCalledWith({ where: { id: "conn_ig" }, select: { brandId: true } });
    expect(attachBrand).toHaveBeenCalledTimes(1);
    expect(attachBrand).toHaveBeenCalledWith({
      contactId: "c1",
      brandId: "b-yax",
      connectorId: "conn_ig",
      contactIsNew: false,
    });
    expect(getDefaultBrandId).not.toHaveBeenCalled();
  });

  it("cuenta SIN marca → se atribuye a la predeterminada", async () => {
    leadConnectorFindUnique.mockResolvedValue({ brandId: null });
    await handleInboundMessage(conBoton);
    expect(attachBrand).toHaveBeenCalledWith({
      contactId: "c1",
      brandId: "b-def",
      connectorId: "conn_ig",
      contactIsNew: false,
    });
  });

  it("cuenta inexistente (findUnique → null) → también la predeterminada", async () => {
    leadConnectorFindUnique.mockResolvedValue(null);
    await handleInboundMessage(conBoton);
    expect(attachBrand).toHaveBeenCalledWith(expect.objectContaining({ brandId: "b-def", contactIsNew: false }));
  });

  it("cuenta sin marca y sin predeterminada → no atribuye (no hay a qué marca)", async () => {
    leadConnectorFindUnique.mockResolvedValue({ brandId: null });
    getDefaultBrandId.mockResolvedValue(null);
    await handleInboundMessage(conBoton);
    expect(attachBrand).not.toHaveBeenCalled();
  });

  it("sin connectorId → no lee la cuenta ni atribuye", async () => {
    await handleInboundMessage(base);
    expect(leadConnectorFindUnique).not.toHaveBeenCalled();
    expect(attachBrand).not.toHaveBeenCalled();
  });

  // Un eco es un saliente del equipo, no una entrada del cliente a la cuenta: no atribuye.
  it("un eco → no atribuye", async () => {
    msgFindUnique.mockResolvedValue(null);
    await handleInboundMessage(echo);
    expect(leadConnectorFindUnique).not.toHaveBeenCalled();
    expect(attachBrand).not.toHaveBeenCalled();
  });

  // captureLead ya atribuye al contacto (nuevo o deduplicado) cuando recibe el connectorId:
  // hacerlo otra vez aquí sería una segunda atribución del mismo mensaje.
  it("contacto NUEVO vía captureLead → no se atribuye una segunda vez", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(conBoton);
    expect(captureLead).toHaveBeenCalledWith(expect.any(Object), { connectorId: "conn_ig" });
    expect(leadConnectorFindUnique).not.toHaveBeenCalled();
    expect(attachBrand).not.toHaveBeenCalled();
  });

  it("si falla la lectura de la cuenta → el mensaje se ingiere igual y se registra el error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    leadConnectorFindUnique.mockRejectedValue(new Error("db caída"));
    const r = await handleInboundMessage(conBoton);
    expect(r).toEqual({ id: "m1" });
    expect(attachBrand).not.toHaveBeenCalled();
    expect(msgCreate).toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[messaging]"), expect.any(Error));
    err.mockRestore();
  });

  it("si attachBrand lanza → el mensaje se ingiere igual y se registra el error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    attachBrand.mockRejectedValue(new Error("x"));
    const r = await handleInboundMessage(conBoton);
    expect(r).toEqual({ id: "m1" });
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[messaging]"), expect.any(Error));
    err.mockRestore();
  });

  // Reentrega del webhook: el mensaje ya estaba persistido y el camino corto no debe tocar nada más.
  it("reentrega (P2002) → no vuelve a atribuir", async () => {
    msgCreate.mockRejectedValueOnce({ code: "P2002" });
    msgFindUnique.mockResolvedValue({ id: "m-existing" });
    const r = await handleInboundMessage(conBoton);
    expect(r).toEqual({ id: "m-existing" });
    expect(attachBrand).not.toHaveBeenCalled();
  });
});

// #702: el mensaje con el que el propio lead se presenta NO prueba que lo hayamos
// atendido. Los 8 unicos FIRST_TOUCH que el CRM ha registrado como cumplidos se cerraron
// entre 1.53 s y 1.87 s: los cerraba este inbound, dentro del mismo request que los creo.
// El complemento de estos dos casos es el test del eco ("echo SI marca SLA…"): un eco es
// un SALIENTE del equipo y ese si cumple.
describe("handleInboundMessage — el inbound del lead NO cumple el SLA (#702)", () => {
  it("DM entrante de un desconocido: no cierra ningun timer", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(base);
    expect(meetSlaTimers).not.toHaveBeenCalled();
  });

  it("DM entrante de un contacto ya conocido: tampoco", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(meetSlaTimers).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Desempate BSUID vs teléfono.
//
// #827 dejó la búsqueda como un solo `findFirst` con `OR: [teléfono, BSUID]`. Eso
// resuelve el caso normal, pero cuando los dos identificadores apuntan a contactos
// DISTINTOS —un duplicado que ya existía— `findFirst` sin `orderBy` devuelve una
// fila ARBITRARIA: el mismo remitente puede caer hoy en un contacto y mañana en el
// otro, y el hilo del cliente queda partido sin que nadie se entere.
//
// Decisión de Luis (2026-10-01): **gana el BSUID**. Meta lo garantiza estable por
// persona; un teléfono se recicla y puede acabar en manos de otra. Y NUNCA se
// fusiona solo: la fusión es decisión humana en /duplicados (regla de oro de
// lib/contacts/duplicate-alert.ts).
// ---------------------------------------------------------------------------
describe("handleInboundMessage — desempate BSUID vs teléfono (WhatsApp)", () => {
  const BSUID = "MX.13491208655302741918";
  const TEL = "+5219981234567";
  const wa = {
    channel: "WHATSAPP" as const,
    senderId: TEL,
    externalMessageId: "wamid-desempate",
    text: "hola",
    whatsappUserId: BSUID,
  };

  function contacto(id: string, whatsappUserId: string | null) {
    return { id, assignedToId: "u1", firstName: "A", lastName: "B", custom: {}, phone: TEL, whatsappUserId };
  }

  it("🚨 con dos contactos candidatos, gana el del BSUID", async () => {
    // El del teléfono va PRIMERO en la lista a propósito: si el código se quedara
    // con el primero que devuelve la base, este test lo caza.
    contactFindFirst.mockImplementation(async ({ where }) =>
      where.whatsappUserId ? contacto("c-bsuid", BSUID) : contacto("c-telefono", null),
    );

    await handleInboundMessage(wa);

    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: "c-bsuid" }) }),
    );
  });

  it("🚨 avisa del conflicto para que se revise a mano", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    contactFindFirst.mockImplementation(async ({ where }) =>
      where.whatsappUserId ? contacto("c-bsuid", BSUID) : contacto("c-telefono", null),
    );

    await handleInboundMessage(wa);

    const avisos = warn.mock.calls.flat().join(" ");
    expect(avisos).toContain("c-telefono");
    expect(avisos).toContain("c-bsuid");
    warn.mockRestore();
  });

  it("🚨 NO fusiona nada: la fusión es decisión humana", async () => {
    contactFindFirst.mockImplementation(async ({ where }) =>
      where.whatsappUserId ? contacto("c-bsuid", BSUID) : contacto("c-telefono", null),
    );

    await handleInboundMessage(wa);

    for (const [arg] of [...contactUpdate.mock.calls, ...contactTxUpdate.mock.calls]) {
      expect((arg as { data: Record<string, unknown> }).data).not.toHaveProperty("mergedIntoId");
    }
  });

  it("con un solo candidato se comporta igual que antes", async () => {
    contactFindFirst.mockResolvedValue(contacto("c-unico", null));

    await handleInboundMessage(wa);

    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: "c-unico" }) }),
    );
  });

  it("sin candidatos sigue el camino de alta (no inventa contacto)", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c-nuevo", isNew: true, assignedToId: "u1" });

    await handleInboundMessage(wa);

    expect(captureLead).toHaveBeenCalled();
  });
});

// 2026-10-10: un cliente real llegó por un anuncio de Messenger con formulario y se
// quedó como "Messenger (por identificar)" sin teléfono ni correo, aunque el primer
// DM traía todo el formulario como texto.
describe("handleInboundMessage — resumen de formulario de anuncio", () => {
  const RESUMEN = [
    "¡Hola! Completé el formulario y me gustaría obtener más información sobre el negocio.",
    "¿Cuál es tu esquema de pago?: Recurso propio",
    "Last name: Melendez",
    "Phone number: 55 5453 3990",
    "First name: Yanush",
    "Email: someone@example.com",
  ].join("\n");
  const msgMs = {
    channel: "MESSENGER" as const,
    senderId: "PSID-7",
    externalMessageId: "mid-form",
    text: RESUMEN,
    connectorId: "conn-nativa",
  };
  const PLACEHOLDER = {
    id: "c1",
    assignedToId: "u1",
    firstName: "Messenger",
    lastName: "(por identificar)",
    phone: "",
    email: null,
    custom: {},
  };

  beforeEach(() => {
    detectDuplicatesForContact.mockReset();
    detectDuplicatesForContact.mockResolvedValue(undefined);
  });

  it("contacto nuevo con placeholder: llena nombre, apellido, teléfono E.164 y correo", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    contactFindUnique.mockResolvedValue(PLACEHOLDER);
    contactTxUpdate.mockResolvedValue({
      ...PLACEHOLDER,
      firstName: "Yanush",
      lastName: "Melendez",
      phone: "+525554533990",
      email: "someone@example.com",
      assignedTo: null,
    });

    await handleInboundMessage(msgMs);

    expect(withChangeSourceSpy).toHaveBeenCalledWith({ source: "lead_form_summary" });
    expect(contactTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: {
          firstName: "Yanush",
          lastName: "Melendez",
          phone: "+525554533990",
          email: "someone@example.com",
        },
      })
    );
    expect(detectDuplicatesForContact).toHaveBeenCalledWith("c1");
    // la actividad ya sale con el nombre del cliente
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subject: expect.stringContaining("Yanush Melendez") }) })
    );
  });

  it("contacto existente con datos reales: no se toca nada", async () => {
    contactFindFirst.mockResolvedValue({
      ...PLACEHOLDER,
      firstName: "Juan",
      lastName: "Pérez",
      phone: "+529981112233",
      email: "juan@x.com",
    });

    await handleInboundMessage(msgMs);

    expect(contactTxUpdate).not.toHaveBeenCalled();
    expect(detectDuplicatesForContact).not.toHaveBeenCalled();
  });

  it("solo llena lo que falta: nombre real del perfil se respeta", async () => {
    contactFindFirst.mockResolvedValue({ ...PLACEHOLDER, firstName: "Yanu" });
    contactTxUpdate.mockResolvedValue({ ...PLACEHOLDER, firstName: "Yanu", lastName: "Melendez", assignedTo: null });

    await handleInboundMessage(msgMs);

    const call = contactTxUpdate.mock.calls.find((c) => c[0].data.lastName === "Melendez");
    expect(call?.[0].data).toEqual({ lastName: "Melendez", phone: "+525554533990", email: "someone@example.com" });
  });

  it("WhatsApp no pasa por aquí (el teléfono ya es la identidad del canal)", async () => {
    contactFindFirst.mockResolvedValue({ ...PLACEHOLDER, firstName: "WhatsApp" });
    await handleInboundMessage({ ...msgMs, channel: "WHATSAPP", senderId: "+529981234567" });
    expect(withChangeSourceSpy).not.toHaveBeenCalledWith({ source: "lead_form_summary" });
  });

  it("si la escritura falla, la ingesta y el bot siguen", async () => {
    contactFindFirst.mockResolvedValue(PLACEHOLDER);
    contactTxUpdate.mockRejectedValue(new Error("db caída"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await handleInboundMessage(msgMs);

    expect(msgCreate).toHaveBeenCalled();
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "MESSENGER" });
    warnSpy.mockRestore();
  });
});

// #858 (2026-10-14): la rama HUMAN solo avisaba a `controlledById ?? assignedToId`. Con los dos
// en null (el bot escaló un contacto sin asesor, o alguien contestó desde Business Suite y el
// eco dejó el hilo en HUMAN sin dueño) cada mensaje nuevo del cliente caía en el vacío. Caso
// real: conversación 9c1379d8, dos mensajes del valuador de BBVA después del escalamiento y
// cero avisos.
describe("handleInboundMessage — inbound en un hilo HUMAN sin dueño (#858)", () => {
  const sinDueno = { id: "c1", assignedToId: null, firstName: "Valuador", lastName: "BBVA", targetPlaza: "PDC" };
  const hiloHumanSinDueno = { id: "conv1", status: "HUMAN", botEnabled: true, controlledById: null, connectorId: "conn_ms" };

  beforeEach(() => {
    convFindFirst.mockResolvedValue(hiloHumanSinDueno);
    convUpdate.mockResolvedValue(hiloHumanSinDueno);
    // El reparto (si corre) no encuentra a nadie: el contacto sigue sin dueño.
    autoRouteLead.mockResolvedValue(null);
  });

  it("sin controlledById ni asesor → avisa por el camino de hilo sin dueño, con la cuenta del hilo y la plaza", async () => {
    contactFindFirst.mockResolvedValue(sinDueno);
    await handleInboundMessage({ ...base, text: "¿Me confirman la visita del valuador?" });

    expect(notifCreate).not.toHaveBeenCalled();
    expect(avisarHiloSinDueno).toHaveBeenCalledTimes(1);
    const arg = avisarHiloSinDueno.mock.calls[0][0];
    expect(arg).toEqual(
      expect.objectContaining({ conversationId: "conv1", connectorId: "conn_ms", plaza: "PDC", type: "social_inbound" }),
    );
    expect(arg.message).toContain("Valuador BBVA");
    expect(arg.message).toContain("valuador");
  });

  it("el bot no contesta en un hilo HUMAN (no cambia)", async () => {
    contactFindFirst.mockResolvedValue(sinDueno);
    await handleInboundMessage(base);
    expect(botRespond).not.toHaveBeenCalled();
  });

  it("si el aviso truena, la ingesta sigue", async () => {
    contactFindFirst.mockResolvedValue(sinDueno);
    avisarHiloSinDueno.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handleInboundMessage(base)).resolves.toEqual({ id: "m1" });
    error.mockRestore();
  });

  it("con controlledById → aviso de siempre a quien controla el hilo, sin camino nuevo", async () => {
    contactFindFirst.mockResolvedValue(sinDueno);
    convUpdate.mockResolvedValue({ ...hiloHumanSinDueno, controlledById: "u-control" });
    await handleInboundMessage(base);
    expect(notifCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u-control", title: "INSTAGRAM recibido (controlas el hilo)", link: "/inbox?c=conv1" }),
      }),
    );
    expect(avisarHiloSinDueno).not.toHaveBeenCalled();
  });

  it("con asesor (sin controlledById) → aviso de siempre al asesor, sin camino nuevo", async () => {
    contactFindFirst.mockResolvedValue({ ...sinDueno, assignedToId: "u-asesor" });
    await handleInboundMessage(base);
    expect(notifCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u-asesor" }) }),
    );
    expect(avisarHiloSinDueno).not.toHaveBeenCalled();
  });

  it("hilo en BOT → ni aviso nuevo ni de siempre (contesta el bot)", async () => {
    contactFindFirst.mockResolvedValue(sinDueno);
    convUpdate.mockResolvedValue({ ...hiloHumanSinDueno, status: "BOT" });
    await handleInboundMessage(base);
    expect(avisarHiloSinDueno).not.toHaveBeenCalled();
    expect(botRespond).toHaveBeenCalled();
  });
});

// #748 (2026-10-14): los contactos que llegan por mensaje directo quedaban sin dueño. El alta
// SÍ pasaba por el reparto (captureLead → autoRouteLead: hay `lead.orphaned` con reason
// «intake MESSENGER/WHATSAPP» en producción), pero un contacto que ya existía sin dueño no
// se volvía a repartir nunca: el reintento solo cubría a los que nacieron de un comentario.
// Ahora cualquier contacto sin dueño que escribe se reparte con el MISMO reparto de los
// anuncios (plaza, exclusiones, turno, Pond, marca), con la cuenta del mensaje.
describe("handleInboundMessage — reparto del mensaje directo (#748)", () => {
  const sinDueno = { id: "c1", assignedToId: null, firstName: "Ana", lastName: "P", leadSourceDetail: null };

  it("contacto existente sin dueño → se reparte, con la cuenta del mensaje (de ahí sale la marca)", async () => {
    contactFindFirst.mockResolvedValue(sinDueno);
    await handleInboundMessage({ ...base, connectorId: "conn_ig" });
    expect(autoRouteLead).toHaveBeenCalledTimes(1);
    expect(autoRouteLead).toHaveBeenCalledWith("c1", { reason: "INSTAGRAM de un contacto sin dueño", connectorId: "conn_ig" });
  });

  it("el dueño que le da el reparto es el que usa el bot después (el hilo no queda sin dueño)", async () => {
    contactFindFirst.mockResolvedValue(sinDueno);
    autoRouteLead.mockResolvedValue("u-nuevo");
    await handleInboundMessage({ ...base, connectorId: "conn_ig" });
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
    expect(autoRouteLead.mock.invocationCallOrder[0]).toBeLessThan(botRespond.mock.invocationCallOrder[0]);
  });

  it("contacto CON dueño → no se toca: ni reparto ni consultas", async () => {
    contactFindFirst.mockResolvedValue({ ...sinDueno, assignedToId: "u-asesor" });
    await handleInboundMessage({ ...base, connectorId: "conn_ig" });
    expect(autoRouteLead).not.toHaveBeenCalled();
    expect(slaTimerFindFirst).not.toHaveBeenCalled();
  });

  it("contacto NUEVO: lo reparte captureLead con la cuenta, y aquí no se reparte otra vez aunque siga sin dueño", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: null });
    contactFindUnique.mockResolvedValue(sinDueno);
    await handleInboundMessage({ ...base, connectorId: "conn_ig" });
    expect(captureLead).toHaveBeenCalledWith(expect.anything(), { connectorId: "conn_ig" });
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  it("captureLead encontró un contacto que ya existía sin dueño (dedup por otro dato) → aquí sí se reparte", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: false, assignedToId: null });
    contactFindUnique.mockResolvedValue(sinDueno);
    await handleInboundMessage({ ...base, connectorId: "conn_ig" });
    expect(autoRouteLead).toHaveBeenCalledTimes(1);
  });

  it("WhatsApp al número general (sin cuenta) → se reparte con connectorId null: marca predeterminada, Pond de siempre", async () => {
    contactFindFirst.mockResolvedValue({ ...sinDueno, whatsappOptOut: false });
    await handleInboundMessage({ ...base, channel: "WHATSAPP", senderId: "+5219981234567" });
    expect(autoRouteLead).toHaveBeenCalledWith("c1", { reason: "WHATSAPP de un contacto sin dueño", connectorId: null });
  });

  describe("cuenta no registrada (route:false: cuentaSinConector / unknownNumber)", () => {
    it("alta nueva → captureLead con skipRouting", async () => {
      contactFindFirst.mockResolvedValue(null);
      captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: null });
      contactFindUnique.mockResolvedValue(sinDueno);
      await handleInboundMessage(base, { triggerBot: false, route: false });
      expect(captureLead).toHaveBeenCalledWith(expect.anything(), { connectorId: undefined, skipRouting: true });
      expect(autoRouteLead).not.toHaveBeenCalled();
    });

    it("contacto existente sin dueño → tampoco se reparte, ni se consultan sus timers", async () => {
      contactFindFirst.mockResolvedValue(sinDueno);
      await handleInboundMessage(base, { triggerBot: false, route: false });
      expect(autoRouteLead).not.toHaveBeenCalled();
      expect(slaTimerFindFirst).not.toHaveBeenCalled();
    });

    it("el mensaje se ingiere igual", async () => {
      contactFindFirst.mockResolvedValue(sinDueno);
      await expect(handleInboundMessage(base, { triggerBot: false, route: false })).resolves.toEqual({ id: "m1" });
      expect(msgCreate).toHaveBeenCalled();
    });
  });

  it("un eco nunca reparte (lo mandó la Página, no el lead)", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue(sinDueno);
    await handleInboundMessage({ ...base, isEcho: true, connectorId: "conn_ig" });
    expect(autoRouteLead).not.toHaveBeenCalled();
    expect(captureLead).not.toHaveBeenCalled();
  });
});

// Ecos de la app de WhatsApp Business en coexistencia (2026-10-14): llegan por el mismo
// handleEchoMessage que los de IG/Messenger, con dos diferencias que se fijan aquí — lo que el CRM
// manda por WhatsApp guarda su wamid en `twilioSid` (no en `externalMessageId`), y el eco puede
// traer media ya resuelta.
describe("handleInboundMessage — ecos de WhatsApp (coexistencia)", () => {
  const waEcho = {
    channel: "WHATSAPP" as const,
    senderId: "+529981234567",
    senderIdIsPhone: true,
    externalMessageId: "wamid.ECO1",
    text: "[Imagen] plano",
    isEcho: true,
    connectorId: "conn-yax",
    mediaUrl: "chat-media/x.jpg",
    mediaType: "image",
    mediaMimeType: "image/jpeg",
  };

  it("eco de algo que mandó el propio CRM (wamid en twilioSid) → skip total", async () => {
    msgFindUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) =>
      where.twilioSid === "wamid.ECO1" ? { id: "m-crm" } : null,
    );
    const r = await handleInboundMessage(waEcho);
    expect(r).toEqual({ id: "m-crm" });
    expect(msgCreate).not.toHaveBeenCalled();
    expect(contactFindFirst).not.toHaveBeenCalled();
  });

  it("eco con contacto → saliente de asesor en la cuenta del número, con su media", async () => {
    msgFindUnique.mockResolvedValue(null);
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(waEcho);
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: "WHATSAPP",
          direction: "OUTBOUND",
          sender: "ADVISOR",
          externalMessageId: "wamid.ECO1",
          mediaUrl: "chat-media/x.jpg",
          mediaType: "image",
          mediaMimeType: "image/jpeg",
        }),
      }),
    );
    // Lo escribió una persona desde el teléfono: el bot suelta el hilo.
    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "HUMAN" }) }));
    expect(captureLead).not.toHaveBeenCalled();
  });
});

// WhatsApp de un asesor (2026-10-14, PR 2): con createContact:false, un remitente que no es
// contacto NUNCA se da de alta, aunque haya desaparecido entre la búsqueda del filtro y este punto.
describe("handleInboundMessage — createContact:false", () => {
  const waIn = {
    channel: "WHATSAPP" as const,
    senderId: "+525550001111",
    senderIdIsPhone: true,
    externalMessageId: "wamid.PRIV",
    text: "algo personal",
    connectorId: "conn-ana",
  };

  it("🚨 sin contacto → null, sin captureLead, sin mensaje ni conversación", async () => {
    contactFindFirst.mockResolvedValue(null);
    const r = await handleInboundMessage(waIn, { triggerBot: false, route: false, createContact: false });
    expect(r).toBeNull();
    expect(captureLead).not.toHaveBeenCalled();
    expect(msgCreate).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("con contacto → se guarda como siempre", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u-ana", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage(waIn, { triggerBot: false, route: false, createContact: false });
    expect(msgCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ direction: "INBOUND", externalMessageId: "wamid.PRIV" }) }));
    expect(botRespond).not.toHaveBeenCalled();
  });
});
