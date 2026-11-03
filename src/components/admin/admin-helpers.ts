// Lógica pura de Usuarios, Comisiones y Acuerdo de actividad (sin React, para poder
// probarla en node). La usa admin-content.tsx.
import { DEAL_TYPE_LABELS, LEAD_SOURCE_CATEGORY_LABELS } from "@/lib/constants";
import { ROLE_LABELS_COMPLETO, etiqueta } from "@/lib/labels";

// ---------- Comisiones ----------

export interface ReglaClave {
  dealType: string;
  leadSourceCategory: string;
  role: string;
}

/** Regla ya existente con la misma combinación tipo de deal + fuente + rol (ignora `ignorarId`). */
export function buscarReglaDuplicada<T extends ReglaClave & { id: string }>(
  reglas: T[],
  clave: ReglaClave,
  ignorarId?: string,
): T | undefined {
  return reglas.find(
    (r) =>
      r.id !== ignorarId &&
      r.dealType === clave.dealType &&
      r.leadSourceCategory === clave.leadSourceCategory &&
      r.role === clave.role,
  );
}

/** "Nativa Contado · Lead Propyte · Asesor Senior" */
export function describirClaveRegla(clave: ReglaClave): string {
  return [
    etiqueta(DEAL_TYPE_LABELS, clave.dealType),
    etiqueta(LEAD_SOURCE_CATEGORY_LABELS, clave.leadSourceCategory),
    etiqueta(ROLE_LABELS_COMPLETO, clave.role),
  ].join(" · ");
}

export function mensajeReglaDuplicada(existente: ReglaClave & { percentage: unknown }): string {
  return `Ya existe una regla para ${describirClaveRegla(existente)} (${Number(existente.percentage)}%). Edítala en lugar de crear otra.`;
}

// ---------- Usuarios ----------

/** Campo del formulario al que apunta un mensaje de error del servidor (o undefined). */
export function campoDeMensaje(mensaje: string): string | undefined {
  const m = mensaje.toLowerCase();
  if (m.includes("correo") || m.includes("email")) return "email";
  if (m.includes("contraseña")) return "password";
  if (m.includes("nombre")) return "name";
  return undefined;
}

export interface FilaUsuarioBase {
  id: string;
  name: string;
  email: string;
  role: string;
  plaza: string;
  careerLevel: string;
  isActive: boolean;
  phone: string | null;
  sedetusNumber: string | null;
  sedetusExpiry: Date | null;
  teamLeaderId: string | null;
  teamLeader: { id: string; name: string } | null;
  _count: { deals: number };
  createdAt: Date;
}

/**
 * Fila de la tabla a partir de lo que devolvió el servidor (solo campos básicos) y lo que se
 * envió en el formulario. `previa` es la fila actual al editar; sin ella se trata de un alta.
 */
export function construirFilaUsuario(
  devuelto: { id: string; name: string; email: string; role: string; plaza: string; careerLevel: string; isActive: boolean },
  enviado: Record<string, unknown>,
  lideres: { id: string; name: string }[],
  previa?: FilaUsuarioBase,
): FilaUsuarioBase {
  const teamLeaderId =
    "teamLeaderId" in enviado ? ((enviado.teamLeaderId as string | null) ?? null) : (previa?.teamLeaderId ?? null);
  const texto = (k: string, antes: string | null | undefined) =>
    k in enviado ? ((enviado[k] as string | null) || null) : (antes ?? null);
  const vencimiento =
    "sedetusExpiry" in enviado
      ? enviado.sedetusExpiry
        ? new Date(enviado.sedetusExpiry as string)
        : null
      : (previa?.sedetusExpiry ?? null);
  return {
    id: devuelto.id,
    name: devuelto.name,
    email: devuelto.email,
    role: devuelto.role,
    plaza: devuelto.plaza,
    careerLevel: devuelto.careerLevel,
    isActive: devuelto.isActive,
    phone: texto("phone", previa?.phone),
    sedetusNumber: texto("sedetusNumber", previa?.sedetusNumber),
    sedetusExpiry: vencimiento,
    teamLeaderId,
    teamLeader: teamLeaderId
      ? (lideres.find((l) => l.id === teamLeaderId) ?? previa?.teamLeader ?? null)
      : null,
    _count: previa?._count ?? { deals: 0 },
    createdAt: previa?.createdAt ?? new Date(),
  };
}

// ---------- Acuerdo de actividad ----------

export interface CampoAcuerdo {
  key:
    | "minDailyCalls"
    | "minDailyWhatsapps"
    | "minWeeklyVisits"
    | "minDailyFollowUps"
    | "maxFirstResponseMinutes"
    | "maxInactivityDays";
  id: string;
  label: string;
  /** Texto tras el valor recomendado: "Recomendado: 20 al día". */
  unidad: string;
}

export const CAMPOS_ACUERDO: CampoAcuerdo[] = [
  { key: "minDailyCalls", id: "minCalls", label: "Llamadas diarias mínimas", unidad: "al día" },
  { key: "minDailyWhatsapps", id: "minWhatsapps", label: "WhatsApps diarios mínimos", unidad: "al día" },
  { key: "minWeeklyVisits", id: "minVisits", label: "Visitas semanales mínimas", unidad: "a la semana" },
  { key: "minDailyFollowUps", id: "minFollowUps", label: "Seguimientos diarios mínimos", unidad: "al día" },
  { key: "maxFirstResponseMinutes", id: "maxResponse", label: "Tiempo máximo de respuesta (minutos)", unidad: "minutos" },
  { key: "maxInactivityDays", id: "maxInactivity", label: "Máximo de días sin actividad", unidad: "días" },
];

/** Entero >= 0; texto vacío o inválido = 0. */
export function leerEnteroNoNegativo(texto: string): number {
  const n = parseInt(texto, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
