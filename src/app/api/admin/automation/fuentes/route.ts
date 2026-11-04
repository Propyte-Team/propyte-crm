// GET /api/admin/automation/fuentes — listas para los selectores de reglas y cadencias (E3, 964).
//
// Por qué existe: el constructor de reglas deja de pedir claves ("bienvenida_es", un UUID de
// cadencia) y ofrece listas con nombre. Esta ruta junta, en una sola llamada, lo que el motor
// puede resolver: plantillas (config.template), cadencias (config.planId) y usuarios.
// Permisos: los mismos que `GET /api/admin/automation` (cualquier sesión; sin sesión → 401).
//
// Forma: { data: { plantillas: [{ id, nombre, canal: "WHATSAPP"|"EMAIL", idioma: "ES"|"EN" }],
//                  cadencias: [{ id, nombre }],
//                  usuarios: [{ id, nombre, rol }] } }
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { ROLES_RUTEABLES, ROLES_DE_MANDO, usuarioRuteableWhere } from "@/lib/workflows/ruteables";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const [plantillas, cadencias, usuarios] = await Promise.all([
    // actions.ts resuelve `config.template` con findFirst por id O nombre, activa, sin borrar y en
    // el idioma del contacto, SIN mirar el dueño. Aquí se listan las globales (userId null) y las
    // del propio usuario: las personales de otras personas no se exponen en un selector.
    // SMS no se ofrece: ninguna acción del motor lo envía.
    prisma.userTemplate.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        channel: { in: ["WHATSAPP", "EMAIL"] },
        OR: [{ userId: null }, { userId: session.user.id }],
      },
      select: { id: true, name: true, channel: true, language: true },
      orderBy: { name: "asc" },
    }),
    // ENROLL_PLAN omite los planes inactivos o borrados ("Ya enrolado o plan inactivo").
    prisma.actionPlan.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Quién puede recibir algo: asesores ruteables + mando, con la misma definición que el reparto
    // (ruteables.ts), sin cuentas técnicas (.local).
    prisma.user.findMany({
      where: { role: { in: [...ROLES_RUTEABLES, ...ROLES_DE_MANDO] }, ...usuarioRuteableWhere() },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    data: {
      plantillas: plantillas.map((t) => ({ id: t.id, nombre: t.name, canal: t.channel, idioma: t.language })),
      cadencias: cadencias.map((c) => ({ id: c.id, nombre: c.name })),
      usuarios: usuarios.map((u) => ({ id: u.id, nombre: u.name, rol: u.role })),
    },
  });
}
