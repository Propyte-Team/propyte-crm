// "¿Quién contesta?": resuelve, por cuenta conectada, qué estilo, guion (playbook) y autonomía
// aplican y de dónde vienen. Módulo PURO (sin React ni Prisma) para poder probarlo en node.
//
// La precedencia es la REAL de bot-respond.ts (no se inventa aquí):
//   · Cuenta con marca NO predeterminada: manda la marca. Estilo = el de la marca o, si no tiene,
//     el general. Guion = el de la marca; una marca sin guion NO hereda el general (sus preguntas
//     son de ella). No hay agentes por tipo de contacto. Contesta si el agente de la marca está
//     encendido; si no, el hilo pasa a un asesor.
//   · Cuenta sin marca (o con la predeterminada): contesta el bot general. Si hay un agente activo
//     para el tipo de contacto, su estilo y su guion mandan sobre el general; un agente sin guion
//     tampoco hereda el general. Sin agente, todo es general.
//   · La autonomía y el interruptor "Bot activo" siempre son los generales (ai-actions.ts lee
//     BotConfig; la marca solo agrega su propio interruptor).
import { TONE_PRESETS } from "./tone-presets";
import { AUTONOMY_LABELS, CONTACT_TYPE_LABELS, etiqueta } from "@/lib/labels";

export type OrigenDato = "marca" | "agente" | "general" | "ninguno";

export interface BotConfigLite {
  botEnabled: boolean;
  tonePreset: string;
  autonomyLevel: string;
  activePlaybookId: string | null;
}
export interface AgenteLite {
  id: string;
  name: string;
  contactTypes: string[];
  tonePreset: string | null;
  playbookId: string | null;
  isActive: boolean;
  priority?: number;
}
export interface MarcaLite {
  id: string;
  name: string;
  isDefault: boolean;
  botEnabled: boolean;
  tonePreset: string | null;
  playbookId: string | null;
}
export interface CuentaLite {
  id: string;
  name: string;
  provider?: string;
  brandId: string | null;
  /** ADVISOR = número propio de un asesor: el bot no contesta ahí. */
  scope?: string | null;
}
export interface PlaybookLite {
  id: string;
  name: string;
}

export interface DatoResuelto {
  /** Valor técnico (clave del estilo o id del playbook); null si no aplica. */
  valor: string | null;
  /** Texto para mostrar, ya en español. */
  etiqueta: string;
  origen: OrigenDato;
}

export interface FilaQuienContesta {
  cuentaId: string | null;
  cuenta: string;
  marca: string;
  /** Quién contesta, en una frase corta. */
  contesta: string;
  /** false = el bot no contesta solo en esa cuenta. */
  contestaSolo: boolean;
  estilo: DatoResuelto;
  guion: DatoResuelto;
  autonomia: DatoResuelto;
  /** Texto corto del origen principal ("Marca", "Agente por tipo de contacto", "General"). */
  origen: string;
}

export interface ResultadoQuienContesta {
  cuentas: FilaQuienContesta[];
  /** Solo para las cuentas sin marca: lo que cambia según el tipo de contacto. */
  porTipo: FilaQuienContesta[];
}

export interface EntradaQuienContesta {
  botConfig: BotConfigLite;
  agentes: AgenteLite[];
  marcas: MarcaLite[];
  cuentas: CuentaLite[];
  playbooks?: PlaybookLite[];
}

export const ORIGEN_LABELS: Record<OrigenDato, string> = {
  marca: "Marca",
  agente: "Agente por tipo de contacto",
  general: "General",
  ninguno: "—",
};

function nombreEstilo(clave: string): string {
  return TONE_PRESETS[clave as keyof typeof TONE_PRESETS]?.label ?? etiqueta({}, clave);
}

function nombreGuion(id: string | null, playbooks: PlaybookLite[]): string {
  if (!id) return "—";
  return playbooks.find((p) => p.id === id)?.name ?? "Guion elegido";
}

function estiloDe(propio: string | null, general: string, origenPropio: OrigenDato): DatoResuelto {
  return propio
    ? { valor: propio, etiqueta: nombreEstilo(propio), origen: origenPropio }
    : { valor: general, etiqueta: nombreEstilo(general), origen: "general" };
}

function autonomiaDe(cfg: BotConfigLite): DatoResuelto {
  return { valor: cfg.autonomyLevel, etiqueta: etiqueta(AUTONOMY_LABELS, cfg.autonomyLevel), origen: "general" };
}

