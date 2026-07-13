// ============================================================
// API Route: /api/contacts
// Gestión de contactos/leads del CRM
// GET    - Listar contactos con paginación, búsqueda y filtros
// POST   - Crear un nuevo contacto
// PUT    - Actualizar un contacto existente
// DELETE - Eliminar (soft delete) un contacto
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { resolveCoreFieldAccess, nonEditableKeys } from "@/lib/metadata/core-fields";
import { LIFECYCLE_ORDER, CONTACT_STATUS_ORDER } from "@/lib/constants";
import { withChangeSource } from "@/lib/audit/change-context";

// Roles que tienen acceso a todos los contactos
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];
// Roles que ven contactos de su plaza
const PLAZA_ACCESS_ROLES = ["ADMIN", "GERENTE"];
// Roles que ven contactos de su equipo
const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"];
// Roles que solo ven contactos propios
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];
// Roles que pueden ver pero no modificar
const READ_ONLY_ROLES = ["MARKETING", "HOSTESS", "MANTENIMIENTO"];

// Esquema de validación para crear contacto
const createContactSchema = z.object({
  firstName: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).trim(),
  lastName: z.string().min(2, "El apellido debe tener al menos 2 caracteres").max(100).trim(),
  email: z.string().email("Email inválido").toLowerCase().trim().optional().or(z.literal("")),
  phone: z.string().min(10, "El teléfono debe tener al menos 10 dígitos").max(15).trim(),
  secondaryPhone: z.string().max(15).trim().optional().or(z.literal("")),
  contactType: z.enum(["LEAD", "PROSPECTO", "CLIENTE", "INVERSIONISTA", "BROKER_EXTERNO", "REFERIDO", "COMPRADOR", "REFERIDOR", "EMPLEO"]).optional(),
  // Única fuente de verdad = CONTACT_STATUS_ORDER (constants.ts) — evita el bug clásico
  // "enum Prisma ≠ enum zod" (un valor válido en BD pero ausente aquí se rechaza en silencio).
  contactStatus: z.enum(CONTACT_STATUS_ORDER).optional(),
  lifecycleStage: z.enum(["SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR"]).nullable().optional(),
  urgency: z.enum(["ALTA", "MEDIA", "BAJA"]).optional().nullable(),
  leadSource: z.enum([
    "WALK_IN", "FACEBOOK_ADS", "GOOGLE_ADS", "INSTAGRAM", "PORTAL_INMOBILIARIO",
    "REFERIDO_CLIENTE", "REFERIDO_BROKER", "LLAMADA_FRIA", "EVENTO", "WEBSITE", "WHATSAPP", "OTRO",
  ]),
  leadSourceDetail: z.string().max(200).optional(),
  temperature: z.enum(["HOT", "WARM", "COLD", "DEAD"]).optional(),
  investmentProfile: z.enum(["END_USER", "INVESTOR_RENTAL", "INVESTOR_FLIP", "INVESTOR_LAND", "MIXED"]).optional().nullable(),
  propertyType: z.enum(["DEPARTAMENTO", "CASA", "TERRENO", "MACROLOTE", "LOCAL_COMERCIAL", "OTRO"]).optional().nullable(),
  budgetMin: z.number().positive().optional().nullable(),
  budgetMax: z.number().positive().optional().nullable(),
  preferredZone: z.string().max(200).optional(),
  assignedToId: z.string().uuid().optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  residenceCity: z.string().max(100).optional(),
  residenceCountry: z.string().max(100).optional(),
  nationality: z.string().max(100).optional(),
  preferredLanguage: z.enum(["ES", "EN"]).optional(),
  purchaseTimeline: z.enum(["IMMEDIATE", "ONE_TO_THREE_MONTHS", "THREE_TO_SIX_MONTHS", "SIX_PLUS_MONTHS"]).optional().nullable(),
  paymentMethod: z.enum(["CONTADO", "CREDITO_HIPOTECARIO", "FINANCIAMIENTO_DIRECTO", "MIXTO"]).optional().nullable(),
  purchaseModality: z.enum(["PREVENTA", "ENTREGA_INMEDIATA", "REVENTA", "ABIERTO"]).optional().nullable(),
  rentalStrategy: z.enum(["LONG_TERM", "AIRBNB", "BOTH", "NA"]).optional().nullable(),
});

