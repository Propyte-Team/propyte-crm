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
const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

/**
 * Restablecer la contraseña de otra persona es más peligroso que el resto del
 * panel: quien puede hacerlo puede ENTRAR COMO esa persona. Un GERENTE con este
 * poder podría tomar la cuenta de un DIRECTOR, así que se queda fuera — sigue
 * pudiendo crear, editar y desactivar usuarios, solo no reparte credenciales.
 */
const PASSWORD_RESET_ROLES = ["ADMIN", "DIRECTOR"];

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

/** Guardia estrecha para restablecer contraseñas. Ver PASSWORD_RESET_ROLES. */
async function requirePasswordResetRole() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!PASSWORD_RESET_ROLES.includes(session.user.role)) {
    throw new Error("Acceso denegado: solo un Administrador o Director puede restablecer contraseñas");
  }
  return session;
}

/**
 * Clave de `system_config` que guarda el id del "propietario": el único ADMIN
 * que puede actuar sobre otros ADMIN.
 *
 * Por qué existe. Los tres administradores tienen el MISMO acceso —ADMIN es
 * comodín en todo el código, y darle a alguien otro rol le daría menos, no una
 * posición distinta—. La jerarquía no puede salir del rol, así que sale de
 * aquí: todos administran el CRM por igual, y uno solo administra a los demás.
 *
 * Si la clave no está puesta, el sistema se comporta como antes: cualquier
 * ADMIN puede tocar a otro ADMIN. Es deliberado — así este cambio se puede
 * desplegar sin efecto y activarse después, y borrar la fila no deja a nadie
 * fuera, solo vuelve al reparto plano.
 */
const ADMIN_OWNER_KEY = "admin_owner_user_id";

/** Id del propietario, o null si no hay ninguno designado. */
async function getAdminOwnerId(): Promise<string | null> {
  const row = await prisma.systemConfig
    .findUnique({ where: { key: ADMIN_OWNER_KEY } })
    .catch(() => null);
  const value = row?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Guardia compartida por updateUser y deactivateUser. ADMIN sigue siendo el
 * rol más alto del sistema (se usa como comodín en el resto del código); estas
 * reglas lo protegen, no lo debilitan.
 *
 * @param session sesión del actor, ya validada por requireAdminRole()
 * @param target usuario objetivo, tal como está ANTES de la operación
 * @param opts.settingInactive true si esta llamada pondría isActive en false
 * @param opts.settingRole el nuevo role solicitado, si la operación lo cambia
 */
async function assertUserMutationAllowed(
  session: { user: { id: string; role: string } },
  target: { id: string; role: UserRole; isActive: boolean },
  opts: { settingInactive?: boolean; settingRole?: string } = {}
) {
  const actorRole = session.user.role;
  const actorId = session.user.id;

  // Regla C: si alguien pudiera desactivarse a sí mismo, quedaría fuera de su
  // propia sesión sin que nadie más se diera cuenta ni pudiera revertirlo.
  if (opts.settingInactive && target.id === actorId) {
    throw new Error("No puedes desactivar tu propia cuenta");
  }

  // Regla A: quién puede tocar a un ADMIN.
  //
  // Piso: hay que ser ADMIN. Sin esto un DIRECTOR o GERENTE —que pasan el
  // mismo requireAdminRole()— podría desactivar a quien está por encima.
  if (target.role === "ADMIN" && actorRole !== "ADMIN") {
    throw new Error("Solo un Administrador puede modificar a otro Administrador");
  }

  // Techo: si hay un propietario designado, es el ÚNICO que puede actuar sobre
  // un ADMIN — ni siquiera los otros ADMIN, y tampoco entre ellos. Todos
  // administran el CRM igual; solo uno administra a los administradores.
  //
  // Tocarse a uno mismo se permite: el propietario no debe quedar atrapado sin
  // poder editar su propio nombre o teléfono. Desactivarse sigue prohibido por
  // la Regla C, y quedarse sin ADMIN activos por la Regla D.
  if (target.role === "ADMIN" && target.id !== actorId) {
    const ownerId = await getAdminOwnerId();
    if (ownerId && actorId !== ownerId) {
      throw new Error(
        "Solo el Administrador propietario puede modificar a otro Administrador"
      );
    }
  }

  // Regla B: promover a alguien (o a sí mismo) a ADMIN exige ya ser ADMIN. Sin
  // esto la Regla A no protege nada: cualquiera se autopromueve primero y
  // luego ya puede tocar ADMINs con el rol recién adquirido.
  if (opts.settingRole === "ADMIN" && actorRole !== "ADMIN") {
    throw new Error("Solo un Administrador puede asignar el rol de Administrador");
  }

  // Regla D: no dejar el sistema sin ningún ADMIN activo, porque nadie podría
  // volver a entrar a /admin para deshacer el error.
  //
  // Cuenta DESACTIVAR y también DEGRADAR: quitarle el rol al último ADMIN deja
  // la casa igual de cerrada, y encima es irreversible — nadie podría volver a
  // promoverlo, porque la Regla B exige ya ser ADMIN para repartir ese rol.
  // Solo aplica si el objetivo está activo hoy: tocar a un ADMIN ya inactivo
  // no cambia cuántos quedan.
  const dejariaDeSerAdminActivo =
    target.role === "ADMIN" &&
    target.isActive &&
    (opts.settingInactive === true ||
      (opts.settingRole !== undefined && opts.settingRole !== "ADMIN"));

  if (dejariaDeSerAdminActivo) {
    const activeAdmins = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, deletedAt: null },
    });
    if (activeAdmins <= 1) {
      throw new Error(
        "Este es el último Administrador activo: no se puede desactivar ni cambiarle el rol"
      );
    }
  }
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
  // El formulario manda null (no undefined) en los opcionales vacíos — deben ser nullable
  // igual que en updateUserSchema, o la creación falla con campos en blanco.
  teamLeaderId: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  sedetusNumber: z.string().nullable().optional(),
  sedetusExpiry: z.string().nullable().optional(),
});

