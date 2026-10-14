// WhatsApp propio de un asesor — filtro de privacidad y «posibles prospectos» (2026-10-14, PR 2).
// Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §7.
//
// Decisión 1 del dueño: del número de un asesor solo entran al CRM los chats de PROSPECTOS. Un chat
// es de prospecto si el otro lado ya es un contacto vivo (mismo emparejado que el webhook de
// siempre: teléfono y BSUID) o si el asesor lo marcó con «Es prospecto». De cualquier otro
// remitente NO se guarda cuerpo ni media —ni siquiera se descarga la media—: solo un registro
// mínimo (número o BSUID, nombre de perfil, primera y última vez, cuántos mensajes) que ve
// únicamente ese asesor. Los chats personales nunca entran.
//
// Decisión 2: el bot nunca contesta aquí. Este módulo jamás lo agenda; el candado duro está en
// bot-respond.ts (isAdvisorLine).
//
// El contacto que escribe al número de un asesor conserva su asesor. Si no tiene, se le asigna al
// dueño del número: es quien lo está atendiendo.
import prisma from "@/lib/db";
import type { LeadConnector, WhatsappPendingProspect } from "@prisma/client";
import { findWhatsAppContact } from "@/lib/messaging/core";
import { PLACEHOLDER_LASTNAME } from "@/lib/messaging/types";
import { normalizePhone } from "@/lib/twilio/utils";

/** ¿La cuenta es el número propio de un asesor? */
export function isAdvisorConnector(connector: Pick<LeadConnector, "scope">): boolean {
  return connector.scope === "ADVISOR";
}

/**
 * Le asigna el contacto al dueño del número si NO tiene asesor. Nunca le quita un contacto a nadie:
 * el `updateMany` con `assignedToId: null` en el WHERE lo garantiza aunque dos mensajes lleguen a
 * la vez. Queda en la cronología con su origen. Best-effort: nunca lanza.
 */
