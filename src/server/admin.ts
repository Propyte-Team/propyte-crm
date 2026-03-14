// ============================================================
// Server Actions: Administración
// CRUD de usuarios, reglas de comisión y configuración del sistema
// Restringido a roles DIRECTOR y GERENTE
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { hash } from "bcryptjs";
import { z } from "zod";
import { randomBytes } from "crypto";
import type { UserRole, Plaza, CareerLevel } from "@prisma/client";
import { generateApiKeyPair } from "@/lib/auth/api-key";

// Roles permitidos para acceder a administración
const ADMIN_ROLES = ["DIRECTOR", "GERENTE"];

/**
 * Verifica que el usuario actual tenga rol de administración.
 * Lanza error si no es DIRECTOR o GERENTE.
 */
async function requireAdminRole() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Acceso denegado: se requiere rol de Director o Gerente");
  }
  return session;
}

// ============================================================
// Esquemas de validación Zod
// ============================================================

const createUserSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  email: z.string().email("Correo electrónico inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  role: z.enum([
    "DIRECTOR",
    "GERENTE",
    "TEAM_LEADER",
    "ASESOR_SR",
    "ASESOR_JR",
    "HOSTESS",
    "MARKETING",
    "DEVELOPER_EXT",
  ]),
  plaza: z.enum(["PDC", "TULUM", "MERIDA"]),
  careerLevel: z.enum(["JR", "SR", "TOP_PRODUCER", "TEAM_LEADER", "GERENTE"]).optional(),
  teamLeaderId: z.string().optional(),
  phone: z.string().optional(),
  sedetusNumber: z.string().optional(),
  sedetusExpiry: z.string().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z
    .enum([
      "DIRECTOR",
      "GERENTE",
      "TEAM_LEADER",
      "ASESOR_SR",
      "ASESOR_JR",
      "HOSTESS",
      "MARKETING",
      "DEVELOPER_EXT",
    ])
    .optional(),
  plaza: z.enum(["PDC", "TULUM", "MERIDA"]).optional(),
  careerLevel: z
    .enum(["JR", "SR", "TOP_PRODUCER", "TEAM_LEADER", "GERENTE"])
    .optional(),
  teamLeaderId: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  sedetusNumber: z.string().nullable().optional(),
  sedetusExpiry: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const createCommissionRuleSchema = z.object({
  dealType: z.enum([
    "NATIVA_CONTADO",
    "NATIVA_FINANCIAMIENTO",
    "MACROLOTE",
    "CORRETAJE",
    "MASTERBROKER",
  ]),
  leadSourceCategory: z.enum(["PROPYTE_LEAD", "BROKER_LEAD", "ASESOR_LEAD"]),
  role: z.enum([
    "DIRECTOR",
    "GERENTE",
    "TEAM_LEADER",
    "ASESOR_SR",
    "ASESOR_JR",
    "HOSTESS",
    "MARKETING",
    "DEVELOPER_EXT",
  ]),
  percentage: z.number().min(0).max(100),
  isActive: z.boolean().optional(),
});

const updateCommissionRuleSchema = z.object({
  dealType: z
    .enum([
      "NATIVA_CONTADO",
      "NATIVA_FINANCIAMIENTO",
      "MACROLOTE",
      "CORRETAJE",
      "MASTERBROKER",
    ])
    .optional(),
  leadSourceCategory: z
    .enum(["PROPYTE_LEAD", "BROKER_LEAD", "ASESOR_LEAD"])
    .optional(),
  role: z
    .enum([
      "DIRECTOR",
      "GERENTE",
      "TEAM_LEADER",
      "ASESOR_SR",
      "ASESOR_JR",
      "HOSTESS",
      "MARKETING",
      "DEVELOPER_EXT",
    ])
    .optional(),
  percentage: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================
// Gestión de Usuarios
// ============================================================

/**
 * Obtiene todos los usuarios con datos de team leader y conteo de deals.
 */
export async function getUsers() {
  await requireAdminRole();

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      plaza: true,
      careerLevel: true,
      isActive: true,
      phone: true,
      sedetusNumber: true,
      sedetusExpiry: true,
      teamLeaderId: true,
      teamLeader: {
        select: { id: true, name: true },
      },
      _count: {
        select: { deals: true },
      },
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  return users;
}

/**
 * Crea un nuevo usuario con validación Zod y hash de contraseña.
 */
export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: string;
  plaza: string;
  careerLevel?: string;
  teamLeaderId?: string;
  phone?: string;
  sedetusNumber?: string;
  sedetusExpiry?: string;
}) {
  await requireAdminRole();

  // Validar datos con Zod
  const validated = createUserSchema.parse(data);

  // Verificar que el email no esté en uso
  const existing = await prisma.user.findUnique({
    where: { email: validated.email.toLowerCase().trim() },
  });
  if (existing) throw new Error("Ya existe un usuario con este correo electrónico");

  // Hash de la contraseña
  const passwordHash = await hash(validated.password, 12);

  // Crear usuario
  const user = await prisma.user.create({
    data: {
      name: validated.name,
      email: validated.email.toLowerCase().trim(),
      passwordHash,
      role: validated.role as UserRole,
      plaza: validated.plaza as Plaza,
      careerLevel: (validated.careerLevel as CareerLevel) || "JR",
      teamLeaderId: validated.teamLeaderId || null,
      phone: validated.phone || null,
      sedetusNumber: validated.sedetusNumber || null,
      sedetusExpiry: validated.sedetusExpiry
        ? new Date(validated.sedetusExpiry)
        : null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      plaza: true,
      careerLevel: true,
      isActive: true,
    },
  });

  return user;
}

