// ============================================================
// Acceso a nivel de objeto sobre un negocio (#711 · AUD-20260903 S-01/S-04/D-09)
// ============================================================
// El control existía y funcionaba, pero solo en `GET/PATCH /api/deals/[id]`: era una
// función privada de ese archivo. Todo lo que cuelga de un negocio —cotizaciones, planes
// de pago, parcialidades, documentos— se conformaba con que hubiera sesión:
//
//     const session = await getServerSession();
//     if (!session?.user) throw new Error("No autorizado");
//     const existing = await prisma.quote.findFirst({ where: { id, deletedAt: null } });
//     // ↑ nunca compara contra assignedToId, plaza ni teamLeaderId
//
// Con eso, cualquier usuario con sesión leía y editaba por id las cotizaciones y los
// documentos (INE, comprobantes, contratos) de toda la empresa. Este módulo saca esa
// decisión a un solo lugar para que se aplique igual en todas partes.
//
// La decisión es PURA y está aparte de la consulta a propósito: el bug vivía en la
// decisión, no en la query, y así se puede probar rol por rol sin base de datos.

import prisma from "@/lib/db";

// Los mismos conjuntos que usa /api/deals/[id]. Se copian tal cual, sin "unificarlos" con
// los de contactos o comisiones: no son iguales (comisiones mete a GERENTE en el nivel
// total, contactos tiene su propio nivel de plaza) y juntarlos cambiaría permisos en
// silencio, que es justo lo que este arreglo intenta evitar.
const ACCESO_TOTAL = ["ADMIN", "DIRECTOR"];
const ACCESO_PLAZA = ["ADMIN", "GERENTE"];
const ACCESO_EQUIPO = ["ADMIN", "TEAM_LEADER"];
const ACCESO_PROPIO = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];
/** Ven todo, pero solo de lectura: nunca pueden escribir. */
const SOLO_LECTURA = ["MARKETING", "DEVELOPER_EXT"];

export interface NegocioParaAcceso {
  assignedToId: string | null;
  assignedTo?: { plaza: string | null; teamLeaderId: string | null } | null;
}

export interface UsuarioParaAcceso {
  id: string;
  role: string;
  plaza: string;
}

/**
 * ¿Puede este usuario VER el negocio?
 *
 * El orden importa y es el canónico del repo: total → plaza → equipo → propio → denegado.
 * Evaluar equipo antes que total dejaría a los ADMIN viendo solo su equipo, que es un bug
 * que este proyecto ya tuvo una vez en las actividades.
 */
export function puedeVerNegocio(deal: NegocioParaAcceso, user: UsuarioParaAcceso): boolean {
  if (ACCESO_TOTAL.includes(user.role)) return true;
  if (SOLO_LECTURA.includes(user.role)) return true;
  if (ACCESO_PLAZA.includes(user.role)) return deal.assignedTo?.plaza === user.plaza;
  if (ACCESO_EQUIPO.includes(user.role)) {
    return deal.assignedToId === user.id || deal.assignedTo?.teamLeaderId === user.id;
  }
  if (ACCESO_PROPIO.includes(user.role)) return deal.assignedToId === user.id;
  return false;
}

/**
 * ¿Puede este usuario MODIFICAR lo que cuelga del negocio?
 *
 * Igual que ver, menos los roles de solo lectura. La ruta de negocios ya hacía esta
 * distinción con su lista `canEdit`; lo que faltaba era aplicarla a las cotizaciones y a
 * los documentos, donde escribir es exactamente igual de grave.
 */
export function puedeEditarNegocio(deal: NegocioParaAcceso, user: UsuarioParaAcceso): boolean {
  if (SOLO_LECTURA.includes(user.role)) return false;
  return puedeVerNegocio(deal, user);
}

export type AccesoNegocio =
  | { ok: true; deal: NegocioParaAcceso & { id: string } }
  | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Carga lo mínimo del negocio y decide. Devuelve `not_found` y `forbidden` por separado
 * para que quien llama pueda distinguirlos en su log; **hacia el cliente los dos se
 * responden 404**, porque un 403 confirma que el id existe.
 */
export async function verificarAccesoANegocio(
  dealId: string,
  user: UsuarioParaAcceso,
  modo: "ver" | "editar" = "editar"
): Promise<AccesoNegocio> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, deletedAt: null },
    select: {
      id: true,
      assignedToId: true,
      assignedTo: { select: { plaza: true, teamLeaderId: true } },
    },
  });
  if (!deal) return { ok: false, reason: "not_found" };

  const permitido =
    modo === "ver" ? puedeVerNegocio(deal, user) : puedeEditarNegocio(deal, user);
  return permitido ? { ok: true, deal } : { ok: false, reason: "forbidden" };
}

/** ¿Este rol ve la empresa entera? Lo usan los objetos que no cuelgan de un negocio. */
export function tieneAccesoTotal(role: string): boolean {
  return ACCESO_TOTAL.includes(role);
}

/** Mensaje único para las capas que trabajan con `throw`. Se traduce a 404. */
export const FUERA_DE_ALCANCE = "Negocio no encontrado o sin acceso";
