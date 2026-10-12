// messaging_policy_enforcement (2026-10-12): el aviso de Meta cuando bloquea o advierte a una
// Página por sus políticas. El parser es puro; el manejador marca las cuentas y avisa a los
// admins, best-effort.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const connectorFindMany = vi.fn();
const userFindMany = vi.fn();
const notificationCreateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { findMany: (...a: unknown[]) => connectorFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    notification: { createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));
const markConnectorLead = vi.fn();
vi.mock("@/lib/intake/connectors", () => ({
  markConnectorLead: (...a: unknown[]) => markConnectorLead(...a),
}));

import {
  parsePolicyEnforcement,
  policyEnforcementError,
  handlePolicyEnforcement,
} from "./policy-enforcement";
import { parseMessengerWebhook } from "./adapters/messenger";

/** El evento tal como lo documenta Meta: sin `sender`, con la Página en `recipient`. */
function webhook(policy: Record<string, unknown>, pageId = "PAGE-1") {
  return {
    object: "page",
    entry: [{ id: pageId, time: 1458692752478, messaging: [
      { recipient: { id: pageId }, timestamp: 1458692752478, policy_enforcement: policy },
    ] }],
  };
}

describe("parsePolicyEnforcement", () => {
  it("lee un block con su motivo", () => {
    expect(parsePolicyEnforcement(webhook({ action: "block", reason: "spam" }))).toEqual([
      { pageId: "PAGE-1", action: "block", reason: "spam" },
    ]);
  });

  it("lee un warning", () => {
    expect(parsePolicyEnforcement(webhook({ action: "warning", reason: "respuestas lentas" }))).toEqual([
      { pageId: "PAGE-1", action: "warning", reason: "respuestas lentas" },
    ]);
  });

  it("un unblock no trae motivo: reason null", () => {
    expect(parsePolicyEnforcement(webhook({ action: "unblock" }))).toEqual([
      { pageId: "PAGE-1", action: "unblock", reason: null },
    ]);
  });

  it("acepta también la forma con guion de la documentación vieja", () => {
    const body = {
      object: "page",
      entry: [{ id: "PAGE-1", messaging: [{ recipient: { id: "PAGE-1" }, "policy-enforcement": { action: "block", reason: "x" } }] }],
    };
    expect(parsePolicyEnforcement(body)).toEqual([{ pageId: "PAGE-1", action: "block", reason: "x" }]);
  });

  it("sin recipient usa entry.id como la Página", () => {
    const body = { object: "page", entry: [{ id: "PAGE-9", messaging: [{ policy_enforcement: { action: "block", reason: "x" } }] }] };
    expect(parsePolicyEnforcement(body)).toEqual([{ pageId: "PAGE-9", action: "block", reason: "x" }]);
  });

  it("un pageId numérico se normaliza a texto", () => {
    const body = { object: "page", entry: [{ messaging: [{ recipient: { id: 103981 }, policy_enforcement: { action: "warning", reason: "x" } }] }] };
    expect(parsePolicyEnforcement(body)[0].pageId).toBe("103981");
  });

  it("varios eventos y entradas en un mismo webhook", () => {
    const body = {
      object: "page",
      entry: [
        { id: "P1", messaging: [{ recipient: { id: "P1" }, policy_enforcement: { action: "warning", reason: "a" } }] },
        { id: "P2", messaging: [
          { sender: { id: "PSID" }, recipient: { id: "P2" }, message: { mid: "m1", text: "hola" } },
          { recipient: { id: "P2" }, policy_enforcement: { action: "block", reason: "b" } },
        ] },
      ],
    };
    expect(parsePolicyEnforcement(body)).toEqual([
      { pageId: "P1", action: "warning", reason: "a" },
      { pageId: "P2", action: "block", reason: "b" },
    ]);
  });

  it("ignora DMs, echoes, comentarios y eventos sin action", () => {
    const body = {
      object: "page",
      entry: [{
        id: "P1",
        messaging: [
          { sender: { id: "PSID" }, recipient: { id: "P1" }, message: { mid: "m1", text: "hola" } },
          { sender: { id: "P1" }, recipient: { id: "PSID" }, message: { mid: "m2", text: "eco", is_echo: true } },
          { recipient: { id: "P1" }, policy_enforcement: { reason: "sin action" } },
        ],
        changes: [{ field: "feed", value: { item: "comment", verb: "add" } }],
      }],
    };
    expect(parsePolicyEnforcement(body)).toEqual([]);
  });

  it("solo el objeto page: instagram u otro devuelven []", () => {
    expect(parsePolicyEnforcement({ ...webhook({ action: "block", reason: "x" }), object: "instagram" })).toEqual([]);
  });

  it.each([null, undefined, 42, "texto", {}, { object: "page" }, { object: "page", entry: "x" }])(
    "no revienta con basura: %s",
    (body) => {
      expect(parsePolicyEnforcement(body)).toEqual([]);
    }
  );

  it("parseMessengerWebhook sigue ignorando el evento: nunca llega al inbox", () => {
    expect(parseMessengerWebhook(webhook({ action: "block", reason: "spam" }))).toEqual([]);
    // Aunque algún día viniera con sender, sin message ni postback no hay nada que ingerir.
    const conSender = {
      object: "page",
      entry: [{ id: "PAGE-1", messaging: [
        { sender: { id: "PAGE-1" }, recipient: { id: "PAGE-1" }, policy_enforcement: { action: "block", reason: "x" } },
      ] }],
    };
    expect(parseMessengerWebhook(conSender)).toEqual([]);
  });
});

