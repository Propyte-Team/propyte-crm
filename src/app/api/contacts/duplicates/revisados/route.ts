// POST /api/contacts/duplicates/revisados — "No es duplicado": el grupo deja de aparecer.
// GET lista las marcadas; DELETE { key } las devuelve a la lista (E7 #977).
// Persistencia: SystemConfig (clave contacts.duplicados_revisados = lista de firmas de grupo).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { CLAVE_REVISADOS, firmaDeGrupo } from "../firma";
import { idsDeFirma, leerRevisados, quitarRevisado, recientes } from "@/lib/contacts/duplicados-revisados";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];
const MAX_FIRMAS = 5000; // tope para que la fila no crezca sin límite

const schema = z.object({ ids: z.array(z.string().min(1)).min(2).max(50) });

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indica al menos dos contactos del grupo" }, { status: 400 });

  const firma = firmaDeGrupo(parsed.data.ids);
  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_REVISADOS } });
  const actuales: string[] = Array.isArray(fila?.value) ? (fila!.value as string[]) : [];
  if (!actuales.includes(firma)) {
    const nuevas = [...actuales, firma].slice(-MAX_FIRMAS);
    await prisma.systemConfig.upsert({
      where: { key: CLAVE_REVISADOS },
      update: { value: nuevas },
      create: { key: CLAVE_REVISADOS, value: nuevas },
    });
    await prisma.auditLog.create({
      data: { userId: session.user.id, action: "UPDATE", entity: "DuplicadosRevisados", entityId: firma.slice(0, 120), changes: { ids: parsed.data.ids } },
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

async function permiso() {
  const session = await getServerSession();
  if (!session?.user) return { res: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return { res: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const p = await permiso();
  if (!p.session) return p.res;
  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_REVISADOS } });
  const firmas = recientes(leerRevisados(fila?.value), 50);
  const ids = [...new Set(firmas.flatMap(idsDeFirma))];
  const contactos = ids.length
    ? await prisma.contact.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } })
    : [];
  const porId = new Map(contactos.map((c) => [c.id, c]));
  const data = firmas.map((key) => ({
    key,
    contacts: idsDeFirma(key).map((id) => porId.get(id) ?? { id, firstName: "(contacto eliminado)", lastName: "", email: null, phone: "" }),
  }));
  return NextResponse.json({ data });
}

const deleteSchema = z.object({ key: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const p = await permiso();
  if (!p.session) return p.res;
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indica el grupo a volver a revisar" }, { status: 400 });

  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_REVISADOS } });
  const { lista, estaba } = quitarRevisado(leerRevisados(fila?.value), parsed.data.key);
  if (estaba) {
    await prisma.systemConfig.update({ where: { key: CLAVE_REVISADOS }, data: { value: lista } });
    await prisma.auditLog.create({
      data: { userId: p.session.user.id, action: "UPDATE", entity: "DuplicadosRevisados", entityId: parsed.data.key.slice(0, 120), changes: { deshecho: true } },
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, estaba });
}
