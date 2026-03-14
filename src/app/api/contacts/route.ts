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

// Roles que tienen acceso a todos los contactos
const FULL_ACCESS_ROLES = ["DIRECTOR", "DEVELOPER_EXT"];
// Roles que ven contactos de su plaza
const PLAZA_ACCESS_ROLES = ["GERENTE"];
// Roles que ven contactos de su equipo
const TEAM_ACCESS_ROLES = ["TEAM_LEADER"];
// Roles que solo ven contactos propios
const OWN_ACCESS_ROLES = ["ASESOR_SR", "ASESOR_JR"];
// Roles que pueden ver pero no modificar
const READ_ONLY_ROLES = ["MARKETING", "HOSTESS"];

// Esquema de validación para crear contacto
const createContactSchema = z.object({
  firstName: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).trim(),
  lastName: z.string().min(2, "El apellido debe tener al menos 2 caracteres").max(100).trim(),
  email: z.string().email("Email inválido").toLowerCase().trim().optional().or(z.literal("")),
  phone: z.string().min(10, "El teléfono debe tener al menos 10 dígitos").max(15).trim(),
  secondaryPhone: z.string().max(15).trim().optional().or(z.literal("")),
  contactType: z.enum(["LEAD", "PROSPECTO", "CLIENTE", "INVERSIONISTA", "BROKER_EXTERNO", "REFERIDO"]).optional(),
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

    if (OWN_ACCESS_ROLES.includes(userRole)) {
      // Asesores solo ven sus contactos asignados
      where.assignedToId = userId;
    } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
      // Team leaders ven contactos de su equipo
      const teamMembers = await prisma.user.findMany({
        where: { teamLeaderId: userId },
        select: { id: true },
      });
      const teamIds = [userId, ...teamMembers.map((m) => m.id)];
      where.assignedToId = { in: teamIds };
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
    } else if (READ_ONLY_ROLES.includes(userRole)) {
      // Marketing y Hostess pueden ver todos (sin restricción adicional)
    } else if (!FULL_ACCESS_ROLES.includes(userRole)) {
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
        contactType: data.contactType || "LEAD",
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

    const contact = await prisma.contact.update({
      where: { id },
      data: updateData,
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

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
    await prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error al eliminar contacto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
