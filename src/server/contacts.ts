"use server";

// ============================================================
// Server Actions: Contactos CRUD
// Operaciones del lado del servidor para gestión de contactos
// ============================================================

import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { dispatchWebhook } from "@/lib/webhooks/dispatcher";

// Roles con acceso total a todos los contactos
const FULL_ACCESS_ROLES = ["DIRECTOR", "DEVELOPER_EXT"];
// Roles que ven contactos de su plaza
const PLAZA_ACCESS_ROLES = ["GERENTE"];
// Roles que ven contactos de su equipo
const TEAM_ACCESS_ROLES = ["TEAM_LEADER"];
// Roles que solo ven contactos propios
const OWN_ACCESS_ROLES = ["ASESOR_SR", "ASESOR_JR"];

// --- Esquema de validación para crear/editar contacto ---
const contactSchema = z.object({
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
  purchaseTimeline: z.enum(["IMMEDIATE", "ONE_TO_THREE_MONTHS", "THREE_TO_SIX_MONTHS", "SIX_PLUS_MONTHS"]).optional().nullable(),
  budgetMin: z.number().positive().optional().nullable(),
  budgetMax: z.number().positive().optional().nullable(),
  paymentMethod: z.enum(["CONTADO", "CREDITO_HIPOTECARIO", "FINANCIAMIENTO_DIRECTO", "MIXTO"]).optional().nullable(),
  preferredZone: z.string().max(200).optional(),
  purchaseModality: z.enum(["PREVENTA", "ENTREGA_INMEDIATA", "REVENTA", "ABIERTO"]).optional().nullable(),
  rentalStrategy: z.enum(["LONG_TERM", "AIRBNB", "BOTH", "NA"]).optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  residenceCity: z.string().max(100).optional(),
  residenceCountry: z.string().max(100).optional(),
  nationality: z.string().max(100).optional(),
  preferredLanguage: z.enum(["ES", "EN"]).optional(),
});

// --- Tipo para los filtros de búsqueda ---
interface ContactFilters {
  search?: string;
  source?: string;
  temperature?: string;
  type?: string;
  assignedTo?: string;
  plaza?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Construye el filtro RBAC según el rol del usuario.
 * Director ve todo, Gerente ve su plaza, TL ve su equipo, Asesor ve solo asignados.
 */
async function buildRbacFilter(session: {
  user: { id: string; role: string; plaza: string };
}): Promise<Prisma.ContactWhereInput> {
  const { id: userId, role: userRole, plaza: userPlaza } = session.user;

  if (FULL_ACCESS_ROLES.includes(userRole)) {
    // Acceso total
    return {};
  }

  if (PLAZA_ACCESS_ROLES.includes(userRole)) {
    // Gerente ve contactos asignados a asesores de su plaza
    const plazaUsers = await prisma.user.findMany({
      where: { plaza: userPlaza as any, isActive: true },
      select: { id: true },
    });
    const plazaUserIds = plazaUsers.map((u) => u.id);
    return {
      OR: [
        { assignedToId: { in: plazaUserIds } },
        { assignedToId: null },
      ],
    };
  }

  if (TEAM_ACCESS_ROLES.includes(userRole)) {
    // Team Leader ve contactos de su equipo
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: userId },
      select: { id: true },
    });
    const teamIds = [userId, ...teamMembers.map((m) => m.id)];
    return { assignedToId: { in: teamIds } };
  }

  if (OWN_ACCESS_ROLES.includes(userRole)) {
    // Asesor solo ve sus contactos asignados
    return { assignedToId: userId };
  }

  // Roles de solo lectura (MARKETING, HOSTESS) ven todo
  return {};
}

/**
 * Obtiene lista paginada de contactos con búsqueda y filtros.
 * Aplica RBAC según el rol del usuario autenticado.
 */
