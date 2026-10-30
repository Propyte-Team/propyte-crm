// Zod del CRUD de agentes del bot — archivo aparte porque un "use server"
// solo puede exportar funciones async (misma razón que bot-config.schema.ts).
import { z } from "zod";
import { CONTACT_TYPE_ORDER, normalizarTipoContacto } from "@/lib/constants";

// #907: los tipos que un agente puede atender son los vigentes. REFERIDOR salió (lo atiende el
// Agente Brokers); un perfil viejo que aún lo tenga no se puede volver a guardar con él.
export const AGENT_CONTACT_TYPES = CONTACT_TYPE_ORDER;

/**
 * #956: los tipos de un agente, traducidos a los vigentes. Un perfil guardado antes de un cambio
 * de tipos (#907, #929, #938) todavía puede tener LEAD, COMPRADOR, INVERSIONISTA o REFERIDOR. El
 * formulario no los pinta como chip, pero los seguía mandando al guardar, y el esquema los
 * rechazaba con un 500 sin mensaje. Ahora se traducen a su reemplazo (LEAD_COMPRADOR,
 * BROKER_EXTERNO), se quitan los que no tienen reemplazo (REFERIDO) y no se repiten.
 */
export function tiposDeAgenteVigentes(valores: readonly unknown[]): string[] {
  const vistos = new Set<string>();
  for (const v of valores) {
    const vigente = normalizarTipoContacto(v);
    if (typeof vigente === "string" && vigente !== "") vistos.add(vigente);
  }
  return [...vistos];
}

export const AGENT_TONE_PRESETS = [
  "PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO",
] as const;

export const agentProfileUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Falta el nombre del agente").max(80, "El nombre es muy largo (máximo 80 caracteres)"),
  contactTypes: z.preprocess(
    (v) => (Array.isArray(v) ? tiposDeAgenteVigentes(v) : v),
    z.array(z.enum(AGENT_CONTACT_TYPES), { error: "Los tipos de contacto no son válidos" })
      .min(1, "Elige al menos un tipo de contacto"),
  ),
  identity: z.string().trim().min(1, "Falta la identidad del agente").max(2000, "La identidad es muy larga (máximo 2,000 caracteres)"),
  playbookId: z.string().nullable().optional(),
  tonePreset: z.enum(AGENT_TONE_PRESETS).nullable().optional(),
  isActive: z.boolean().optional().default(false),
  priority: z.number().int().min(1, "La prioridad va de 1 a 999").max(999, "La prioridad va de 1 a 999").optional().default(100),
});

export type AgentProfileUpsertInput = z.input<typeof agentProfileUpsertSchema>;
