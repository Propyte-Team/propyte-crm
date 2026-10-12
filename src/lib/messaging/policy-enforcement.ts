// Avisos de políticas de Meta: el campo `messaging_policy_enforcement` (2026-10-12).
//
// Por qué existe: cuando Meta bloquea o advierte a una Página por violar las políticas de
// Messenger, el bot deja de poder contestar y, sin este campo, eso se ve IGUAL que un día
// sin mensajes: nada falla de nuestro lado, simplemente no pasa nada. Meta recomienda
// suscribir las Páginas a este campo justo para enterarse; aquí se convierte en algo que el
// CRM muestra.
//
// Forma del evento (objeto `page`, dentro de entry[].messaging[], SIN `sender`):
//   { recipient: { id: PAGE_ID }, timestamp, policy_enforcement: { action, reason } }
// `action` es "warning", "block" o "unblock"; `reason` no viene en "unblock".
//
// parseMessengerWebhook ya lo ignora (sin sender ni message no hay nada que ingerir), así
// que este evento nunca llega al inbox: se lee aparte con parsePolicyEnforcement.
import prisma from "@/lib/db";

export interface PolicyEnforcementEvent {
  pageId: string;
  /** "warning" | "block" | "unblock" según Meta; se conserva tal cual si un día manda otro. */
  action: string;
  /** Ausente en "unblock". */
  reason: string | null;
}

interface RawPolicy {
  action?: unknown;
  reason?: unknown;
}

interface RawMessaging {
  recipient?: { id?: unknown };
  policy_enforcement?: RawPolicy;
  // Versiones viejas de la documentación de Messenger lo escribían con guion. No cuesta
  // nada aceptar las dos y así un cambio de forma no nos deja ciegos otra vez.
  "policy-enforcement"?: RawPolicy;
}

function texto(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

/**
 * Los avisos de políticas de un webhook `object: "page"`. Pura: no toca base ni red, y
 * cualquier otra cosa (DMs, echoes, comentarios, otro objeto) devuelve [].
 */
export function parsePolicyEnforcement(body: unknown): PolicyEnforcementEvent[] {
  if (!body || typeof body !== "object") return [];
  const b = body as { object?: unknown; entry?: unknown };
  if (b.object !== "page" || !Array.isArray(b.entry)) return [];

  const out: PolicyEnforcementEvent[] = [];
  for (const entry of b.entry as Array<{ id?: unknown; messaging?: unknown }>) {
    if (!entry || !Array.isArray(entry.messaging)) continue;
    for (const ev of entry.messaging as RawMessaging[]) {
      const policy = ev?.policy_enforcement ?? ev?.["policy-enforcement"];
      if (!policy || typeof policy !== "object") continue;
      const action = texto(policy.action);
      // `recipient.id` es la Página; entry.id también lo es y sirve de respaldo.
      const pageId = texto(ev.recipient?.id) ?? texto(entry.id);
      if (!action || !pageId) continue;
      out.push({ pageId, action, reason: texto(policy.reason) });
    }
  }
  return out;
}

/**
 * Texto para `lead_connectors.lastError`: lo que ya lee el monitoreo (`fallos_seguidos` de
 * crm_pulso, la pantalla de conexiones). El prefijo es fijo para poder buscarlo.
 */
export function policyEnforcementError(ev: PolicyEnforcementEvent): string {
  return `Meta policy_enforcement: ${ev.action} — ${ev.reason ?? "sin motivo indicado"}`;
}

const QUE_HIZO: Record<string, string> = {
  block: "bloqueó la mensajería de",
  warning: "mandó una advertencia a",
  unblock: "desbloqueó la mensajería de",
};

function mensajeDelAviso(ev: PolicyEnforcementEvent, cuentas: string[]): string {
  const que = QUE_HIZO[ev.action] ?? `mandó «${ev.action}» a`;
  const motivo = ev.reason ? `: ${ev.reason.slice(0, 500)}` : ".";
  const afectadas = cuentas.length > 0 ? ` Cuentas: ${cuentas.join(", ")}.` : " Ninguna cuenta del CRM usa esa Página.";
  return `Meta ${que} la Página ${ev.pageId} por sus políticas${motivo}${afectadas}`;
}

// String() + trim(): hay cuentas viejas con el pageId guardado como número (mismo criterio
// que connectors/meta-dms.ts), y un filtro JSON `equals` con texto no las encontraría.
function pageIdDe(config: unknown): string {
  return String((config as Record<string, unknown> | null)?.pageId ?? "").trim();
}

/**
 * Deja rastro de un aviso de políticas. Best-effort: NUNCA lanza, porque corre después del
 * 200 junto con el bot y los comentarios.
 *
 * 1. Las cuentas de Messenger E Instagram de esa Página (las dos guardan config.pageId; IG
 *    contesta a través de la Página vinculada) reciben errorCount+1 y lastError, vía
 *    markConnectorLead — el mismo lugar que ya lee el monitoreo, sin tabla nueva. Se marcan
 *    aunque estén en pausa: el aviso es de la Página, no de nuestro estado.
 * 2. Cada ADMIN activo recibe una notificación que lleva a /conexiones.
 *
 * Ojo: el siguiente DM que entre por esa cuenta limpia errorCount/lastError (markConnectorLead
 * sin error en el core). La notificación es lo que queda.
 */
export async function handlePolicyEnforcement(ev: PolicyEnforcementEvent): Promise<void> {
  try {
    // Las cuentas sociales son pocas: se traen todas y se filtra aquí (ver pageIdDe).
    const sociales = await prisma.leadConnector.findMany({
      where: { provider: { in: ["MESSENGER", "INSTAGRAM"] }, deletedAt: null },
      select: { id: true, name: true, provider: true, config: true },
    });
    // Messenger primero: es la cuenta de la Página, y su nombre encabeza el aviso.
    const cuentas = sociales
      .filter((c) => pageIdDe(c.config) === ev.pageId)
      .sort((a, b) => Number(b.provider === "MESSENGER") - Number(a.provider === "MESSENGER"));

    console.warn(
      `[policy-enforcement] Meta ${ev.action} en la Página ${ev.pageId} (${cuentas.length} cuenta(s)): ${ev.reason ?? "sin motivo"}`
    );

    if (cuentas.length > 0) {
      const { markConnectorLead } = await import("@/lib/intake/connectors");
      const detalle = policyEnforcementError(ev);
      await Promise.all(cuentas.map((c) => markConnectorLead(c.id, detalle)));
    }

    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (admins.length === 0) {
      console.warn("[policy-enforcement] no hay ADMIN activo a quien avisar");
      return;
    }
    const nombre = cuentas[0]?.name ?? `la Página ${ev.pageId}`;
    const message = mensajeDelAviso(ev, cuentas.map((c) => c.name));
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        title: `Meta: aviso de políticas en ${nombre}`,
        message,
        type: "meta_policy_enforcement",
        link: "/conexiones",
      })),
    });
  } catch (err) {
    console.error(`[policy-enforcement] no se pudo registrar el aviso de la Página ${ev.pageId}:`, err);
  }
}
