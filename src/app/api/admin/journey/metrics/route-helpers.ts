import { z } from "zod";

export const windowSchema = z.enum(["7", "30", "90", "all"]);

// PURA y exportada para test: ventana → fecha de corte (null = todo).
export function cutoffFromWindow(window: z.infer<typeof windowSchema>, nowMs: number): Date | null {
  if (window === "all") return null;
  return new Date(nowMs - Number(window) * 86_400_000);
}

const paramsSchema = z.object({
  ruleId: z.string().min(1),
  window: windowSchema.default("30"),
});

// PURA y testeable: valida los query params del endpoint de métricas.
export function parseMetricsQuery(params: URLSearchParams):
  | { ok: true; ruleId: string; window: z.infer<typeof windowSchema> }
  | { ok: false } {
  const parsed = paramsSchema.safeParse({
    ruleId: params.get("ruleId") ?? undefined,
    window: params.get("window") ?? undefined,
  });
  return parsed.success ? { ok: true, ruleId: parsed.data.ruleId, window: parsed.data.window } : { ok: false };
}