/**
 * Actualiza campos de un usuario existente.
 * Permite cambiar rol, plaza, estado activo, team leader y nivel de carrera.
 */
export async function updateUser(
  id: string,
  data: {
    name?: string;
    email?: string;
    role?: string;
    plaza?: string;
    careerLevel?: string;
    teamLeaderId?: string | null;
    phone?: string | null;
    sedetusNumber?: string | null;
    sedetusExpiry?: string | null;
    isActive?: boolean;
  }
) {
  await requireAdminRole();

  // Validar datos con Zod
  const validated = updateUserSchema.parse(data);

  // Verificar que el usuario existe
  const existing = await prisma.user.findUnique({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new Error("Usuario no encontrado");

  // Verificar email único si se está cambiando
  if (validated.email && validated.email !== existing.email) {
    const emailTaken = await prisma.user.findUnique({
      where: { email: validated.email.toLowerCase().trim() },
    });
    if (emailTaken) throw new Error("Ya existe un usuario con este correo electrónico");
  }

  // Construir datos de actualización
  const updateData: Record<string, unknown> = {};
  if (validated.name !== undefined) updateData.name = validated.name;
  if (validated.email !== undefined) updateData.email = validated.email.toLowerCase().trim();
  if (validated.role !== undefined) updateData.role = validated.role;
  if (validated.plaza !== undefined) updateData.plaza = validated.plaza;
  if (validated.careerLevel !== undefined) updateData.careerLevel = validated.careerLevel;
  if (validated.teamLeaderId !== undefined) updateData.teamLeaderId = validated.teamLeaderId;
  if (validated.phone !== undefined) updateData.phone = validated.phone;
  if (validated.sedetusNumber !== undefined) updateData.sedetusNumber = validated.sedetusNumber;
  if (validated.sedetusExpiry !== undefined) {
    updateData.sedetusExpiry = validated.sedetusExpiry
      ? new Date(validated.sedetusExpiry)
      : null;
  }
  if (validated.isActive !== undefined) updateData.isActive = validated.isActive;

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      plaza: true,
      careerLevel: true,
      isActive: true,
    },
  });

  return user;
}

/**
 * Desactiva un usuario (soft deactivate, no borra).
 */
export async function deactivateUser(id: string) {
  await requireAdminRole();

  const existing = await prisma.user.findUnique({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new Error("Usuario no encontrado");

  const user = await prisma.user.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, name: true, isActive: true },
  });

  return user;
}

// ============================================================
// Gestión de Reglas de Comisión
// ============================================================

/**
 * Obtiene todas las reglas de comisión.
 */
export async function getCommissionRules() {
  await requireAdminRole();

  const rules = await prisma.commissionRule.findMany({
    orderBy: [{ dealType: "asc" }, { leadSourceCategory: "asc" }, { role: "asc" }],
  });

  return rules;
}

/**
 * Crea una nueva regla de comisión con validación Zod.
 */
export async function createCommissionRule(data: {
  dealType: string;
  leadSourceCategory: string;
  role: string;
  percentage: number;
  isActive?: boolean;
}) {
  await requireAdminRole();

  const validated = createCommissionRuleSchema.parse(data);

  const rule = await prisma.commissionRule.create({
    data: {
      dealType: validated.dealType as any,
      leadSourceCategory: validated.leadSourceCategory as any,
      role: validated.role as any,
      percentage: validated.percentage,
      isActive: validated.isActive ?? true,
    },
  });

  return rule;
}

