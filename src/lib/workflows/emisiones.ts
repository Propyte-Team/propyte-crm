// Emisiones de eventos de dominio que se disparan desde puntos sueltos del CRM
// (fusión de contactos, cotización abierta, visita realizada). Cada una es best-effort:
// si el motor falla se registra y NO se rompe la operación que la originó.
import { emitEvent } from "./events";

/** Tipos de actividad que cuentan como "visita" (reunión presencial o en showroom). */
const TIPOS_DE_VISITA = new Set(["MEETING_PRESENTIAL", "MEETING_SHOWROOM"]);
export const esVisita = (activityType: string): boolean => TIPOS_DE_VISITA.has(activityType);

async function emitirSeguro(...args: Parameters<typeof emitEvent>): Promise<void> {
  try {
    await emitEvent(...args);
  } catch (err) {
    console.error(`[workflows] no se pudo emitir ${args[0]}:`, err);
  }
}

/** Entidad = el contacto que sobrevive; `perdedorId` es el duplicado absorbido. */
export function emitirContactoFusionado(survivorId: string, perdedorId: string): Promise<void> {
  return emitirSeguro("contact.merged", "contact", survivorId, { mergedContactId: perdedorId });
}

/** Primera apertura de la cotización pública. Entidad = el negocio de la cotización. */
export function emitirCotizacionAbierta(q: { id: string; dealId: string; contactId?: string | null }): Promise<void> {
  return emitirSeguro("quote.opened", "deal", q.dealId, { quoteId: q.id, contactId: q.contactId ?? null });
}

/** Una reunión presencial/showroom queda completada. Sin contacto no hay entidad: no emite. */
export function emitirVisitaRealizada(a: {
  id: string; activityType: string; contactId?: string | null; dealId?: string | null;
}): Promise<void> {
  if (!a.contactId || !esVisita(a.activityType)) return Promise.resolve();
  return emitirSeguro("visit.completed", "contact", a.contactId, {
    activityId: a.id, activityType: a.activityType, dealId: a.dealId ?? null,
  });
}