export async function getContacts(filters: ContactFilters = {}) {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("No autorizado");
  }

  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
  const skip = (page - 1) * pageSize;

  // Construir condiciones base
  const where: Prisma.ContactWhereInput = {
    deletedAt: null,
  };

  // Aplicar filtro RBAC
  const rbacFilter = await buildRbacFilter(session as any);
  Object.assign(where, rbacFilter);

  // Búsqueda por nombre, email o teléfono
  if (filters.search) {
    where.AND = [
      {
        OR: [
          { firstName: { contains: filters.search, mode: "insensitive" } },
          { lastName: { contains: filters.search, mode: "insensitive" } },
          { email: { contains: filters.search, mode: "insensitive" } },
          { phone: { contains: filters.search } },
        ],
      },
    ];
  }

  // Filtros específicos
  if (filters.source) {
    where.leadSource = filters.source as any;
  }
  if (filters.temperature) {
    where.temperature = filters.temperature as any;
  }
  if (filters.type) {
    where.contactType = filters.type as any;
  }
  if (filters.assignedTo) {
    where.assignedToId = filters.assignedTo;
  }

  // Ejecutar consulta paginada
  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        _count: { select: { deals: true, activities: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    contacts,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Obtiene un contacto por ID con todas sus relaciones.
 * Aplica RBAC para verificar acceso.
 */
export async function getContact(id: string) {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("No autorizado");
  }

  const contact = await prisma.contact.findFirst({
    where: { id, deletedAt: null },
    include: {
      assignedTo: { select: { id: true, name: true, email: true, phone: true } },
      deals: {
        where: { deletedAt: null },
        include: {
          assignedTo: { select: { id: true, name: true } },
          development: { select: { id: true, name: true } },
          unit: { select: { id: true, unitNumber: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      activities: {
        where: { deletedAt: null },
        include: {
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      walkIns: {
        where: { deletedAt: null },
        include: {
          hostess: { select: { id: true, name: true } },
          assignedAdvisor: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!contact) {
    throw new Error("Contacto no encontrado");
  }

  // Verificar acceso RBAC
  const rbacFilter = await buildRbacFilter(session as any);
  if (rbacFilter.assignedToId) {
    // Verificar que el usuario tiene acceso a este contacto
    if (typeof rbacFilter.assignedToId === "string") {
      if (contact.assignedToId !== rbacFilter.assignedToId) {
        throw new Error("No tienes acceso a este contacto");
      }
    } else if (rbacFilter.assignedToId && "in" in rbacFilter.assignedToId) {
      const allowedIds = rbacFilter.assignedToId.in as string[];
      if (contact.assignedToId && !allowedIds.includes(contact.assignedToId)) {
        throw new Error("No tienes acceso a este contacto");
      }
    }
  }

  return contact;
}

/**
 * Crea un nuevo contacto con validación Zod.
 * Si no se asigna a un asesor, aplica round-robin dentro del equipo del usuario.
 */
export async function createContact(data: z.infer<typeof contactSchema>) {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("No autorizado");
  }

  // Validar datos
  const validation = contactSchema.safeParse(data);
  if (!validation.success) {
    return { error: "Datos inválidos", details: validation.error.flatten() };
  }

  const validData = validation.data;

  // Verificar duplicado por teléfono
  const existing = await prisma.contact.findFirst({
    where: { phone: validData.phone, deletedAt: null },
  });
  if (existing) {
    return { error: "Ya existe un contacto con este número de teléfono" };
  }

  // Auto-asignación round-robin si no se especificó asesor
  let assignedToId = validData.assignedToId || null;
  if (!assignedToId) {
    assignedToId = await roundRobinAssign(session.user.id);
  }

  // Crear el contacto en la base de datos
  const contact = await prisma.contact.create({
    data: {
      firstName: validData.firstName,
      lastName: validData.lastName,
      email: validData.email || null,
      phone: validData.phone,
      secondaryPhone: validData.secondaryPhone || null,
      contactType: validData.contactType || "LEAD",
      leadSource: validData.leadSource,
      leadSourceDetail: validData.leadSourceDetail || null,
      temperature: validData.temperature || "COLD",
      investmentProfile: validData.investmentProfile || undefined,
      propertyType: validData.propertyType || undefined,
      purchaseTimeline: validData.purchaseTimeline || undefined,
      budgetMin: validData.budgetMin || undefined,
      budgetMax: validData.budgetMax || undefined,
      paymentMethod: validData.paymentMethod || undefined,
      preferredZone: validData.preferredZone || null,
      purchaseModality: validData.purchaseModality || undefined,
      rentalStrategy: validData.rentalStrategy || undefined,
      assignedToId: assignedToId,
      tags: validData.tags || [],
      residenceCity: validData.residenceCity || null,
      residenceCountry: validData.residenceCountry || null,
      nationality: validData.nationality || null,
      preferredLanguage: validData.preferredLanguage || "ES",
    },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  // Disparar webhook de contacto creado (fire-and-forget, no bloquea la respuesta)
  dispatchWebhook("contact.created", { contact });

  return { contact };
}

/**
 * Actualiza un contacto existente con validación Zod.
 */
export async function updateContact(id: string, data: Partial<z.infer<typeof contactSchema>>) {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("No autorizado");
  }

  // Verificar que el contacto existe
  const existing = await prisma.contact.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) {
    throw new Error("Contacto no encontrado");
  }

  // Validar datos parciales
  const validation = contactSchema.partial().safeParse(data);
  if (!validation.success) {
    return { error: "Datos inválidos", details: validation.error.flatten() };
  }

  const validData = validation.data;

  // Si se cambia el teléfono, verificar duplicado
  if (validData.phone && validData.phone !== existing.phone) {
    const duplicate = await prisma.contact.findFirst({
      where: { phone: validData.phone, deletedAt: null, id: { not: id } },
    });
    if (duplicate) {
      return { error: "Ya existe un contacto con este número de teléfono" };
    }
  }

  // Construir objeto de actualización limpio
  const updateData: Prisma.ContactUpdateInput = {};
  if (validData.firstName !== undefined) updateData.firstName = validData.firstName;
  if (validData.lastName !== undefined) updateData.lastName = validData.lastName;
  if (validData.email !== undefined) updateData.email = validData.email || null;
  if (validData.phone !== undefined) updateData.phone = validData.phone;
  if (validData.secondaryPhone !== undefined) updateData.secondaryPhone = validData.secondaryPhone || null;
  if (validData.contactType !== undefined) updateData.contactType = validData.contactType;
  if (validData.leadSource !== undefined) updateData.leadSource = validData.leadSource;
  if (validData.leadSourceDetail !== undefined) updateData.leadSourceDetail = validData.leadSourceDetail || null;
  if (validData.temperature !== undefined) updateData.temperature = validData.temperature;
  if (validData.investmentProfile !== undefined) updateData.investmentProfile = validData.investmentProfile;
  if (validData.propertyType !== undefined) updateData.propertyType = validData.propertyType;
  if (validData.purchaseTimeline !== undefined) updateData.purchaseTimeline = validData.purchaseTimeline;
  if (validData.budgetMin !== undefined) updateData.budgetMin = validData.budgetMin;
  if (validData.budgetMax !== undefined) updateData.budgetMax = validData.budgetMax;
  if (validData.paymentMethod !== undefined) updateData.paymentMethod = validData.paymentMethod;
  if (validData.preferredZone !== undefined) updateData.preferredZone = validData.preferredZone || null;
  if (validData.purchaseModality !== undefined) updateData.purchaseModality = validData.purchaseModality;
  if (validData.rentalStrategy !== undefined) updateData.rentalStrategy = validData.rentalStrategy;
  if (validData.tags !== undefined) updateData.tags = validData.tags;
  if (validData.residenceCity !== undefined) updateData.residenceCity = validData.residenceCity || null;
  if (validData.residenceCountry !== undefined) updateData.residenceCountry = validData.residenceCountry || null;
  if (validData.nationality !== undefined) updateData.nationality = validData.nationality || null;
  if (validData.preferredLanguage !== undefined) updateData.preferredLanguage = validData.preferredLanguage;
  if (validData.assignedToId !== undefined) {
    updateData.assignedTo = validData.assignedToId
      ? { connect: { id: validData.assignedToId } }
      : { disconnect: true };
  }

  const contact = await prisma.contact.update({
    where: { id },
    data: updateData,
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  // Disparar webhook de contacto actualizado (fire-and-forget, no bloquea la respuesta)
  dispatchWebhook("contact.updated", { contact });

  return { contact };
}

/**
 * Eliminación suave de un contacto (establece deletedAt).
 */
export async function deleteContact(id: string) {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("No autorizado");
  }

  // Verificar permisos: solo DIRECTOR, GERENTE y DEVELOPER_EXT pueden eliminar
  const canDelete = [...FULL_ACCESS_ROLES, ...PLAZA_ACCESS_ROLES].includes(session.user.role);
  if (!canDelete) {
    throw new Error("No tienes permiso para eliminar contactos");
  }

  const existing = await prisma.contact.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) {
    throw new Error("Contacto no encontrado");
  }

  // Soft delete: marcar como eliminado
  await prisma.contact.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { success: true };
}

/**
 * Importa contactos desde una cadena CSV.
 * Detecta duplicados por teléfono. Retorna conteo de éxitos/errores.
 */
export async function importContactsFromCSV(csvData: string) {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("No autorizado");
  }

  // Solo roles con permisos de importación
  const canImport = [...FULL_ACCESS_ROLES, ...PLAZA_ACCESS_ROLES, ...TEAM_ACCESS_ROLES].includes(session.user.role);
  if (!canImport) {
    throw new Error("No tienes permiso para importar contactos");
  }

  const lines = csvData.trim().split("\n");
  if (lines.length < 2) {
    return { error: "El archivo CSV debe tener al menos una fila de encabezados y una de datos" };
  }

  // Parsear encabezados (normalizar a minúsculas sin espacios)
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));

  // Mapeo de columnas CSV a campos del modelo
  const columnMap: Record<string, string> = {
    nombre: "firstName",
    first_name: "firstName",
    firstname: "firstName",
    apellido: "lastName",
    last_name: "lastName",
    lastname: "lastName",
    telefono: "phone",
    phone: "phone",
    tel: "phone",
    email: "email",
    correo: "email",
    fuente: "leadSource",
    source: "leadSource",
    lead_source: "leadSource",
    temperatura: "temperature",
    temperature: "temperature",
    ciudad: "residenceCity",
    city: "residenceCity",
    pais: "residenceCountry",
    country: "residenceCountry",
  };

  // Detectar índices de columnas
  const fieldIndices: Record<string, number> = {};
  headers.forEach((header, index) => {
    const mappedField = columnMap[header];
    if (mappedField) {
      fieldIndices[mappedField] = index;
    }
  });

  // Mapeo de fuentes CSV a enum LeadSource
  const sourceMap: Record<string, string> = {
    "walk-in": "WALK_IN",
    "walk_in": "WALK_IN",
    walkin: "WALK_IN",
    facebook: "FACEBOOK_ADS",
    "facebook_ads": "FACEBOOK_ADS",
    google: "GOOGLE_ADS",
    "google_ads": "GOOGLE_ADS",
    instagram: "INSTAGRAM",
    portal: "PORTAL_INMOBILIARIO",
    referido: "REFERIDO_CLIENTE",
    referral: "REFERIDO_CLIENTE",
    llamada: "LLAMADA_FRIA",
    evento: "EVENTO",
    website: "WEBSITE",
    whatsapp: "WHATSAPP",
    otro: "OTRO",
    other: "OTRO",
  };

  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  // Procesar cada fila de datos
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parsear valores de la fila (manejo básico de CSV)
    const values = line.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));

    try {
      const firstName = fieldIndices.firstName !== undefined ? values[fieldIndices.firstName] : "";
      const lastName = fieldIndices.lastName !== undefined ? values[fieldIndices.lastName] : "";
      const phone = fieldIndices.phone !== undefined ? values[fieldIndices.phone] : "";
      const email = fieldIndices.email !== undefined ? values[fieldIndices.email] : "";
      const sourceRaw = fieldIndices.leadSource !== undefined ? values[fieldIndices.leadSource]?.toLowerCase() : "";
      const residenceCity = fieldIndices.residenceCity !== undefined ? values[fieldIndices.residenceCity] : "";
      const residenceCountry = fieldIndices.residenceCountry !== undefined ? values[fieldIndices.residenceCountry] : "";

      // Validación mínima
      if (!firstName || !phone) {
        errors++;
        errorDetails.push(`Fila ${i + 1}: nombre o teléfono vacío`);
        continue;
      }

      // Verificar duplicado por teléfono
      const existing = await prisma.contact.findFirst({
        where: { phone, deletedAt: null },
      });
      if (existing) {
        duplicates++;
        continue;
      }

      // Determinar fuente del lead
      const leadSource = sourceMap[sourceRaw] || "OTRO";

      // Crear contacto
      await prisma.contact.create({
        data: {
          firstName,
          lastName: lastName || "Sin apellido",
          phone,
          email: email || null,
          leadSource: leadSource as any,
          contactType: "LEAD",
          temperature: "COLD",
          preferredLanguage: "ES",
          tags: [],
          residenceCity: residenceCity || null,
          residenceCountry: residenceCountry || null,
          assignedToId: session.user.id,
        },
      });
      imported++;
    } catch (err) {
      errors++;
      errorDetails.push(`Fila ${i + 1}: ${err instanceof Error ? err.message : "Error desconocido"}`);
    }
  }

  return { imported, duplicates, errors, errorDetails };
}

/**
 * Asignación round-robin de contacto dentro del equipo del usuario.
 * Busca el asesor con menos contactos asignados activos.
 */
async function roundRobinAssign(userId: string): Promise<string> {
  // Obtener información del usuario actual
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, teamLeaderId: true },
  });

  if (!currentUser) return userId;

  // Si es TL, asignar entre su equipo
  if (currentUser.role === "TEAM_LEADER") {
    const teamMembers = await prisma.user.findMany({
      where: {
        teamLeaderId: userId,
        isActive: true,
        role: { in: ["ASESOR_SR", "ASESOR_JR"] },
      },
      select: {
        id: true,
        _count: { select: { assignedContacts: { where: { deletedAt: null } } } },
      },
      orderBy: { assignedContacts: { _count: "asc" } },
    });

    if (teamMembers.length > 0) {
      return teamMembers[0].id;
    }
  }

  // Si es asesor con TL, asignar entre compañeros del equipo
  if (currentUser.teamLeaderId) {
    const teammates = await prisma.user.findMany({
      where: {
        teamLeaderId: currentUser.teamLeaderId,
        isActive: true,
        role: { in: ["ASESOR_SR", "ASESOR_JR"] },
      },
      select: {
        id: true,
        _count: { select: { assignedContacts: { where: { deletedAt: null } } } },
      },
      orderBy: { assignedContacts: { _count: "asc" } },
    });

    if (teammates.length > 0) {
      return teammates[0].id;
    }
  }

  // Si no hay equipo, asignar al usuario actual
  return userId;
}

/**
 * Obtiene lista de asesores para el selector de asignación.
 * Filtra según rol del usuario.
 */
export async function getAdvisors() {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("No autorizado");
  }

  const userRole = session.user.role;
  const userId = session.user.id;
  const userPlaza = session.user.plaza;

  let where: Prisma.UserWhereInput = {
    isActive: true,
    deletedAt: null,
  };

  if (FULL_ACCESS_ROLES.includes(userRole)) {
    // Director ve todos los asesores
  } else if (PLAZA_ACCESS_ROLES.includes(userRole)) {
    // Gerente ve asesores de su plaza
    where.plaza = userPlaza as any;
  } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
    // TL ve solo su equipo
    where.OR = [
      { id: userId },
      { teamLeaderId: userId },
    ];
  } else {
    // Asesores solo se ven a sí mismos
    where.id = userId;
  }

  const advisors = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, role: true, plaza: true },
    orderBy: { name: "asc" },
  });

  return advisors;
}
