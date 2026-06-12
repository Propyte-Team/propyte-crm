// Webhook Hub→CRM: notificación de cambio de status de unidad.
// Emitido por hub-webhook.ts cuando hold/confirm/release/expire ocurre en el Hub.
// Auth: header x-hub-secret contra HUB_WEBHOOK_SECRET.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  event: z.literal("unit.status_changed"),
  unitId: z.string(),
  newStatus: z.string(),
  crmDealId: z.string().nullable().optional(),
  ts: z.string(),
});

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-hub-secret")?.trim();
  const expected = process.env.HUB_WEBHOOK_SECRET?.trim();

  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { unitId, newStatus, crmDealId, ts } = parsed.data;

  // Si hay un deal asociado, guardamos el status de la unidad del Hub en el JSONB
  // `custom` del deal (campo sancionado para datos no-core; ver speckit §5.3 "custom jsonb").
  // No existe columna dedicada `hubUnitStatus` todavía (decisión Ticket 0.1).
  if (crmDealId) {
    const deal = await prisma.deal
      .findFirst({ where: { id: crmDealId, deletedAt: null }, select: { custom: true } })
      .catch(() => null);
    if (deal) {
      const custom = (deal.custom && typeof deal.custom === "object" ? deal.custom : {}) as Record<string, unknown>;
      await prisma.deal
        .update({
          where: { id: crmDealId },
          data: {
            custom: { ...custom, hubUnitId: unitId, hubUnitStatus: newStatus, hubUnitStatusAt: ts },
            updatedAt: new Date(),
          },
        })
        .catch(() => null);
    }
  }

  // Log de actividad
  console.info(`[hub-unit webhook] unit=${unitId} status=${newStatus} deal=${crmDealId ?? "—"}`);

  return NextResponse.json({ ok: true });
}
