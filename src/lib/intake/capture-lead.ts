// captureLead — punto único de intake multicanal (Anexo §C.1 / Anexo B §H).
// Webhook web, conectores Meta/TikTok, WhatsApp desconocido y bots llegan aquí.
// Dedup por E.164/email → ruteo → SLA → eventos. Devuelve {contactId, isNew}.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { incomingLeadSchema, type IncomingLead } from "@/lib/validations/rebuild-f1";
import { normalizePhoneE164 } from "@/lib/phone";
import { resolveTargetPlaza } from "@/lib/intake/campaign-plaza";

export interface CaptureResult {
  contactId: string | null;
  isNew: boolean;
  assignedToId: string | null;
  error?: string;
}

/** true si el lead trae algún dato de atribución publicitaria/tracking. */
function hasAttributionData(lead: IncomingLead): boolean {
  return !!(
    lead.utm || lead.gclid || lead.fbclid || lead.ttclid || lead.liFatId || lead.portalLeadId ||
    lead.landingPage || lead.campaignName || lead.adName || lead.network || lead.socialLeadId
  );
}

/** Payload de AdAttribution.create a partir del lead (sin contactId — lo agrega el caller). */
function buildAttributionData(lead: IncomingLead) {
  return {
    gclid: lead.gclid ?? null,
    fbclid: lead.fbclid ?? null,
    ttclid: lead.ttclid ?? null,
    liFatId: lead.liFatId ?? null,
    portalLeadId: lead.portalLeadId ?? null,
    utmSource: lead.utm?.source ?? null,
    utmMedium: lead.utm?.medium ?? null,
    utmCampaign: lead.utm?.campaign ?? null,
    utmTerm: lead.utm?.term ?? null,
    utmContent: lead.utm?.content ?? null,
    landingPage: lead.landingPage ?? null,
    referrer: lead.referrer ?? null,
    campaignName: lead.campaignName ?? null,
    adName: lead.adName ?? null,
    adsetName: lead.adsetName ?? null,
    network: lead.network ?? null,
    socialLeadId: lead.socialLeadId ?? null,
    firstTouch: new Date(),
    lastTouch: new Date(),
  };
}

/**
 * Alta de contacto por el camino canónico.
 *
 * `opts.provisional`: el contacto existe pero **todavía no es un lead** — lo
 * creamos nosotros al escribirle primero (el DM de una regla de comentarios),
 * no porque la persona haya levantado la mano. Se salta ruteo + SLA +
 * notificación, el evento `lead.captured` (y con él el ascenso a MQL que hace
 * lib/lifecycle/transitions.ts) y el `ConversionEvent` de CAPI. `contact.created`
 * SÍ se emite: el contacto existe de verdad.
 *
 * Qué pasa cuando la persona responde (lib/messaging/core.ts):
 *  - SÍ se le enruta —dueño, SLA de primer toque y notificación— gracias a la
 *    marca de origen que el llamador deja en `sourceDetail`.
 *  - SÍ sube a MQL, por el evento `social.replied` del intake.
 *  - **NUNCA se manda el evento `Lead` a Meta CAPI**, ni al comentar ni al
 *    responder. Es una decisión de producto, no un olvido: hay una medición de
 *    calidad de leads de Meta corriendo y un comentarista no debe contar como
 *    lead en ella. `recordConversionEvent` solo se llama en el alta no
 *    provisional, y el intake de inbound no lo llama nunca.
 *
 * Por qué: sin esto, cada persona que comenta "pollo" en una publicación entra
 * como lead calificado, genera un breach de SLA garantizado (nadie va a
 * contestar un DM que ya contestó el bot) y mete un evento `Lead` en la
 * medición de calidad de leads de Meta.
 *
 * `provisional: true` implica `skipRouting`: el llamador no tiene que pasar los
 * dos.
 */
