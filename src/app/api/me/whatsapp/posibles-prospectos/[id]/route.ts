// «Es prospecto» / «Ignorar» sobre un posible prospecto de MI WhatsApp (2026-10-14, coexistencia PR 2).
// Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §7.
//
// Solo el dueño del número decide: un id de otro asesor responde 404, igual que uno que no existe
// (no se confirma ni que exista).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { ignorePendingProspect, promotePendingProspect } from "@/lib/whatsapp/coex/asesor";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["prospecto", "ignorar"]) });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await props.params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Acción inválida (prospecto | ignorar)." }, { status: 400 });

  const result =
    parsed.data.action === "prospecto"
      ? await promotePendingProspect(id, session.user.id)
      : await ignorePendingProspect(id, session.user.id);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result });
}
