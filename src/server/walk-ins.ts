// ============================================================
// Server Actions: Gestión de walk-ins
// Registro de visitantes, búsqueda de contactos, asignación de asesores
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import type { Prisma, VisitPurpose } from "@prisma/client";
import { dispatchWebhook } from "@/lib/webhooks/dispatcher";

// Roles con acceso completo a todos los walk-ins
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];
// Roles con acceso a walk-ins de su equipo
const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"];

// --- Tipos ---
interface WalkInRecord {
  id: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  hostessName: string;
  advisorName: string | null;
  arrivalTime: string;
  departureTime: string | null;
  visitPurpose: VisitPurpose;
  convertedToDeal: boolean;
  notes: string | null;
}

interface WalkInFilters {
  date?: string; // formato ISO, default hoy
}

interface CreateWalkInData {
  contactId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  visitPurpose: VisitPurpose;
  assignedAdvisorId?: string;
  notes?: string;
}

interface AdvisorOption {
  id: string;
  name: string;
  role: string;
}

interface ContactSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
}

/**
 * Obtiene walk-ins con filtro de fecha (default: hoy).
 * RBAC: Director/Gerente = todos, Hostess = propios, TL = del equipo.
 */
export async function getWalkIns(
  filters: WalkInFilters = {}
): Promise<WalkInRecord[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  // Determinar rango de fecha (default: hoy)
  const targetDate = filters.date ? new Date(filters.date) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Construir filtro base con rango de fecha
  const where: Prisma.WalkInWhereInput = {
    deletedAt: null,
    arrivalTime: {
      gte: startOfDay,
      lte: endOfDay,
    },
  };

  // Aplicar RBAC
  const userRole = session.user.role;
  const userId = session.user.id;

  if (FULL_ACCESS_ROLES.includes(userRole)) {
    // Director y Gerente ven todos
  } else if (userRole === "HOSTESS") {
    // Hostess ve solo los que ella registró
    where.hostessId = userId;
  } else if (TEAM_ACCESS_ROLES.includes(userRole)) {
    // Team Leader ve walk-ins asignados a su equipo
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: userId },
      select: { id: true },
    });
    const teamIds = [userId, ...teamMembers.map((m) => m.id)];
    where.assignedAdvisorId = { in: teamIds };
  } else {
    // Asesores ven walk-ins asignados a ellos
    where.assignedAdvisorId = userId;
  }

  // Consultar walk-ins con relaciones
  const walkIns = await prisma.walkIn.findMany({
    where,
    include: {
      contact: {
        select: { firstName: true, lastName: true, phone: true, email: true },
      },
      hostess: {
        select: { name: true },
      },
      assignedAdvisor: {
        select: { name: true },
      },
    },
    orderBy: { arrivalTime: "desc" },
  });

  // Transformar a tipo de respuesta
  return walkIns.map((w) => ({
    id: w.id,
    contactName: `${w.contact.firstName} ${w.contact.lastName}`,
    contactPhone: w.contact.phone,
    contactEmail: w.contact.email,
    hostessName: w.hostess.name,
    advisorName: w.assignedAdvisor?.name ?? null,
    arrivalTime: w.arrivalTime.toISOString(),
    departureTime: w.departureTime?.toISOString() ?? null,
    visitPurpose: w.visitPurpose,
    convertedToDeal: w.convertedToDeal,
    notes: w.notes,
  }));
}

/**
 * Crea un nuevo walk-in.
 * Si no existe contactId, crea un nuevo contacto con los datos proporcionados.
 * Si no se asigna asesor, usa round-robin entre asesores activos de la plaza.
 */