describe("policyEnforcementError", () => {
  it("el texto de lastError lleva acción y motivo", () => {
    expect(policyEnforcementError({ pageId: "P", action: "block", reason: "spam" })).toBe(
      "Meta policy_enforcement: block — spam"
    );
  });

  it("sin motivo lo dice en vez de dejar el hueco", () => {
    expect(policyEnforcementError({ pageId: "P", action: "unblock", reason: null })).toBe(
      "Meta policy_enforcement: unblock — sin motivo indicado"
    );
  });
});

describe("handlePolicyEnforcement", () => {
  const MESSENGER = { id: "conn-ms", name: "Messenger | DM Nativa Tulum", provider: "MESSENGER", config: { pageId: "PAGE-1" } };
  const INSTAGRAM = { id: "conn-ig", name: "IG - Nativa Tulum", provider: "INSTAGRAM", config: { pageId: "PAGE-1", igBusinessId: "1784" } };
  const OTRA = { id: "conn-otra", name: "Messenger | DM Yaxnah", provider: "MESSENGER", config: { pageId: "PAGE-2" } };

  beforeEach(() => {
    connectorFindMany.mockReset();
    // IG primero a propósito: el nombre del aviso debe salir de la cuenta de Messenger.
    connectorFindMany.mockResolvedValue([INSTAGRAM, OTRA, MESSENGER]);
    userFindMany.mockReset();
    userFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
    notificationCreateMany.mockReset();
    notificationCreateMany.mockResolvedValue({ count: 2 });
    markConnectorLead.mockReset();
    markConnectorLead.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marca errorCount/lastError en las cuentas de Messenger e Instagram de esa Página, y en ninguna otra", async () => {
    await handlePolicyEnforcement({ pageId: "PAGE-1", action: "block", reason: "spam" });

    expect(connectorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: { in: ["MESSENGER", "INSTAGRAM"] }, deletedAt: null } })
    );
    expect(markConnectorLead).toHaveBeenCalledTimes(2);
    expect(markConnectorLead).toHaveBeenCalledWith("conn-ms", "Meta policy_enforcement: block — spam");
    expect(markConnectorLead).toHaveBeenCalledWith("conn-ig", "Meta policy_enforcement: block — spam");
    expect(markConnectorLead).not.toHaveBeenCalledWith("conn-otra", expect.anything());
  });

  it("encuentra la cuenta aunque su pageId esté guardado como número", async () => {
    connectorFindMany.mockResolvedValue([{ ...MESSENGER, config: { pageId: 103981 } }]);
    await handlePolicyEnforcement({ pageId: "103981", action: "warning", reason: "x" });
    expect(markConnectorLead).toHaveBeenCalledWith("conn-ms", "Meta policy_enforcement: warning — x");
  });

  it("avisa a cada ADMIN activo con el nombre de la cuenta y link a /conexiones", async () => {
    await handlePolicyEnforcement({ pageId: "PAGE-1", action: "block", reason: "spam" });

    expect(userFindMany).toHaveBeenCalledWith({
      where: { role: "ADMIN", isActive: true, deletedAt: null },
      select: { id: true },
    });
    expect(notificationCreateMany).toHaveBeenCalledTimes(1);
    const { data } = notificationCreateMany.mock.calls[0][0] as { data: Array<Record<string, string>> };
    expect(data.map((n) => n.userId)).toEqual(["admin-1", "admin-2"]);
    for (const n of data) {
      expect(n.title).toBe("Meta: aviso de políticas en Messenger | DM Nativa Tulum");
      expect(n.link).toBe("/conexiones");
      expect(n.type).toBe("meta_policy_enforcement");
      expect(n.message).toContain("bloqueó");
      expect(n.message).toContain("spam");
      expect(n.message).toContain("IG - Nativa Tulum");
    }
  });

  it("Página que ninguna cuenta usa: no marca nada pero igual avisa, con el id de la Página", async () => {
    await handlePolicyEnforcement({ pageId: "PAGE-X", action: "warning", reason: "x" });

    expect(markConnectorLead).not.toHaveBeenCalled();
    const { data } = notificationCreateMany.mock.calls[0][0] as { data: Array<Record<string, string>> };
    expect(data[0].title).toBe("Meta: aviso de políticas en la Página PAGE-X");
  });

  it("sin ADMIN activo no crea notificaciones (y no revienta)", async () => {
    userFindMany.mockResolvedValue([]);
    await expect(handlePolicyEnforcement({ pageId: "PAGE-1", action: "block", reason: "x" })).resolves.toBeUndefined();
    expect(notificationCreateMany).not.toHaveBeenCalled();
    expect(markConnectorLead).toHaveBeenCalledTimes(2);
  });

  it("🚨 nunca lanza: si la base se cae, lo registra y sigue", async () => {
    connectorFindMany.mockRejectedValue(new Error("db caída"));
    await expect(handlePolicyEnforcement({ pageId: "PAGE-1", action: "block", reason: "x" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("PAGE-1"), expect.any(Error));
  });

  it("nunca lanza tampoco si falla la notificación", async () => {
    notificationCreateMany.mockRejectedValue(new Error("FK"));
    await expect(handlePolicyEnforcement({ pageId: "PAGE-1", action: "block", reason: "x" })).resolves.toBeUndefined();
    // Las cuentas ya quedaron marcadas antes del fallo.
    expect(markConnectorLead).toHaveBeenCalledTimes(2);
  });
});
