// Lógica pura de la pantalla "Visibilidad de campos" (E7 #968): resumen por rol,
// acciones por grupo y cuándo pedir confirmación. Sin Prisma ni React → testeable.

export type Access = "HIDDEN" | "READ" | "EDIT";

export interface PermisoCelda {
  fieldKey: string;
  role: string;
  access: Access;
}

/** Roles configurables (mismo orden que usa la API de core-fields). */
export const ROLES_CONFIGURABLES = [
  "ADMIN", "ASESOR", "BROKER", "MANTENIMIENTO", "DIRECTOR", "GERENTE",
  "TEAM_LEADER", "ASESOR_SR", "ASESOR_JR", "HOSTESS", "MARKETING", "DEVELOPER_EXT",
] as const;

export interface ResumenRol {
  role: string;
  ocultos: number;
  soloLectura: number;
}

/** Cuenta ocultos / solo lectura por rol (solo roles con alguna restricción). */
export function resumenPorRol(perms: PermisoCelda[], roles: readonly string[]): ResumenRol[] {
  return roles
    .map((role) => {
      const mias = perms.filter((p) => p.role === role);
      return {
        role,
        ocultos: mias.filter((p) => p.access === "HIDDEN").length,
        soloLectura: mias.filter((p) => p.access === "READ").length,
      };
    })
    .filter((r) => r.ocultos > 0 || r.soloLectura > 0);
}

/** "3 ocultos, 2 solo lectura" / "Sin restricciones". */
export function textoResumen(r: Pick<ResumenRol, "ocultos" | "soloLectura"> | undefined): string {
  if (!r || (r.ocultos === 0 && r.soloLectura === 0)) return "Sin restricciones";
  const partes: string[] = [];
  if (r.ocultos) partes.push(`${r.ocultos} ${r.ocultos === 1 ? "oculto" : "ocultos"}`);
  if (r.soloLectura) partes.push(`${r.soloLectura} solo lectura`);
  return partes.join(", ");
}

/** Acceso efectivo de una celda (default EDIT). */
export function accesoDe(perms: PermisoCelda[], fieldKey: string, role: string): Access {
  return perms.find((p) => p.fieldKey === fieldKey && p.role === role)?.access ?? "EDIT";
}

/**
 * Campos de una lista que un cambio ocultaría NUEVAMENTE (hoy no están ocultos).
 * Sirve para decidir si hay que confirmar.
 */
export function camposQueSeOcultan(
  perms: PermisoCelda[],
  role: string,
  fieldKeys: string[],
  nuevo: Access
): string[] {
  if (nuevo !== "HIDDEN") return [];
  return fieldKeys.filter((k) => accesoDe(perms, k, role) !== "HIDDEN");
}

/** Aplica de forma optimista un cambio de acceso a varias celdas de un rol. */
export function aplicarAcceso(
  perms: PermisoCelda[],
  role: string,
  fieldKeys: string[],
  access: Access
): PermisoCelda[] {
  const claves = new Set(fieldKeys);
  const resto = perms.filter((p) => !(p.role === role && claves.has(p.fieldKey)));
  return access === "EDIT" ? resto : [...resto, ...fieldKeys.map((fieldKey) => ({ fieldKey, role, access }))];
}
