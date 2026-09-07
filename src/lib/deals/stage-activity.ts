// La nota de cronología que deja un cambio de etapa (#D-02).
// Estaba duplicada palabra por palabra en `api/deals/[id]/route.ts` y en
// `server/deals.ts`, con su propio diccionario de etiquetas en cada una. Ahora se arma
// aquí para que las dos escriban la misma nota y para poder crearla DENTRO de la
// transacción del cambio de etapa.

const ETIQUETAS_ETAPA: Record<string, string> = {
  NEW_LEAD: "Nuevo Lead",
  CONTACTED: "Contactado",
  DISCOVERY_DONE: "Discovery Hecho",
  MEETING_SCHEDULED: "Reunión Agendada",
  MEETING_COMPLETED: "Reunión Realizada",
  PROPOSAL_SENT: "Propuesta Enviada",
  NEGOTIATION: "Negociación",
  RESERVED: "Reservado",
  CONTRACT_SIGNED: "Contrato Firmado",
  CLOSING: "Cierre",
  WON: "Ganado",
  LOST: "Perdido",
  FROZEN: "Congelado",
};

export function etiquetaEtapa(stage: string): string {
  return ETIQUETAS_ETAPA[stage] ?? stage;
}

export interface ActividadCambioEtapaArgs {
  contactId: string;
  dealId: string;
  userId: string;
  fromStage: string;
  toStage: string;
  lostReason?: string | null;
  lostReasonDetail?: string | null;
}

export function actividadDeCambioDeEtapa(args: ActividadCambioEtapaArgs) {
  return {
    contactId: args.contactId,
    dealId: args.dealId,
    userId: args.userId,
    activityType: "NOTE" as const,
    subject: `Cambio de etapa: ${etiquetaEtapa(args.fromStage)} → ${etiquetaEtapa(args.toStage)}`,
    description:
      args.toStage === "LOST"
        ? `Razón: ${args.lostReason ?? "sin especificar"}${
            args.lostReasonDetail ? ` - ${args.lostReasonDetail}` : ""
          }`
        : undefined,
    status: "COMPLETADA" as const,
    completedAt: new Date(),
  };
}