/**
 * GET /api/contacts
 * Lista contactos con paginación, búsqueda y filtros.
 * Soporta: ?search=, ?source=, ?temperature=, ?type=, ?assignedTo=, ?page=, ?pageSize=
 * El acceso se filtra según el rol del usuario (RBAC).
 */
export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parámetros de paginación
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20")));
    const skip = (page - 1) * pageSize;

    // Parámetros de filtro
    const search = searchParams.get("search") || undefined;
    const source = searchParams.get("source") || undefined;
    const temperature = searchParams.get("temperature") || undefined;
    const contactType = searchParams.get("type") || undefined;
    const contactStatus = searchParams.get("status") || undefined;
    const lifecycleStage = searchParams.get("lifecycle") || undefined;
    const assignedToId = searchParams.get("assignedTo") || undefined;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

    // Construir condiciones de filtro
    const where: Prisma.ContactWhereInput = {
      deletedAt: null,
    };

    // Filtrar por acceso según rol (RBAC)
    const userRole = session.user.role;
    const userId = session.user.id;

    // IMPORTANTE: el orden importa. ADMIN pertenece a varios sets (FULL/PLAZA/TEAM),
    // así que FULL_ACCESS debe evaluarse PRIMERO para no caer en una rama restrictiva.
    // (Bug previo: ADMIN caía en la rama TEAM y solo veía sus propios contactos →
    //  el dropdown de "Crear Deal" salía vacío aunque la lista server-side sí mostraba todo.)
    if (FULL_ACCESS_ROLES.includes(userRole) || READ_ONLY_ROLES.includes(userRole)) {
      // Acceso total / solo lectura global: sin filtro adicional
    } else if (PLAZA_ACCESS_ROLES.includes(userRole)) {
      // Gerente ve contactos de asesores de su plaza
      const plazaUsers = await prisma.user.findMany({
        where: { plaza: session.user.plaza as any, isActive: true },
        select: { id: true },
      });
      const plazaUserIds = plazaUsers.map((u) => u.id);
      where.OR = [
        { assignedToId: { in: plazaUserIds } },
        { assignedToId: null },
      ];
    } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
      // Team leaders ven contactos de su equipo
      const teamMembers = await prisma.user.findMany({
        where: { teamLeaderId: userId },
        select: { id: true },
      });
      const teamIds = [userId, ...teamMembers.map((m) => m.id)];
      where.assignedToId = { in: teamIds };
    } else if (OWN_ACCESS_ROLES.includes(userRole)) {
      // Asesores solo ven sus contactos asignados
      where.assignedToId = userId;
    } else {
      // Roles no reconocidos no ven nada
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    // Filtro de búsqueda por nombre, email o teléfono (insensible a mayúsculas)
    if (search) {
      const searchCondition: Prisma.ContactWhereInput = {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
        ],
      };
      // Combinar con filtros existentes usando AND
      if (where.OR) {
        where.AND = [{ OR: where.OR }, searchCondition];
        delete where.OR;
      } else {
        where.AND = [searchCondition];
      }
    }

    // Filtros específicos
    if (source) {
      where.leadSource = source as any;
    }
    if (temperature) {
      where.temperature = temperature as any;
    }
    if (contactType) {
      where.contactType = contactType as any;
    }
    if (contactStatus) {
      where.contactStatus = contactStatus as any;
    }
    if (lifecycleStage && (LIFECYCLE_ORDER as readonly string[]).includes(lifecycleStage)) {
      where.lifecycleStage = lifecycleStage as never;
    }
    if (assignedToId) {
      where.assignedToId = assignedToId;
    }

    // Ejecutar consulta con paginación
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          _count: { select: { deals: true, activities: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
      }),
      prisma.contact.count({ where }),
    ]);

    return NextResponse.json({
      data: contacts,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Error al listar contactos:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/contacts
 * Crea un nuevo contacto con validación Zod.
 * Verifica duplicados por teléfono.
 */
export async function POST(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Verificar permisos de creación
    const userRole = session.user.role;
    const canCreate = [
      ...FULL_ACCESS_ROLES,
      ...PLAZA_ACCESS_ROLES,
      ...TEAM_ACCESS_ROLES,
      ...OWN_ACCESS_ROLES,
      "HOSTESS",
    ].includes(userRole);

    if (!canCreate) {
      return NextResponse.json({ error: "No tienes permiso para crear contactos" }, { status: 403 });
    }

    // Parsear y validar el body
    const body = await request.json();
    const validation = createContactSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Verificar duplicado por teléfono
    const existing = await prisma.contact.findFirst({
      where: { phone: data.phone, deletedAt: null },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Ya existe un contacto con este número de teléfono" },
        { status: 409 }
      );
    }

    // Validar que el asesor asignado exista antes de crear (BUG-04: evita FK P2003 → 500 opaco)
    if (data.assignedToId) {
      const assignee = await prisma.user.findUnique({
        where: { id: data.assignedToId },
        select: { id: true },
      });
      if (!assignee) {
        return NextResponse.json(
          { error: "El asesor asignado no existe" },
          { status: 400 }
        );
      }
    }

    // Si no se asignó a nadie, asignar al usuario actual (si es asesor/TL)
    const assignedToId =
      data.assignedToId ||
      ([...OWN_ACCESS_ROLES, ...TEAM_ACCESS_ROLES].includes(userRole) ? session.user.id : undefined);

    // Crear el contacto
    const contact = await prisma.contact.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone,
        secondaryPhone: data.secondaryPhone || null,
        contactType: data.contactType || "COMPRADOR",
        leadSource: data.leadSource,
        leadSourceDetail: data.leadSourceDetail || null,
        temperature: data.temperature || "COLD",
        investmentProfile: data.investmentProfile || undefined,
        propertyType: data.propertyType || undefined,
        budgetMin: data.budgetMin || undefined,
        budgetMax: data.budgetMax || undefined,
        preferredZone: data.preferredZone || null,
        assignedToId: assignedToId || null,
        tags: data.tags || [],
        residenceCity: data.residenceCity || null,
        residenceCountry: data.residenceCountry || null,
        nationality: data.nationality || null,
        preferredLanguage: data.preferredLanguage || "ES",
        purchaseTimeline: data.purchaseTimeline || undefined,
        paymentMethod: data.paymentMethod || undefined,
        purchaseModality: data.purchaseModality || undefined,
        rentalStrategy: data.rentalStrategy || undefined,
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({ data: contact }, { status: 201 });
  } catch (error) {
    console.error("Error al crear contacto:", error);
    // Mapear errores conocidos de Prisma a respuestas claras (BUG-04: no más 500 opacos por FK)
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "Referencia inválida: el asesor o una relación no existe" },
          { status: 400 }
        );
      }
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "Ya existe un contacto con esos datos únicos" },
          { status: 409 }
        );
      }
    }
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/contacts?id=<contactId>
 * Actualiza un contacto existente.
 */
