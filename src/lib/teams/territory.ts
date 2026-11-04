// Resolución de territorio (speckit Personalización §2.4) — el lead cae PRIMERO en un
// territorio (matriz plaza/zona/idioma/presupuesto) y LUEGO se elige asesor dentro de él.
// Evaluación hijo-antes-que-padre: gana la regla que matchea del territorio más profundo.
import prisma from "@/lib/db";
import type { Contact } from "@prisma/client";
import { evaluateConditions } from "@/lib/workflows/evaluate-conditions";

export interface TerritoryMatch {
  territoryId: string;
  territoryName: string;
  depth: number;
  priority: number;
  memberUserIds: string[];
}

// Pura (testeable): de los matches, gana el más profundo; empate → menor priority.
export function pickWinningTerritory(matches: TerritoryMatch[]): TerritoryMatch | null {
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.depth - a.depth || a.priority - b.priority)[0];
}

// Zonas: minúsculas, sin acentos, recortada y con espacios colapsados.
export function normalizarZona(z: string | null | undefined): string {
  return (z ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Pura: ¿la zona preferida del contacto coincide con alguna zona del territorio?
export function coincideZona(zonas: string[] | null | undefined, preferredZone: string | null | undefined): boolean {
  const objetivo = normalizarZona(preferredZone);
  if (!objetivo || !zonas?.length) return false;
  return zonas.some((z) => normalizarZona(z) === objetivo);
}

// Prioridad de la coincidencia implícita por zona: mayor (= menos prioritaria) que cualquier
// regla explícita del mismo territorio, para que una regla escrita a mano gane.
export const ZONE_MATCH_PRIORITY = 900;

async function territoryDepth(territoryId: string, cache: Map<string, number>): Promise<number> {
  if (cache.has(territoryId)) return cache.get(territoryId)!;
  let depth = 0;
  let current: string | null = territoryId;
  while (current) {
    const t: { parentTerritoryId: string | null } | null = await prisma.territory.findUnique({
      where: { id: current },
      select: { parentTerritoryId: true },
    });
    current = t?.parentTerritoryId ?? null;
    if (current) depth++;
    if (depth > 10) break; // guarda anti-ciclo
  }
  cache.set(territoryId, depth);
  return depth;
}

export async function resolveTerritoryForContact(contact: Contact): Promise<TerritoryMatch | null> {
  const rules = await prisma.territoryRule.findMany({
    where: { isActive: true, territory: { isActive: true, deletedAt: null } },
    orderBy: { priority: "asc" },
    include: {
      territory: {
        select: {
          id: true,
          name: true,
          members: { select: { userId: true, user: { select: { isActive: true } } } },
        },
      },
    },
  });
  // Una sola consulta extra: territorios activos con zonas definidas (match implícito).
  const zoneTerritories = contact.preferredZone
    ? await prisma.territory.findMany({
        where: { isActive: true, deletedAt: null, zones: { isEmpty: false } },
        select: {
          id: true,
          name: true,
          plaza: true,
          zones: true,
          members: { select: { userId: true, user: { select: { isActive: true } } } },
        },
      })
    : [];
  if (rules.length === 0 && zoneTerritories.length === 0) return null;

  const ctx = { contact: { ...contact, score: Number(contact.score) } };
  const depthCache = new Map<string, number>();
  const matches: TerritoryMatch[] = [];

  for (const rule of rules) {
    if (!evaluateConditions(rule.conditions as never, ctx)) continue;
    matches.push({
      territoryId: rule.territory.id,
      territoryName: rule.territory.name,
      depth: await territoryDepth(rule.territory.id, depthCache),
      priority: rule.priority,
      memberUserIds: rule.territory.members
        .filter((m) => m.user.isActive)
        .map((m) => m.userId),
    });
  }

  for (const t of zoneTerritories) {
    if (!coincideZona(t.zones, contact.preferredZone)) continue;
    // Si el contacto no tiene plaza, la plaza del territorio no bloquea.
    if (t.plaza && contact.targetPlaza && t.plaza !== contact.targetPlaza) continue;
    matches.push({
      territoryId: t.id,
      territoryName: t.name,
      depth: await territoryDepth(t.id, depthCache),
      priority: ZONE_MATCH_PRIORITY,
      memberUserIds: t.members.filter((m) => m.user.isActive).map((m) => m.userId),
    });
  }

  return pickWinningTerritory(matches);
}
