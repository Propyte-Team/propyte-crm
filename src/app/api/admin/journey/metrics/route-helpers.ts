import { z } from "zod";

export const windowSchema = z.enum(["7", "30", "90", "all"]);

// PURA y exportada para test: ventana → fecha de corte (null = todo).
export function cutoffFromWindow(window: z.infer<typeof windowSchema>, nowMs: number): Date | null {
  if (window === "all") return null;
  return new Date(nowMs - Number(window) * 86_400_000);
}
