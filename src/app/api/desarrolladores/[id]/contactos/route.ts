// ============================================================
// API Route: /api/desarrolladores/[id]/contactos (#949)
// GET    - Contactos de la empresa (cualquier usuario con sesión)
// POST   - Asignar un contacto existente a la empresa  { contactId }
// DELETE - Quitarlo de la empresa                      ?contactId=
// ============================================================
//
// Reglas (decisión de sistemas@, 2026-10-29):
// - Todos los roles ven TODOS los contactos de una empresa: nombre, tipo y asesor. Teléfono y
//   email solo salen de los que quien mira puede abrir (mismas puertas que la ficha: rol +
//   marca); de los demás, el nombre va sin liga. La visibilidad por MARCA no se relaja: un
//   contacto de una marca que el usuario no ve ni se nombra, solo se cuenta.
// - Asignar y quitar: quien puede abrir la ficha de ese contacto y tiene el campo «Empresa»
//   editable para su rol. Un asesor, entonces, solo sus contactos. No hace falta poder editar
//   la empresa (eso es solo ADMIN/DIRECTOR/GERENTE).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { withChangeSource } from "@/lib/audit/change-context";
import { resolveCoreFieldAccess, nonEditableKeys } from "@/lib/metadata/core-fields";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { contactBrandVisibilityWhere } from "@/lib/brands/visibility";
import { alcanceListaContactos } from "@/lib/contacts/alcance-lista";
import { nombreDeContacto, rbacPermiteContacto } from "@/lib/contacts/referidos";
import { getContactAccessInfo } from "@/server/contacts";
import {
  contactoDeEmpresaSchema,
  esTablaFaltante,
  type ContactoDeEmpresa,
} from "@/lib/developer-partners/shared";

/** Tope de contactos que lista el cuadro (orden alfabético). */
const MAX_CONTACTOS = 500;

const SELECT_CONTACTO = {
  id: true,
  firstName: true,
  lastName: true,
  contactType: true,
  email: true,
  phone: true,
  assignedToId: true,
  assignedTo: { select: { name: true } },
} as const;

type FilaContacto = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  contactType: string | null;
  email: string | null;
  phone: string | null;
  assignedToId: string | null;
  assignedTo: { name: string | null } | null;
};

type Sesion = { user: { id: string; role: string; plaza: string; name?: string | null } };

function aContactoDeEmpresa(c: FilaContacto, puedeAbrir: boolean): ContactoDeEmpresa {
  return {
    id: c.id,
    nombre: nombreDeContacto(c),
    contactType: c.contactType,
    asesor: c.assignedTo?.name ?? null,
    puedeAbrir,
    // Nada de datos de contacto de una ficha que quien mira no puede abrir.
    email: puedeAbrir ? c.email || null : null,
    phone: puedeAbrir ? c.phone || null : null, // "" es el centinela de «sin teléfono» (#830)
  };
}

async function empresaViva(id: string) {
  return prisma.developerPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
}

/** ¿El rol de la sesión tiene el campo «Empresa» del contacto editable? */
async function campoEmpresaEditable(role: string): Promise<boolean> {
  const access = await resolveCoreFieldAccess("contact", role);
  return !nonEditableKeys("contact", access).has("developerPartnerId");
}

/**
 * Puertas para asignar o quitar: campo editable + poder abrir la ficha del contacto. Devuelve la
 * respuesta de error, o null si se puede.
 */
async function puertaDeContacto(contactId: string, session: Sesion): Promise<NextResponse | null> {
  if (!(await campoEmpresaEditable(session.user.role))) {
    return NextResponse.json({ error: "Tu rol no puede cambiar la empresa de un contacto" }, { status: 403 });
  }
  const acceso = await getContactAccessInfo(contactId, session);
  if (!acceso.ok) {
    return acceso.reason === "forbidden"
      ? NextResponse.json({ error: "Solo puedes cambiar la empresa de tus contactos" }, { status: 403 })
      : NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }
  return null;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    if (!(await empresaViva(id))) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

    const visible = await getVisibleBrands(session.user);
    const porMarca = contactBrandVisibilityWhere(session.user, visible);
    const base = { developerPartnerId: id, deletedAt: null };

    const [filas, total, alcance, puedeAsignar] = await Promise.all([
      prisma.contact.findMany({
        where: porMarca ? { ...base, AND: [porMarca] } : base,
        select: SELECT_CONTACTO,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: MAX_CONTACTOS,
      }),
      prisma.contact.count({ where: base }),
      alcanceListaContactos(session.user),
      campoEmpresaEditable(session.user.role),
    ]);

    // Rol no reconocido (alcance null): ve la lista, pero no abre ninguna ficha (falla cerrado).
    const data = (filas as FilaContacto[]).map((c) =>
      aContactoDeEmpresa(c, alcance !== null && rbacPermiteContacto(c.assignedToId, alcance)),
    );
    return NextResponse.json({
      data,
      // Fuera de las marcas de quien mira, o más allá del tope: se cuentan, no se nombran.
      noListados: Math.max(0, total - data.length),
      puedeAsignar,
    });
  } catch (err) {
    if (esTablaFaltante(err)) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    console.error("[GET /api/desarrolladores/[id]/contactos]", err);
    return NextResponse.json({ error: "Error al listar los contactos de la empresa" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = contactoDeEmpresaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta el contacto" }, { status: 400 });
  const { contactId } = parsed.data;

  try {
    if (!(await empresaViva(id))) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    const bloqueo = await puertaDeContacto(contactId, session as Sesion);
    if (bloqueo) return bloqueo;

    const contacto = await withChangeSource({ source: "ui", actorId: session.user.id }, (tx) =>
      tx.contact.update({ where: { id: contactId }, data: { developerPartnerId: id }, select: SELECT_CONTACTO }),
    );
    return NextResponse.json({ data: aContactoDeEmpresa(contacto as FilaContacto, true) });
  } catch (err) {
    console.error("[POST /api/desarrolladores/[id]/contactos]", err);
    return NextResponse.json({ error: "Error al asignar el contacto" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = contactoDeEmpresaSchema.safeParse({
    contactId: new URL(req.url).searchParams.get("contactId") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Falta el contacto" }, { status: 400 });
  const { contactId } = parsed.data;

  try {
    const bloqueo = await puertaDeContacto(contactId, session as Sesion);
    if (bloqueo) return bloqueo;

    // Solo suelta la liga si de verdad es de ESTA empresa: un cuadro viejo no debe quitarle a un
    // contacto la empresa que alguien más le puso mientras tanto.
    const res = await withChangeSource({ source: "ui", actorId: session.user.id }, (tx) =>
      tx.contact.updateMany({
        where: { id: contactId, developerPartnerId: id, deletedAt: null },
        data: { developerPartnerId: null },
      }),
    );
    if (res.count === 0) {
      return NextResponse.json({ error: "El contacto ya no está en esta empresa" }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/desarrolladores/[id]/contactos]", err);
    return NextResponse.json({ error: "Error al quitar el contacto" }, { status: 500 });
  }
}