/**
 * Actualiza una regla de comisión existente.
 */
export async function updateCommissionRule(
  id: string,
  data: {
    dealType?: string;
    leadSourceCategory?: string;
    role?: string;
    percentage?: number;
    isActive?: boolean;
  }
) {
  await requireAdminRole();

  const validated = updateCommissionRuleSchema.parse(data);

  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) throw new Error("Regla de comisión no encontrada");

  const updateData: Record<string, unknown> = {};
  if (validated.dealType !== undefined) updateData.dealType = validated.dealType;
  if (validated.leadSourceCategory !== undefined)
    updateData.leadSourceCategory = validated.leadSourceCategory;
  if (validated.role !== undefined) updateData.role = validated.role;
  if (validated.percentage !== undefined) updateData.percentage = validated.percentage;
  if (validated.isActive !== undefined) updateData.isActive = validated.isActive;

  const rule = await prisma.commissionRule.update({
    where: { id },
    data: updateData,
  });

  return rule;
}

/**
 * Elimina una regla de comisión.
 */
export async function deleteCommissionRule(id: string) {
  await requireAdminRole();

  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) throw new Error("Regla de comisión no encontrada");

  await prisma.commissionRule.delete({ where: { id } });
  return { success: true };
}

// ============================================================
// Configuración del Sistema
// ============================================================

/**
 * Obtiene todas las entradas de configuración del sistema.
 */
export async function getSystemConfig() {
  await requireAdminRole();

  const configs = await prisma.systemConfig.findMany({
    orderBy: { key: "asc" },
  });

  // Convertir a objeto clave-valor para facilitar el uso
  const configMap: Record<string, unknown> = {};
  for (const c of configs) {
    configMap[c.key] = c.value;
  }

  return configMap;
}

/**
 * Actualiza o crea una entrada de configuración del sistema (upsert).
 */
export async function updateSystemConfig(key: string, value: unknown) {
  await requireAdminRole();

  if (!key || typeof key !== "string") {
    throw new Error("La clave de configuración es requerida");
  }

  const config = await prisma.systemConfig.upsert({
    where: { key },
    update: { value: value as any },
    create: { key, value: value as any },
  });

  return config;
}

// ============================================================
// Gestión de Webhooks (salientes)
// ============================================================

/**
 * Obtiene todos los webhooks configurados.
 */
export async function getWebhookConfigs() {
  await requireAdminRole();
  return prisma.webhookConfig.findMany({
    orderBy: { event: "asc" },
  });
}

/**
 * Crea una nueva configuración de webhook saliente.
 */
export async function createWebhookConfig(data: { event: string; url: string }) {
  await requireAdminRole();

  if (!data.event || !data.url) {
    throw new Error("Evento y URL son requeridos");
  }

  // Generar secret aleatorio para firma HMAC
  const secret = randomBytes(32).toString("hex");

  const config = await prisma.webhookConfig.create({
    data: {
      event: data.event,
      url: data.url,
      secret,
    },
  });

  return { ...config, secret };
}

/**
 * Actualiza un webhook (activar/desactivar, cambiar URL).
 */
export async function updateWebhookConfig(
  id: string,
  data: { url?: string; isActive?: boolean }
) {
  await requireAdminRole();

  return prisma.webhookConfig.update({
    where: { id },
    data,
  });
}

/**
 * Elimina un webhook.
 */
export async function deleteWebhookConfig(id: string) {
  await requireAdminRole();
  await prisma.webhookConfig.delete({ where: { id } });
  return { success: true };
}

// ============================================================
// Gestión de API Keys (integraciones entrantes)
// ============================================================

/**
 * Obtiene todas las API keys (sin mostrar el hash).
 */
export async function getApiKeys() {
  await requireAdminRole();

  return prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Genera una nueva API key. Retorna la key completa SOLO una vez.
 */
export async function generateNewApiKey(name: string) {
  await requireAdminRole();

  if (!name) throw new Error("El nombre es requerido");

  const { raw, hashed, prefix } = generateApiKeyPair();

  await prisma.apiKey.create({
    data: {
      name,
      hashedKey: hashed,
      prefix,
    },
  });

  // La key raw solo se muestra una vez
  return { key: raw, prefix };
}

/**
 * Revoca (desactiva) una API key.
 */
export async function revokeApiKey(id: string) {
  await requireAdminRole();

  await prisma.apiKey.update({
    where: { id },
    data: { isActive: false },
  });

  return { success: true };
}
