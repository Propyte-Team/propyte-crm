// #961 — Apartar cuando el Hub no contesta.
//
// El hold de la unidad es una llamada REST al Hub (lib/hub/client.ts). Si el Hub no está
// configurado en el servidor (faltan HUB_API_BASE_URL / HUB_API_KEY) o no responde, eso no dice
// nada de la unidad, y bloquear al asesor deja la venta sin registrar. Entonces se aparta en el
// CRM y la operación queda marcada «Pendiente de apartar en el Hub» (custom.hubHoldPendiente)
// para reintentarlo después. Antes se revisa lo que sí se puede saber sin el REST:
//   - la unidad en el catálogo del Hub (lectura SQL directa): vendida o apartada → no;
//   - ninguna otra operación o negocio activo del CRM la tiene.
// Un «no» del Hub (motivo `rechazo`) nunca pasa por aquí: se respeta.
import prisma from "@/lib/db";
import { getHubUnit } from "@/lib/hub/client";
import { estadoOcupado } from "@/lib/hub/hold-pendiente";

export { HOLD_PENDIENTE_LABEL, holdPendienteDe, permiteRespaldo, type HoldPendiente } from "@/lib/hub/hold-pendiente";

const ETAPAS_QUE_OCUPAN = ["APARTADO", "FIRMA", "ESCRITURA", "POSTVENTA"] as const;
const STAGES_QUE_OCUPAN = ["RESERVED", "CONTRACT_SIGNED", "CLOSING", "WON"] as const;

/** Revisa la unidad sin el REST del Hub. `null` = libre; si no, el mensaje para el asesor. */
export async function unidadOcupadaSinHub(hubUnitId: string, dealId: string): Promise<string | null> {
  const unidad = await getHubUnit(hubUnitId).catch(() => null);
  if (unidad && estadoOcupado(unidad.status)) {
    return `La unidad ${unidad.numero ?? ""} aparece como «${unidad.status}» en el inventario`.replace("  ", " ");
  }
  const otra = await prisma.deal.findFirst({
    where: {
      id: { not: dealId },
      deletedAt: null,
      hubUnitId,
      OR: [{ etapa: { in: [...ETAPAS_QUE_OCUPAN] } }, { etapa: null, stage: { in: [...STAGES_QUE_OCUPAN] } }],
    },
    select: { id: true, contact: { select: { firstName: true, lastName: true } } },
  });
  if (otra) {
    const quien = [otra.contact?.firstName, otra.contact?.lastName].filter(Boolean).join(" ");
    return `La unidad ya está apartada en otra operación del CRM${quien ? ` (${quien})` : ""}`;
  }
  return null;
}
