// Estado de un número de WhatsApp conectado en coexistencia (2026-10-14). Puro y sin imports de
// servidor: lo leen la pantalla de Conexiones y «Mi Perfil» para pintar «conectado / desconectado
// por el negocio / sincronización pendiente», y el servidor para decidir qué volver a pedir.
// El estado vive en `LeadConnector.config.coex` (spec §4); aquí solo se lee.

export type CoexAccountState = "CONNECTED" | "OFFBOARDED" | "DISCONNECTED";
export type ContactsSyncState = "REQUESTED" | "FAILED";
export type HistorySyncState = "REQUESTED" | "IN_PROGRESS" | "COMPLETE" | "DECLINED" | "FAILED";

export interface CoexState {
  connectedAt?: string;
  accountState?: CoexAccountState;
  accountEventAt?: string;
  disconnection?: { reason?: string | null; initiatedBy?: string | null } | null;
  subscribed?: boolean;
  isOnBizApp?: boolean;
  platformType?: string;
  contactsSync?: { state: ContactsSyncState; at: string; error?: string };
  contactsSyncRequestId?: string | null;
  historySync?: { state: HistorySyncState; at: string; progress?: number; phase?: number; error?: string };
  historySyncRequestId?: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** `config.coex` de una cuenta, o null si la cuenta no se conectó por coexistencia. */
export function readCoexState(config: unknown): CoexState | null {
  const coex = asRecord(asRecord(config)?.coex);
  return coex ? (coex as CoexState) : null;
}

export type CoexStatusKind = "connected" | "pending_sync" | "offboarded" | "disconnected" | "not_subscribed";

export interface CoexStatus {
  kind: CoexStatusKind;
  label: string;
  /** Algo más que conviene saber, sin cambiar el estado (p. ej. el negocio no compartió el historial). */
  detail: string | null;
}

/** Motivos de PARTNER_REMOVED (doc de coexistencia), dichos para quien no es desarrollador. */
const DISCONNECTION_REASON: Record<string, string> = {
  ACCOUNT_DISCONNECTED: "la cuenta de WhatsApp se desconectó o se eliminó",
  BUSINESS_DOWNGRADE: "el número pasó a la app de WhatsApp normal (no Business)",
  CHANGE_NUMBER: "el negocio cambió de número",
  COMPANION_INACTIVITY: "el dispositivo vinculado estuvo inactivo unos 30 días",
  PRIMARY_INACTIVITY: "el teléfono principal estuvo inactivo unos 14 días",
  USER_RE_REGISTERED: "se volvió a registrar el número en otro teléfono",
};

export function disconnectionReasonText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return DISCONNECTION_REASON[reason] ?? reason;
}

/** Estado legible de la cuenta, o null si no es de coexistencia (alta manual de siempre). */
export function coexStatusOf(config: unknown): CoexStatus | null {
  const coex = readCoexState(config);
  if (!coex) return null;

  if (coex.accountState === "DISCONNECTED") {
    const why = disconnectionReasonText(coex.disconnection?.reason);
    return {
      kind: "disconnected",
      label: "Desconectado por el negocio",
      detail: why ? `Motivo: ${why}. Para volver, conecta el número otra vez.` : "Para volver, conecta el número otra vez.",
    };
  }
  if (coex.accountState === "OFFBOARDED") {
    return {
      kind: "offboarded",
      label: "Desconectado temporalmente",
      detail: "Cambio de teléfono o reinstalación de WhatsApp Business. Meta lo reconecta solo en unos minutos.",
    };
  }
  if (coex.subscribed === false) {
    return {
      kind: "not_subscribed",
      label: "Sin webhooks",
      detail: "No se pudo suscribir la app a la cuenta de WhatsApp: no llegarán mensajes. Vuelve a conectar el número.",
    };
  }

  const history = coex.historySync;
  if (history && (history.state === "REQUESTED" || history.state === "IN_PROGRESS")) {
    const pct = typeof history.progress === "number" ? ` (${Math.max(0, Math.min(100, Math.round(history.progress)))}%)` : "";
    return {
      kind: "pending_sync",
      label: `Sincronizando historial${pct}`,
      detail: "Mantén abierta la app de WhatsApp Business en el teléfono mientras termina.",
    };
  }

  const contactsFailed =
    coex.contactsSync?.state === "FAILED"
      ? `No se pudieron pedir los contactos${coex.contactsSync.error ? `: ${coex.contactsSync.error}` : "."}`
      : null;
  if (!history) return { kind: "pending_sync", label: "Sincronización pendiente", detail: contactsFailed };

  let detail: string | null = contactsFailed;
  if (history.state === "DECLINED") detail = "El negocio no compartió su historial: solo se verán los mensajes nuevos.";
  else if (history.state === "FAILED") detail = `No se pudo pedir el historial${history.error ? `: ${history.error}` : "."}`;
  return { kind: "connected", label: "Conectado (app y CRM)", detail };
}