// Mínimo 8 (no 6 como al crear): esta contraseña la elige un tercero y viaja
// por WhatsApp o de viva voz hasta su dueño. El createUserSchema se queda en 6
// para no invalidar el alta que ya usa el equipo.
const resetPasswordSchema = z.object({
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
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
  teamLeaderId?: string | null;
  phone?: string | null;
  sedetusNumber?: string | null;
  sedetusExpiry?: string | null;
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
  const session = await requireAdminRole();

  // Verificar que el usuario existe (antes de validar con Zod: a quién se
  // toca no debe depender de que el resto del payload tenga forma válida).
  const existing = await prisma.user.findUnique({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new Error("Usuario no encontrado");

  // Reglas A-D, evaluadas sobre `data` tal cual llegó (no sobre el resultado
  // de Zod): así el candado de autorización no depende de qué valores de rol
  // acepte hoy el esquema de validación, y sigue firme aunque eso cambie.
  await assertUserMutationAllowed(session, existing, {
    settingInactive: data.isActive === false,
    settingRole: data.role,
  });

  // Validar datos con Zod
  const validated = updateUserSchema.parse(data);

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
 * Restablece la contraseña de otro usuario. Devuelve solo datos de
 * identificación: ni la contraseña ni el hash vuelven a quien la pidió.
 *
 * OJO: la sesión de esa persona NO se cierra. NextAuth v4 usa JWT y el token
 * vive hasta expirar, así que cambiar la contraseña no expulsa a quien ya
 * estuviera dentro. Si algún día hace falta echar a alguien de inmediato, eso
 * es invalidación de sesiones y es un trabajo aparte.
 */
export async function resetUserPassword(userId: string, password: string) {
  const session = await requirePasswordResetRole();

  const { password: validPassword } = resetPasswordSchema.parse({ password });

  const target = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { id: true, name: true, email: true },
  });
  if (!target) throw new Error("Usuario no encontrado");

  const passwordHash = await hash(validPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Sin la contraseña ni el hash: un log que guarda la credencial la deja en
  // claro para cualquiera que pueda leer la tabla de auditoría.
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "User",
      entityId: userId,
      changes: { field: "passwordHash", reset: true, targetEmail: target.email },
    },
  });

  return { id: target.id, name: target.name, email: target.email };
}

/**
 * Desactiva un usuario (soft deactivate, no borra).
 */
export async function deactivateUser(id: string) {
  const session = await requireAdminRole();

  const existing = await prisma.user.findUnique({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new Error("Usuario no encontrado");

  // Mismas reglas A, C y D que updateUser — ver assertUserMutationAllowed.
  await assertUserMutationAllowed(session, existing, { settingInactive: true });

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
  const session = await requireAdminRole();

  if (!key || typeof key !== "string") {
    throw new Error("La clave de configuración es requerida");
  }

  // La clave del propietario se protege a sí misma: solo el propietario actual
  // puede cambiarla. Sin esto la Regla A no valdría nada — cualquier ADMIN se
  // nombraría propietario y recuperaría el poder de tocar a los demás.
  //
  // Mientras no haya propietario, cualquier ADMIN puede designar al primero:
  // es la única forma de arrancar. Los roles no-ADMIN nunca pueden, aunque
  // requireAdminRole() los haya dejado pasar.
  if (key === ADMIN_OWNER_KEY) {
    if (session.user.role !== "ADMIN") {
      throw new Error("Solo un Administrador puede designar al propietario");
    }
    const ownerId = await getAdminOwnerId();
    if (ownerId && session.user.id !== ownerId) {
      throw new Error("Solo el propietario actual puede transferir la propiedad");
    }
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

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      hashedKey: hashed,
      prefix,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      isActive: true,
      createdAt: true,
    },
  });

  // La key raw solo se muestra una vez
  return { key: raw, apiKey };
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