export async function assignToAdvisorIfUnowned(
  contact: { id: string; assignedToId: string | null },
  connector: Pick<LeadConnector, "id" | "scope" | "ownerUserId">,
): Promise<boolean> {
  if (!isAdvisorConnector(connector) || !connector.ownerUserId || contact.assignedToId) return false;
  const ownerUserId = connector.ownerUserId;
  try {
    const { withChangeSource } = await import("@/lib/audit/change-context");
    const res = await withChangeSource({ source: "whatsapp_asesor", actorId: ownerUserId }, (tx) =>
      tx.contact.updateMany({ where: { id: contact.id, assignedToId: null }, data: { assignedToId: ownerUserId } }),
    );
    return res.count > 0;
  } catch (err) {
    console.error(`[whatsapp-asesor] no se pudo asignar el contacto ${contact.id}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export interface PendingSighting {
  /** E.164 si Meta mandó el teléfono (`wa_id`). */
  phone: string | null;
  /** BSUID (`contacts[].user_id`). */
  bsuid: string | null;
  profileName: string | null;
  at: Date;
}

/**
 * Registra (o actualiza) el posible prospecto de un remitente desconocido. Solo metadatos: este
 * modelo no tiene columna para el texto ni para la media. Uno «ignorado» no se toca: el asesor ya
 * decidió que es personal. Uno «prospecto» cuyo contacto ya no existe (borrado) vuelve a pendiente.
 * Devuelve el registro, o null si se ignoró o no hay con qué identificarlo. Nunca lanza.
 */
export async function recordPendingProspect(
  connector: Pick<LeadConnector, "id" | "ownerUserId">,
  s: PendingSighting,
): Promise<WhatsappPendingProspect | null> {
  const senderKey = s.phone ?? s.bsuid;
  if (!senderKey) return null;
  try {
    const or = [
      { senderKey },
      ...(s.phone ? [{ phone: s.phone }] : []),
      ...(s.bsuid ? [{ waUserId: s.bsuid }] : []),
    ];
    const existing = await prisma.whatsappPendingProspect.findFirst({ where: { connectorId: connector.id, OR: or } });
    if (existing) {
      if (existing.status === "IGNORED") return null;
      return await prisma.whatsappPendingProspect.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: s.at > existing.lastSeenAt ? s.at : existing.lastSeenAt,
          messageCount: { increment: 1 },
          ...(s.profileName ? { profileName: s.profileName.slice(0, 120) } : {}),
          ...(s.phone && !existing.phone ? { phone: s.phone } : {}),
          ...(s.bsuid && !existing.waUserId ? { waUserId: s.bsuid } : {}),
          // «Es prospecto» cuyo contacto ya no casa (lo borraron): se vuelve a preguntar.
          ...(existing.status === "PROMOTED" ? { status: "PENDING" as const, contactId: null } : {}),
        },
      });
    }
    return await prisma.whatsappPendingProspect.create({
      data: {
        connectorId: connector.id,
        ownerUserId: connector.ownerUserId ?? null,
        senderKey,
        phone: s.phone,
        waUserId: s.bsuid,
        profileName: s.profileName?.slice(0, 120) ?? null,
        firstSeenAt: s.at,
        lastSeenAt: s.at,
        messageCount: 1,
        status: "PENDING",
      },
    });
  } catch (err) {
    // P2002: dos mensajes del mismo desconocido a la vez; el otro ya creó la fila. Perder un +1
    // del contador es aceptable; guardar el mensaje, no.
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2002") {
      console.error(`[whatsapp-asesor] posible prospecto no registrado (${connector.id}):`, code ?? (err instanceof Error ? err.message : err));
    }
    return null;
  }
}

/** Nombre de la libreta del asesor en un posible prospecto PENDIENTE (nunca crea uno). */
export async function enrichPendingProspectName(connectorId: string, phone: string, contactName: string): Promise<boolean> {
  try {
    const res = await prisma.whatsappPendingProspect.updateMany({
      where: { connectorId, phone, status: "PENDING" },
      data: { contactName: contactName.slice(0, 120) },
    });
    return res.count > 0;
  } catch {
    return false;
  }
}

// ─────────────────────── Acciones del asesor ───────────────────────

export type PendingActionResult =
  | { ok: true; status: "PROMOTED"; contactId: string; created: boolean }
  | { ok: true; status: "IGNORED" }
  | { ok: false; status: number; error: string };

/** Solo el dueño ve y decide sus posibles prospectos. Un id ajeno es un 404, igual que uno inexistente. */
async function ownPending(id: string, userId: string) {
  return prisma.whatsappPendingProspect.findFirst({
    where: { id, ownerUserId: userId, connector: { scope: "ADVISOR", ownerUserId: userId } },
  });
}

/** Posibles prospectos pendientes del asesor, del más reciente al más viejo. */
export async function listPendingProspects(userId: string, take = 100) {
  return prisma.whatsappPendingProspect.findMany({
    where: { ownerUserId: userId, status: "PENDING", connector: { scope: "ADVISOR", ownerUserId: userId, deletedAt: null } },
    orderBy: { lastSeenAt: "desc" },
    take,
    select: {
      id: true,
      phone: true,
      waUserId: true,
      profileName: true,
      contactName: true,
      firstSeenAt: true,
      lastSeenAt: true,
      messageCount: true,
    },
  });
}

/**
 * «Es prospecto»: el remitente pasa a ser contacto del CRM, asignado al asesor, y desde ese momento
 * sus mensajes se guardan (lo de antes no: nunca se guardó). Si ya existe un contacto con ese
 * número se usa ese y no se le quita su asesor. Sin teléfono (solo BSUID) no se puede dar de alta:
 * el contacto necesita teléfono (#830).
 */
export async function promotePendingProspect(id: string, userId: string): Promise<PendingActionResult> {
  const p = await ownPending(id, userId);
  if (!p) return { ok: false, status: 404, error: "No encontrado" };
  if (p.status === "PROMOTED" && p.contactId) return { ok: true, status: "PROMOTED", contactId: p.contactId, created: false };
  if (!p.phone) {
    return {
      ok: false,
      status: 422,
      error:
        "Meta no mandó el teléfono de esta persona (solo su identificador de WhatsApp), y un contacto necesita teléfono. " +
        "Pídele su número y agrégalo como contacto a mano.",
    };
  }

  let contact = await findWhatsAppContact(p.phone, { userId: p.waUserId, senderIsPhone: true });
  let created = false;
  if (!contact) {
    const { captureLead } = await import("@/lib/intake/capture-lead");
    const name = (p.contactName || p.profileName || "").trim();
    const [first, ...rest] = name ? name.split(/\s+/) : ["WhatsApp"];
    // Sin reparto: lo marcó el asesor, es suyo. La cuenta va para la señal de vida y la marca.
    const result = await captureLead(
      { source: "WHATSAPP", firstName: first, lastName: rest.join(" ") || PLACEHOLDER_LASTNAME, phone: p.phone },
      { connectorId: p.connectorId, skipRouting: true },
    );
    if (!result.contactId) return { ok: false, status: 500, error: result.error ?? "No se pudo crear el contacto." };
    created = result.isNew;
    contact = await findWhatsAppContact(normalizePhone(p.phone), { userId: p.waUserId, senderIsPhone: true });
    if (!contact) {
      // Recién creado pero el emparejado no lo encuentra (no debería pasar): se usa el id que devolvió.
      contact = { id: result.contactId, assignedToId: result.assignedToId } as NonNullable<typeof contact>;
    }
  }

  const connector = await prisma.leadConnector.findUnique({ where: { id: p.connectorId }, select: { id: true, scope: true, ownerUserId: true } });
  if (connector) await assignToAdvisorIfUnowned(contact, connector);
  if (p.waUserId) {
    await prisma.contact
      .updateMany({ where: { id: contact.id, whatsappUserId: null }, data: { whatsappUserId: p.waUserId } })
      .catch(() => {});
  }
  await prisma.whatsappPendingProspect.update({ where: { id: p.id }, data: { status: "PROMOTED", contactId: contact.id } });
  return { ok: true, status: "PROMOTED", contactId: contact.id, created };
}

/** «Ignorar»: deja de listarse y de contarse. Sus mensajes siguen sin guardarse, como hasta ahora. */
export async function ignorePendingProspect(id: string, userId: string): Promise<PendingActionResult> {
  const p = await ownPending(id, userId);
  if (!p) return { ok: false, status: 404, error: "No encontrado" };
  await prisma.whatsappPendingProspect.update({ where: { id: p.id }, data: { status: "IGNORED" } });
  return { ok: true, status: "IGNORED" };
}
