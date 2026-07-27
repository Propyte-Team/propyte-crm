// Selección del agente del bot por segmento (Frente 4). El perfil aporta:
// identidad (capa objetivo), playbook propio (opcional) y tono override (opcional).
// Sin perfil activo para el tipo → null y el bot se comporta como hoy (global).
import type { BotAgentProfile, BotPlaybook, BotTask, ContactType, PrismaClient } from "@prisma/client";

export type AgentProfileWithPlaybook = BotAgentProfile & {
  playbook: (BotPlaybook & { tasks: BotTask[] }) | null;
};

/** Perfil activo cuyo contactTypes incluye el tipo; menor priority gana. null = sin agente. */
export async function selectAgentProfile(
  db: PrismaClient,
  contactType: ContactType
): Promise<AgentProfileWithPlaybook | null> {
  try {
    const profiles = await db.botAgentProfile.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        contactTypes: { has: contactType },
      },
      orderBy: { priority: "asc" },
      take: 1,
      include: {
        playbook: {
          include: { tasks: { where: { isActive: true }, orderBy: { order: "asc" } } },
        },
      },
    });
    const profile = profiles[0] ?? null;
    // playbook borrado → se ignora (queda el global como fallback)
    if (profile?.playbook?.deletedAt) return { ...profile, playbook: null };
    return profile;
  } catch (err) {
    console.warn("[bot] selectAgentProfile falló:", err);
    return null;
  }
}

/**
 * Aplica el tono override del agente sobre una config (BotConfigResolved u otro
 * objeto con `tonePreset`). Sin perfil o sin tonePreset propio → la misma config,
 * sin copiar (comportamiento global intacto). Con tonePreset → copia con override.
 */
export function applyAgentTone<T extends { tonePreset: unknown }>(
  config: T,
  profile: { tonePreset: T["tonePreset"] | null | undefined } | null | undefined
): T {
  if (!profile?.tonePreset) return config;
  return { ...config, tonePreset: profile.tonePreset } as T;
}

/**
 * Compone la capa "objetivo": la identidad del agente antecede al objetivo base
 * (playbook o ruta A). Sin ninguno → undefined (mismo criterio que bot-respond).
 */
export function composeObjective(
  identity: string | null | undefined,
  baseObjective: string | undefined
): string | undefined {
  return [identity, baseObjective].filter(Boolean).join("\n\n") || undefined;
}

/** Playbook propio del agente si existe y tiene >=1 tarea; si no, null (fallback al global). */
export function agentPlaybookOf(
  profile: { playbook: (BotPlaybook & { tasks: BotTask[] }) | null } | null | undefined
): (BotPlaybook & { tasks: BotTask[] }) | null {
  return profile?.playbook && profile.playbook.tasks.length > 0 ? profile.playbook : null;
}