/** Texto "Hereda: X (general)" para los selectores "igual que el general". */
export function textoHereda(
  tipo: "estilo" | "guion",
  botConfig: Pick<BotConfigLite, "tonePreset" | "activePlaybookId">,
  playbooks: PlaybookLite[] = [],
): string {
  if (tipo === "estilo") return `Hereda: ${nombreEstilo(botConfig.tonePreset)} (general)`;
  return botConfig.activePlaybookId
    ? `Hereda: ${nombreGuion(botConfig.activePlaybookId, playbooks)} (general)`
    : "Hereda: sin guion (el general no tiene uno activo)";
}

export function resolverQuienContesta(entrada: EntradaQuienContesta): ResultadoQuienContesta {
  const { botConfig, agentes, marcas, cuentas } = entrada;
  const playbooks = entrada.playbooks ?? [];
  const marcaPorId = new Map(marcas.map((m) => [m.id, m]));
  const generalEstilo = estiloDe(null, botConfig.tonePreset, "general");
  const generalGuion: DatoResuelto = botConfig.activePlaybookId
    ? { valor: botConfig.activePlaybookId, etiqueta: nombreGuion(botConfig.activePlaybookId, playbooks), origen: "general" }
    : { valor: null, etiqueta: "Sin guion", origen: "ninguno" };
  const autonomia = autonomiaDe(botConfig);

  const filas: FilaQuienContesta[] = cuentas.map((c) => {
    const marca = c.brandId ? marcaPorId.get(c.brandId) : undefined;
    // Línea propia de un asesor: nunca contesta el bot (isAdvisorLine en bot-respond).
    if (c.scope === "ADVISOR") {
      return {
        cuentaId: c.id,
        cuenta: c.name,
        marca: marca && !marca.isDefault ? marca.name : "—",
        contesta: "Un asesor (línea personal; el bot no contesta)",
        contestaSolo: false,
        estilo: { valor: null, etiqueta: "—", origen: "ninguno" },
        guion: { valor: null, etiqueta: "—", origen: "ninguno" },
        autonomia: { valor: null, etiqueta: "—", origen: "ninguno" },
        origen: "Línea de asesor",
      };
    }
    // Marca no predeterminada: la marca es la identidad.
    if (marca && !marca.isDefault) {
      const guion: DatoResuelto = marca.playbookId
        ? { valor: marca.playbookId, etiqueta: nombreGuion(marca.playbookId, playbooks), origen: "marca" }
        : { valor: null, etiqueta: "Sin guion (la marca no usa el del bot general)", origen: "ninguno" };
      return {
        cuentaId: c.id,
        cuenta: c.name,
        marca: marca.name,
        contesta: marca.botEnabled
          ? `Agente de ${marca.name}`
          : `Nadie solo: el agente de ${marca.name} está apagado y el hilo pasa a un asesor`,
        contestaSolo: marca.botEnabled,
        estilo: estiloDe(marca.tonePreset, botConfig.tonePreset, "marca"),
        guion,
        autonomia,
        origen: marca.tonePreset || marca.playbookId ? ORIGEN_LABELS.marca : "Marca + general",
      };
    }
    // Sin marca (o predeterminada): bot general.
    const hayAgentes = agentes.some((a) => a.isActive);
    return {
      cuentaId: c.id,
      cuenta: c.name,
      marca: marca ? marca.name : "Sin marca",
      contesta: botConfig.botEnabled
        ? hayAgentes
          ? "Bot general (o el agente del tipo de contacto)"
          : "Bot general"
        : "Nadie solo: el bot general está apagado",
      contestaSolo: botConfig.botEnabled,
      estilo: generalEstilo,
      guion: generalGuion,
      autonomia,
      origen: hayAgentes ? "General · cambia por tipo de contacto" : ORIGEN_LABELS.general,
    };
  });

  // Por tipo de contacto (solo cuentas sin marca): un agente activo manda sobre el general; el
  // agente sin guion no hereda el general (bot-respond: useGlobalPlaybook exige !agentProfile).
  const porTipo: FilaQuienContesta[] = agentes
    .filter((a) => a.isActive)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
    .map((a) => ({
      cuentaId: null,
      cuenta: a.contactTypes.map((t) => etiqueta(CONTACT_TYPE_LABELS, t)).join(", ") || "—",
      marca: "Cuentas sin marca",
      contesta: a.name,
      contestaSolo: botConfig.botEnabled,
      estilo: estiloDe(a.tonePreset, botConfig.tonePreset, "agente"),
      guion: a.playbookId
        ? { valor: a.playbookId, etiqueta: nombreGuion(a.playbookId, playbooks), origen: "agente" as const }
        : { valor: null, etiqueta: "Sin guion (el agente no usa el del bot general)", origen: "ninguno" as const },
      autonomia,
      origen: ORIGEN_LABELS.agente,
    }));

  return { cuentas: filas, porTipo };
}
