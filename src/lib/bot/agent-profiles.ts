// Selección del agente del bot por segmento (Frente 4). El perfil aporta:
// identidad (capa objetivo), playbook propio (opcional) y tono override (opcional).
// Sin perfil activo para el tipo → null y el bot se comporta como hoy (global).
import type { BotAgentProfile, BotPlaybook, BotTask, ContactType } from "@prisma/client";

export type AgentProfileWithPlaybook = BotAgentProfile & {
  playbook: (BotPlaybook & { tasks: BotTask[] }) | null;
};

type Db = {
  botAgentProfile: {
    findMany: (args: unknown) => Promise<AgentProfileWithPlaybook[]>;
  };
};

/** Perfil activo cuyo contactTypes incluye el tipo; menor priority gana. null = sin agente. */
export async function selectAgentProfile(
  db: Db,
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
