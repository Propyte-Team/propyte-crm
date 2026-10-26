"use server";

// Configuración manual del lead scoring (spec §6 F4). Hoy no hay pantalla: estas acciones son la
// puerta para el futuro editor en admin, y mientras tanto se pueden llamar desde un script.
// El modelo se valida ANTES de guardarse: un modelo roto no llega a SystemConfig (y si llegara
// por otra vía, el recálculo cae al default; ver lib/scoring/modelo.ts → resolverModelo).

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { CLAVE_ACTIVO, CLAVE_MODELO, MODELO_DEFAULT, modeloSchema, type ModeloScore } from "@/lib/scoring/modelo";
import { cargarConfigScoring } from "@/lib/scoring/recalcular";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR"];

async function requireAdminRole() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Acceso denegado: se requiere rol de administración");
  }
  return session;
}

/** Modelo vigente (el guardado o el default), si está activo y, si el guardado no sirve, por qué. */
export async function getScoringConfig(): Promise<{
  modelo: ModeloScore;
  activo: boolean;
  esDefault: boolean;
  errorModelo?: string;
}> {
  await requireAdminRole();
  const cfg = await cargarConfigScoring();
  const guardado = await prisma.systemConfig.findUnique({ where: { key: CLAVE_MODELO }, select: { id: true } });
  return { ...cfg, esDefault: !guardado || !!cfg.errorModelo };
}

/**
 * Guarda un modelo editado a mano. La `version` debe ser MAYOR que la vigente: es lo que hace que
 * el cron recalcule a todos los contactos con el modelo nuevo.
 */
export async function saveScoringModelo(valor: unknown): Promise<{ ok: true; version: number } | { error: string }> {
  await requireAdminRole();
  const r = modeloSchema.safeParse(valor);
  if (!r.success) {
    return { error: r.error.issues.map((i) => `${i.path.join(".") || "modelo"}: ${i.message}`).join("; ") };
  }
  const vigente = await cargarConfigScoring();
  if (r.data.version <= vigente.modelo.version) {
    return { error: `La versión debe ser mayor que la vigente (${vigente.modelo.version})` };
  }
  await prisma.systemConfig.upsert({
    where: { key: CLAVE_MODELO },
    create: { key: CLAVE_MODELO, value: r.data as object },
    update: { value: r.data as object },
  });
  return { ok: true, version: r.data.version };
}

/** Vuelve al modelo por defecto del código (borra el guardado). */
export async function resetScoringModelo(): Promise<{ ok: true; version: number }> {
  await requireAdminRole();
  await prisma.systemConfig.deleteMany({ where: { key: CLAVE_MODELO } });
  return { ok: true, version: MODELO_DEFAULT.version };
}

/**
 * Enciende o apaga el scoring real (spec §6 F3). Encendido, Contact.score se llena y cambia lo que
 * recibe Meta CAPI, las etapas MQL/SQL, los workflows SCORE_THRESHOLD y el ruteo: ver §7 del spec
 * antes de encenderlo. Apagarlo NO regresa Contact.score a 0; solo deja de actualizarlo.
 */
export async function setScoringActivo(activo: boolean): Promise<{ ok: true; activo: boolean }> {
  await requireAdminRole();
  await prisma.systemConfig.upsert({
    where: { key: CLAVE_ACTIVO },
    create: { key: CLAVE_ACTIVO, value: activo },
    update: { value: activo },
  });
  return { ok: true, activo };
}
