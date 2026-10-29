// ============================================================
// API Route: GET /api/contacts/export?campos=nombre,email,...  (#901)
// Descarga en CSV de TODOS los contactos que el usuario puede ver, con los datos elegidos.
// Solo ADMIN y DIRECTOR. Cada descarga queda en AuditLog (acción EXPORT).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { sumarAlAnd } from "@/lib/api/where-and";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { contactBrandVisibilityWhere } from "@/lib/brands/visibility";
import {
  camposElegidos,
  construirCsv,
  nombreArchivoExport,
  puedeExportarContactos,
  type ContactoExportable,
} from "@/lib/contacts/exportar";

/** Se lee por tandas para no cargar decenas de miles de filas de un golpe. */
const TANDA = 1000;
/** Tope de seguridad: una exportación más grande debe pensarse aparte (no por este botón). */
const MAXIMO = 50_000;

const SELECT_EXPORT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  secondaryPhone: true,
  contactType: true,
  flujo: true, // #948
  contactStatus: true,
  lifecycleStage: true,
  temperature: true,
  score: true,
  urgency: true,
  tags: true,
  leadSource: true,
  leadSourceDetail: true,
  targetPlaza: true,
  residenceCity: true,
  residenceCountry: true,
  nationality: true,
  preferredLanguage: true,
  investmentProfile: true,
  propertyType: true,
  purchaseTimeline: true,
  budgetMin: true,
  budgetMax: true,
  paymentMethod: true,
  preferredZone: true,
  purchaseModality: true,
  rentalStrategy: true,
  doNotContact: true,
  whatsappOptOut: true,
  createdAt: true,
  lastActivityAt: true,
  updatedAt: true,
  assignedTo: { select: { name: true, email: true } },
  brands: { select: { brand: { select: { name: true } } } },
  _count: { select: { deals: true, activities: true } },
} satisfies Prisma.ContactSelect;

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // La UI solo muestra el botón a estos roles; la ruta lo vuelve a exigir (la URL se puede
  // escribir a mano).
  if (!puedeExportarContactos(session.user.role)) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pedidas = (searchParams.get("campos") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const campos = camposElegidos(pedidas);
  if (campos.length === 0) {
    return NextResponse.json({ error: "Elige al menos un dato para descargar" }, { status: 400 });
  }

  // ADMIN y DIRECTOR ven todos los contactos por rol, pero las MARCAS también los acotan (un
  // director sin acceso a Yaxnáh no ve sus leads en la lista): la descarga respeta lo mismo.
  const where: Prisma.ContactWhereInput = { deletedAt: null };
  const visible = await getVisibleBrands(session.user);
  const porMarca = contactBrandVisibilityWhere(session.user, visible);
  if (porMarca) sumarAlAnd(where, porMarca);

  const contactos: ContactoExportable[] = [];
  let cursor: string | undefined;
  while (contactos.length < MAXIMO) {
    const tanda = await prisma.contact.findMany({
      where,
      select: SELECT_EXPORT,
      orderBy: { id: "asc" },
      take: TANDA,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    contactos.push(...(tanda as unknown as ContactoExportable[]));
    if (tanda.length < TANDA) break;
    cursor = tanda[tanda.length - 1].id;
  }
  const truncado = contactos.length >= MAXIMO;

  // Orden de lectura humano en el archivo: lo más reciente primero, como la lista.
  contactos.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Registro de la descarga: es un volcado de datos personales, tiene que quedar quién y qué.
  // Si el registro falla no se entrega el archivo: mejor sin descarga que una descarga sin rastro.
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EXPORT",
      entity: "Contact",
      entityId: "*",
      changes: { contactos: contactos.length, campos: campos.map((c) => c.key), truncado },
    },
  });

  return new NextResponse(construirCsv(contactos, campos), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivoExport()}"`,
      "Cache-Control": "no-store",
      "X-Contactos-Exportados": String(contactos.length),
      ...(truncado ? { "X-Exportacion-Truncada": "1" } : {}),
    },
  });
}