export async function PUT(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "ID de contacto requerido" }, { status: 400 });
    }

    // Verificar que el contacto existe
    const existing = await prisma.contact.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    // Parsear y validar el body (parcial)
    const body = await request.json();
    const validation = createContactSchema.partial().safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Field-level security: bloquear edición de campos core sin acceso EDIT para el rol.
    // La UI no es la frontera de seguridad — se valida también aquí.
    const access = await resolveCoreFieldAccess("contact", session.user.role);
    const locked = nonEditableKeys("contact", access);
    const attempted = Object.keys(data).filter((k) => locked.has(k));
    if (attempted.length > 0) {
      return NextResponse.json(
        { error: "No tienes permiso para editar estos campos", fields: attempted },
        { status: 403 }
      );
    }

    // Si se cambia el teléfono, verificar duplicado
    if (data.phone && data.phone !== existing.phone) {
      const duplicate = await prisma.contact.findFirst({
        where: { phone: data.phone, deletedAt: null, id: { not: id } },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "Ya existe un contacto con este número de teléfono" },
          { status: 409 }
        );
      }
    }

    // Construir objeto de actualización
    const updateData: Prisma.ContactUpdateInput = {};
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.email !== undefined) updateData.email = data.email || null;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.secondaryPhone !== undefined) updateData.secondaryPhone = data.secondaryPhone || null;
    if (data.contactType !== undefined) updateData.contactType = data.contactType;
    if (data.contactStatus !== undefined) updateData.contactStatus = data.contactStatus;
    if (data.urgency !== undefined) updateData.urgency = data.urgency;
    if (data.leadSource !== undefined) updateData.leadSource = data.leadSource;
    if (data.leadSourceDetail !== undefined) updateData.leadSourceDetail = data.leadSourceDetail || null;
    if (data.temperature !== undefined) updateData.temperature = data.temperature;
    if (data.investmentProfile !== undefined) updateData.investmentProfile = data.investmentProfile;
    if (data.propertyType !== undefined) updateData.propertyType = data.propertyType;
    if (data.purchaseTimeline !== undefined) updateData.purchaseTimeline = data.purchaseTimeline;
    if (data.budgetMin !== undefined) updateData.budgetMin = data.budgetMin;
    if (data.budgetMax !== undefined) updateData.budgetMax = data.budgetMax;
    if (data.paymentMethod !== undefined) updateData.paymentMethod = data.paymentMethod;
    if (data.preferredZone !== undefined) updateData.preferredZone = data.preferredZone || null;
    if (data.purchaseModality !== undefined) updateData.purchaseModality = data.purchaseModality;
    if (data.rentalStrategy !== undefined) updateData.rentalStrategy = data.rentalStrategy;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.residenceCity !== undefined) updateData.residenceCity = data.residenceCity || null;
    if (data.residenceCountry !== undefined) updateData.residenceCountry = data.residenceCountry || null;
    if (data.nationality !== undefined) updateData.nationality = data.nationality || null;
    if (data.preferredLanguage !== undefined) updateData.preferredLanguage = data.preferredLanguage;
    if (data.assignedToId !== undefined) {
      updateData.assignedTo = data.assignedToId
        ? { connect: { id: data.assignedToId } }
        : { disconnect: true };
    }

    // Override manual de lifecycle: enruta por el helper para emitir evento + Activity.
    // No se agrega lifecycleStage a updateData (el helper lo persiste directamente).
    if (data.lifecycleStage !== undefined && data.lifecycleStage !== null) {
      const current = await prisma.contact.findUnique({ where: { id }, select: { lifecycleStage: true } });
      const { applyLifecycleTransition } = await import("@/lib/lifecycle/apply");
      await applyLifecycleTransition({
        contactId: id,
        from: current?.lifecycleStage ?? null,
        to: data.lifecycleStage,
        actorUserId: session.user.id,
        auto: false, // manual: cualquier dirección permitida
      });
    }

    const contact = await withChangeSource(
      { source: "ui", actorId: session.user.id },
      (tx) =>
        tx.contact.update({
          where: { id },
          data: updateData,
          include: {
            assignedTo: { select: { id: true, name: true, email: true } },
          },
        })
    );

    return NextResponse.json({ data: contact });
  } catch (error) {
    console.error("Error al actualizar contacto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/contacts?id=<contactId>
 * Soft delete de un contacto (establece deletedAt).
 */
export async function DELETE(request: NextRequest) {
  try {
    // Verificar autenticación
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "ID de contacto requerido" }, { status: 400 });
    }

    // Solo Director, Gerente y Developer pueden eliminar
    const canDelete = [...FULL_ACCESS_ROLES, ...PLAZA_ACCESS_ROLES].includes(session.user.role);
    if (!canDelete) {
      return NextResponse.json({ error: "No tienes permiso para eliminar contactos" }, { status: 403 });
    }

    const existing = await prisma.contact.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    // Soft delete
    await withChangeSource(
      { source: "ui", actorId: session.user.id },
      (tx) => tx.contact.update({ where: { id }, data: { deletedAt: new Date() } })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error al eliminar contacto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