export async function captureLead(
  input: IncomingLead | Record<string, unknown>,
  opts: { connectorId?: string; skipRouting?: boolean; provisional?: boolean } = {}
): Promise<CaptureResult> {
  // Un alta provisional nunca se rutea: no hay a quién avisar de un lead que
  // todavía no existe como tal.
  const skipRouting = opts.skipRouting || opts.provisional === true;
  const parsed = incomingLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { contactId: null, isNew: false, assignedToId: null, error: parsed.error.message };
  }
  const lead = parsed.data;

  // --- Dedup por teléfono E.164, email o identificador social (invariante B.6) ---
  const phone = lead.phone ? normalizePhoneE164(lead.phone) : null;
  const instagramId = lead.instagramId;
  const messengerPsid = lead.messengerPsid;
  const dedupOr: object[] = [];
  if (phone) dedupOr.push({ phone });
  if (lead.email) dedupOr.push({ email: lead.email });
  if (instagramId) dedupOr.push({ instagramId });
  if (messengerPsid) dedupOr.push({ messengerPsid });

  const existing = dedupOr.length
    ? await prisma.contact.findFirst({
        where: { OR: dedupOr as never, deletedAt: null, mergedIntoId: null },
      })
    : null;

  if (existing) {
    // Lead repetido: NO crear; registrar el toque y refrescar actividad.
    //
    // 🚨 Aquí vivía `userId: existing.assignedToId ?? existing.id`: un id de Contact en
    // una FK a `users`. La base lo rechazaba con P2003 y el `.catch(() => {})` se comía
    // el rechazo, así que la nota simplemente no aparecía — sin error, sin aviso, sin
    // rastro. Y solo fallaba para los contactos SIN asesor, que hoy son justo los que
    // entran por DM y comentario: la única vía viva.
    const { actorDeActividad } = await import("@/lib/activities/actor");
    const actor = await actorDeActividad(existing.assignedToId);
    if (actor) {
      await prisma.activity
        .create({
          data: {
            contactId: existing.id,
            userId: actor,
            activityType: "NOTE",
            subject: `Lead repetido desde ${lead.source}`,
            description: [lead.sourceDetail, lead.message].filter(Boolean).join(" — ") || null,
            status: "COMPLETADA",
            completedAt: new Date(),
          },
        })
        // Sigue siendo best-effort —la nota no vale perder la captura del lead— pero
        // ahora deja rastro. Un catch mudo convierte cualquier regresión futura en
        // «la nota no sale y nadie sabe desde cuándo».
        .catch((err) => console.error("[captureLead] nota de lead repetido:", err));
    } else {
      console.warn(
        `[captureLead] sin asesor ni ADMIN activo: no se registró la nota de lead repetido del contacto ${existing.id}`,
      );
    }
    await prisma.contact.update({
      where: { id: existing.id },
      data: { lastActivityAt: new Date() },
    });

    // Enlace social↔ads (Caso 2 punto 6): si el lead repetido trae datos de
    // atribución y el contacto aún no tiene AdAttribution, la creamos ahora —
    // hoy solo se creaba para contactos nuevos y esa info se perdía.
    if (hasAttributionData(lead)) {
      const existingAttribution = await prisma.adAttribution.findUnique({ where: { contactId: existing.id } });
      if (!existingAttribution) {
        await prisma.adAttribution
          .create({ data: { contactId: existing.id, ...buildAttributionData(lead) } })
          .catch((err) => console.error("[captureLead] adAttribution (duplicado):", err));
      }
    }

    // Mismo criterio que en el alta: un toque provisional no convierte a nadie
    // en lead, así que tampoco dispara lead.captured (ni el ascenso a MQL).
    if (!opts.provisional) {
      const { emitEvent } = await import("@/lib/workflows/events");
      await emitEvent("lead.captured", "contact", existing.id, {
        leadSource: lead.source,
        duplicate: true,
        connectorId: opts.connectorId,
      });
    }
    return { contactId: existing.id, isNew: false, assignedToId: existing.assignedToId };
  }

  // Plaza objetivo del lead (reparto por plaza): de la campaña/anuncio o del conector.
  let connectorName: string | null = null;
  if (opts.connectorId) {
    connectorName =
      (await prisma.leadConnector.findUnique({ where: { id: opts.connectorId }, select: { name: true } }))?.name ?? null;
  }
  const targetPlaza = resolveTargetPlaza([lead.campaignName, lead.adName, lead.adsetName, connectorName, lead.sourceDetail]);

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
      contactType: lead.contactType ?? "COMPRADOR",
      contactStatus: "NUEVO",
      lifecycleStage: "LEAD",
      targetPlaza,
      lastActivityAt: new Date(),
      tags: [],
      instagramId: instagramId ?? null,
      messengerPsid: messengerPsid ?? null,
      ...(lead.temperature ? { temperature: lead.temperature } : {}),
      // Perfil de Inversión derivado del formulario (normalizado a enums del CRM)
      investmentProfile: lead.investmentProfile ?? null,
      propertyType: lead.propertyType ?? null,
      purchaseTimeline: lead.purchaseTimeline ?? null,
      budgetMin: lead.budgetMin ?? null,
      budgetMax: lead.budgetMax ?? null,
      paymentMethod: lead.paymentMethod ?? null,
      purchaseModality: lead.purchaseModality ?? null,
      rentalStrategy: lead.rentalStrategy ?? null,
      preferredZone: lead.preferredZone ?? null,
      // Todos los campos crudos del formulario (no se pierde nada de info)
      ...(lead.custom ? { custom: lead.custom as Prisma.InputJsonValue } : {}),
    },
  });

  // Atribución publicitaria si viene en el payload (Anexo §B.4)
  if (hasAttributionData(lead)) {
    await prisma.adAttribution
      .create({ data: { contactId: contact.id, ...buildAttributionData(lead) } })
      .catch((err) => console.error("[captureLead] adAttribution:", err));
  }

  const { emitEvent } = await import("@/lib/workflows/events");
  // contact.created se emite siempre: el contacto existe de verdad, provisional
  // o no. Lo que cambia es si además se le trata como lead.
  await emitEvent("contact.created", "contact", contact.id, { leadSource: lead.source });

  if (!opts.provisional) {
    await emitEvent("lead.captured", "contact", contact.id, {
      leadSource: lead.source,
      connectorId: opts.connectorId,
      hubDevelopmentId: lead.hubDevelopmentId,
    });

    // CAPI: evento Lead hacia plataformas (speckit #4 §5.2) — best effort.
    // Fuera del alta provisional a propósito: targetPlatforms manda a Meta
    // aunque no haya fbclid (matchea por PII), así que un DM de regla metería
    // un Lead por cada comentarista en la medición de calidad.
    try {
      const { recordConversionEvent } = await import("@/lib/capi/events");
      await recordConversionEvent("LEAD", contact);
    } catch { /* tablas C123 sin migrar */ }
  }

  // Ruteo + SLA (P2: owner en <60s)
  let assignedToId: string | null = null;
  if (!skipRouting) {
    const { autoRouteLead } = await import("@/lib/workflows/routing");
    assignedToId = await autoRouteLead(contact.id, { reason: `intake ${lead.source}` });
  }

  return { contactId: contact.id, isNew: true, assignedToId };
}
