// captureLead — punto único de intake multicanal (Anexo §C.1 / Anexo B §H).
// Webhook web, conectores Meta/TikTok, WhatsApp desconocido y bots llegan aquí.
// Dedup por E.164/email → ruteo → SLA → eventos. Devuelve {contactId, isNew}.
import prisma from "@/lib/db";
import { incomingLeadSchema, type IncomingLead } from "@/lib/validations/rebuild-f1";
import { normalizePhoneE164 } from "@/lib/phone";

export interface CaptureResult {
  contactId: string | null;
  isNew: boolean;
  assignedToId: string | null;
  error?: string;
}

export async function captureLead(
  input: IncomingLead | Record<string, unknown>,
  opts: { connectorId?: string; skipRouting?: boolean } = {}
): Promise<CaptureResult> {
  const parsed = incomingLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { contactId: null, isNew: false, assignedToId: null, error: parsed.error.message };
  }
  const lead = parsed.data;

  // --- Dedup por teléfono E.164 o email (invariante B.6) ---
  const phone = lead.phone ? normalizePhoneE164(lead.phone) : null;
  const dedupOr: object[] = [];
  if (phone) dedupOr.push({ phone });
  if (lead.email) dedupOr.push({ email: lead.email });

  const existing = dedupOr.length
    ? await prisma.contact.findFirst({
        where: { OR: dedupOr as never, deletedAt: null, mergedIntoId: null },
      })
    : null;

  if (existing) {
    // Lead repetido: NO crear; registrar el toque y refrescar actividad
    await prisma.activity.create({
      data: {
        contactId: existing.id,
        userId: existing.assignedToId ?? existing.id,
        activityType: "NOTE",
        subject: `Lead repetido desde ${lead.source}`,
        description: [lead.sourceDetail, lead.message].filter(Boolean).join(" — ") || null,
        status: "COMPLETADA",
        completedAt: new Date(),
      },
    }).catch(() => {});
    await prisma.contact.update({
      where: { id: existing.id },
      data: { lastActivityAt: new Date() },
    });
    const { emitEvent } = await import("@/lib/workflows/events");
    await emitEvent("lead.captured", "contact", existing.id, {
      leadSource: lead.source,
      duplicate: true,
      connectorId: opts.connectorId,
    });
    return { contactId: existing.id, isNew: false, assignedToId: existing.assignedToId };
  }

  // --- Contacto nuevo ---
  const contact = await prisma.contact.create({
    data: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      phone: phone ?? "", // schema actual exige phone; email-only guarda vacío normalizable después
      email: lead.email ?? null,
      leadSource: lead.source,
      leadSourceDetail: lead.sourceDetail ?? null,
      preferredLanguage: lead.language ?? "ES",
      contactType: "LEAD",
      contactStatus: "NUEVO",
      lastActivityAt: new Date(),
      tags: [],
    },
  });

  // Atribución publicitaria si viene en el payload (Anexo §B.4)
  if (lead.utm || lead.gclid || lead.fbclid || lead.landingPage) {
    await prisma.adAttribution.create({
      data: {
        contactId: contact.id,
        gclid: lead.gclid ?? null,
        fbclid: lead.fbclid ?? null,
        utmSource: lead.utm?.source ?? null,
        utmMedium: lead.utm?.medium ?? null,
        utmCampaign: lead.utm?.campaign ?? null,
        utmTerm: lead.utm?.term ?? null,
        utmContent: lead.utm?.content ?? null,
        landingPage: lead.landingPage ?? null,
        referrer: lead.referrer ?? null,
        firstTouch: new Date(),
        lastTouch: new Date(),
      },
    }).catch((err) => console.error("[captureLead] adAttribution:", err));
  }

  const { emitEvent } = await import("@/lib/workflows/events");
  await emitEvent("contact.created", "contact", contact.id, { leadSource: lead.source });
  await emitEvent("lead.captured", "contact", contact.id, {
    leadSource: lead.source,
    connectorId: opts.connectorId,
    hubDevelopmentId: lead.hubDevelopmentId,
  });

  // Ruteo + SLA (P2: owner en <60s)
  let assignedToId: string | null = null;
  if (!opts.skipRouting) {
    const { autoRouteLead } = await import("@/lib/workflows/routing");
    assignedToId = await autoRouteLead(contact.id, { reason: `intake ${lead.source}` });
  }

  return { contactId: contact.id, isNew: true, assignedToId };
}
