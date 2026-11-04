// Texto en español de las reglas de comisión (sin React ni Prisma, para probarlo en node).
// Lo usan la pantalla de Comisiones y el servidor (src/server/admin.ts).
import { DEAL_TYPE_LABELS, LEAD_SOURCE_CATEGORY_LABELS } from "@/lib/constants";
import { ROLE_LABELS_COMPLETO, etiqueta } from "@/lib/labels";

export interface ReglaClave {
  dealType: string;
  leadSourceCategory: string;
  role: string;
}

/** "Nativa Contado · Lead Propyte · Asesor Senior" */
export function describirClaveRegla(clave: ReglaClave): string {
  return [
    etiqueta(DEAL_TYPE_LABELS, clave.dealType),
    etiqueta(LEAD_SOURCE_CATEGORY_LABELS, clave.leadSourceCategory),
    etiqueta(ROLE_LABELS_COMPLETO, clave.role),
  ].join(" · ");
}

export function mensajeReglaDuplicada(existente: ReglaClave & { percentage: unknown }): string {
  return `Ya existe una regla para ${describirClaveRegla(existente)} (${Number(existente.percentage)}%). Edítala en lugar de crear otra.`;
}
