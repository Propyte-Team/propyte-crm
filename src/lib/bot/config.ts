import prisma from "@/lib/db";
import type { BotTonePreset, AutonomyLevel } from "@prisma/client";

export type OpenerStyle = "WARM_NAME" | "DIRECT";

export interface BotConfigResolved {
  botEnabled: boolean;
  tonePreset: BotTonePreset;
  autonomyLevel: AutonomyLevel;
  model: string;
  openerStyle: OpenerStyle;
  maxLines: number;
  dataGateStrict: boolean;
  escalationTriggers: string[];
  enabledChannels: string[];
  activePlaybookId: string | null;
}

export const DEFAULT_BOT_CONFIG: BotConfigResolved = {
  botEnabled: true,
  tonePreset: "PROFESIONAL_CALIDO",
  autonomyLevel: "L2",
  model: process.env.BOT_MODEL?.trim() || "claude-sonnet-5",
  openerStyle: "WARM_NAME",
  maxLines: 4,
  dataGateStrict: true,
  escalationTriggers: ["apartar", "queja", "legal_fiscal", "negociacion"],
  enabledChannels: ["WHATSAPP"],
  activePlaybookId: null,
};

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : fallback;
}

// Fila cruda de Prisma (o null). Función pura: fácil de testear sin DB.
export function resolveBotConfig(row: Record<string, unknown> | null): BotConfigResolved {
  if (!row) return { ...DEFAULT_BOT_CONFIG };
  const d = DEFAULT_BOT_CONFIG;
  return {
    botEnabled: (row.botEnabled as boolean) ?? d.botEnabled,
    tonePreset: (row.tonePreset as BotTonePreset) ?? d.tonePreset,
    autonomyLevel: (row.autonomyLevel as AutonomyLevel) ?? d.autonomyLevel,
    model: (row.model as string) || d.model,
    openerStyle: (row.openerStyle as OpenerStyle) ?? d.openerStyle,
    maxLines: (row.maxLines as number) ?? d.maxLines,
    dataGateStrict: (row.dataGateStrict as boolean) ?? d.dataGateStrict,
    escalationTriggers: asStringArray(row.escalationTriggers, d.escalationTriggers),
    enabledChannels: asStringArray(row.enabledChannels, d.enabledChannels),
    activePlaybookId: (row.activePlaybookId as string) ?? null,
  };
}

let _cache: { value: BotConfigResolved; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function getBotConfig(): Promise<BotConfigResolved> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
  let row: Record<string, unknown> | null = null;
  try {
    row = (await prisma.botConfig.findFirst()) as Record<string, unknown> | null;
  } catch {
    // Antes de aplicar la migración, la tabla no existe: usar defaults seguros.
    row = null;
  }
  const value = resolveBotConfig(row);
  _cache = { value, at: Date.now() };
  return value;
}

export function invalidateBotConfigCache(): void {
  _cache = null;
}
