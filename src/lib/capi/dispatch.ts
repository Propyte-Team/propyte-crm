// Dispatcher de conversiones — cola + reintentos con backoff + resultado por plataforma
// (speckit #4 §5.3). Corre en el tick del cron del motor.
import prisma from "@/lib/db";
import { ADAPTERS } from "./adapters";

const MAX_ATTEMPTS = 5;

export async function processPendingConversions(batch = 20): Promise<{ sent: number; partial: number; failed: number }> {
  const pending = await prisma.conversionEvent.findMany({
    where: { status: { in: ["PENDING", "PARTIAL"] }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: batch,
    include: { contact: true },
  });

  let sent = 0, partial = 0, failed = 0;

  for (const event of pending) {
    const previous = (event.results ?? {}) as Record<string, { ok: boolean; detail?: string }>;
    const results: Record<string, { ok: boolean; detail?: string }> = { ...previous };

    for (const platform of event.platforms) {
      if (results[platform]?.ok) continue; // ya enviado en intento previo (idempotencia)
      const adapter = ADAPTERS[platform];
      if (!adapter) {
        results[platform] = { ok: false, detail: "Sin adapter" };
        continue;
      }
      try {
        results[platform] = await adapter(event, event.contact);
      } catch (err) {
        results[platform] = { ok: false, detail: String(err instanceof Error ? err.message : err).slice(0, 300) };
      }
    }

    const okCount = event.platforms.filter((p) => results[p]?.ok).length;
    const allOk = okCount === event.platforms.length;
    const noneOk = okCount === 0;
    const attempts = event.attempts + 1;
    // Stubs (GOOGLE/LINKEDIN pendientes) no deben reintentar para siempre: si lo único
    // que falla son adapters no activados, se marca PARTIAL terminal en el último intento.
    const status = allOk ? "SENT" : attempts >= MAX_ATTEMPTS ? (noneOk ? "FAILED" : "PARTIAL") : "PARTIAL";

    await prisma.conversionEvent.update({
      where: { id: event.id },
      data: {
        status,
        attempts,
        results,
        sentAt: allOk ? new Date() : event.sentAt,
        lastError: allOk
          ? null
          : event.platforms
              .filter((p) => !results[p]?.ok)
              .map((p) => `${p}: ${results[p]?.detail ?? "?"}`)
              .join(" | ")
              .slice(0, 1000),
      },
    });

    if (allOk) sent++;
    else if (noneOk) failed++;
    else partial++;
  }

  return { sent, partial, failed };
}