export async function createWalkIn(
  data: CreateWalkInData
): Promise<{ success: boolean; walkInId: string }> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const hostessId = session.user.id;
  const userPlaza = session.user.plaza;

  // Resolver contactId: usar existente o crear nuevo
  let contactId = data.contactId;

  if (!contactId) {
    // Validar datos para nuevo contacto
    if (!data.firstName || !data.lastName || !data.phone) {
      throw new Error(
        "Para crear un nuevo contacto se requiere nombre, apellido y teléfono"
      );
    }

    // Crear nuevo contacto con fuente WALK_IN
    const newContact = await prisma.contact.create({
      data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone.trim(),
        email: data.email?.trim() || null,
        contactType: "LEAD",
        leadSource: "WALK_IN",
        temperature: "WARM",
      },
    });
    contactId = newContact.id;
  }

  // Resolver asesor asignado: usar proporcionado o round-robin
  let assignedAdvisorId = data.assignedAdvisorId;

  if (!assignedAdvisorId) {
    assignedAdvisorId = await getNextAdvisorRoundRobin(userPlaza);
  }

  // Crear el walk-in
  const walkIn = await prisma.walkIn.create({
    data: {
      hostessId,
      contactId,
      visitPurpose: data.visitPurpose,
      assignedAdvisorId: assignedAdvisorId || null,
      notes: data.notes?.trim() || null,
    },
  });

  // Disparar webhook de walk-in creado (fire-and-forget, no bloquea la respuesta)
  dispatchWebhook("walk_in.created", { walkIn });

  return { success: true, walkInId: walkIn.id };
}

/**
 * Obtiene asesores activos disponibles para asignación en una plaza.
 * Retorna usuarios con rol ASESOR_SR o ASESOR_JR activos.
 */
export async function getAvailableAdvisors(
  plaza: string
): Promise<AdvisorOption[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const advisors = await prisma.user.findMany({
    where: {
      role: { in: ["ASESOR_SR", "ASESOR_JR"] },
      plaza: plaza as Prisma.EnumPlazaFilter,
      isActive: true,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      role: true,
    },
    orderBy: { name: "asc" },
  });

  return advisors.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
  }));
}

/**
 * Busca contactos por teléfono o nombre para typeahead.
 * Retorna máximo 10 resultados.
 */
export async function searchContacts(
  query: string
): Promise<ContactSearchResult[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const contacts = await prisma.contact.findMany({
    where: {
      deletedAt: null,
      OR: [
        { phone: { contains: trimmed, mode: "insensitive" } },
        { firstName: { contains: trimmed, mode: "insensitive" } },
        { lastName: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
    },
    take: 10,
    orderBy: { firstName: "asc" },
  });

  return contacts;
}

/**
 * Asignación round-robin de asesores activos en una plaza.
 * Encuentra el asesor con menos walk-ins asignados hoy.
 */
async function getNextAdvisorRoundRobin(
  plaza: string
): Promise<string | undefined> {
  // Obtener asesores activos de la plaza
  const advisors = await prisma.user.findMany({
    where: {
      role: { in: ["ASESOR_SR", "ASESOR_JR"] },
      plaza: plaza as Prisma.EnumPlazaFilter,
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (advisors.length === 0) return undefined;

  // Contar walk-ins de hoy por asesor
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const advisorIds = advisors.map((a) => a.id);

  const walkInCounts = await prisma.walkIn.groupBy({
    by: ["assignedAdvisorId"],
    where: {
      assignedAdvisorId: { in: advisorIds },
      arrivalTime: { gte: startOfDay, lte: endOfDay },
      deletedAt: null,
    },
    _count: { id: true },
  });

  // Crear mapa de conteos
  const countMap = new Map<string, number>();
  for (const wc of walkInCounts) {
    if (wc.assignedAdvisorId) {
      countMap.set(wc.assignedAdvisorId, wc._count.id);
    }
  }

  // Encontrar asesor con menos walk-ins
  let minCount = Infinity;
  let selectedId = advisors[0].id;

  for (const advisor of advisors) {
    const count = countMap.get(advisor.id) ?? 0;
    if (count < minCount) {
      minCount = count;
      selectedId = advisor.id;
    }
  }

  return selectedId;
}
