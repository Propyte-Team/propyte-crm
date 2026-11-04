// Lógica pura de la tabla de Usuarios (búsqueda/filtros) y del formulario (ayuda por rol,
// nivel de carrera). Sin React, para probarla en node.

export interface UsuarioFiltrable {
  name: string;
  email: string;
  role: string;
  plaza: string;
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** ¿El nombre o el correo contienen el texto (sin acentos ni mayúsculas)? Vacío = todos. */
export function coincideBusqueda(u: { name: string; email: string }, busqueda: string): boolean {
  const q = normalizar(busqueda);
  if (!q) return true;
  return normalizar(u.name).includes(q) || normalizar(u.email).includes(q);
}

export function filtrarUsuarios<T extends UsuarioFiltrable>(
  usuarios: T[],
  filtros: { busqueda?: string; rol?: string; plaza?: string },
): T[] {
  const { busqueda = "", rol = "ALL", plaza = "ALL" } = filtros;
  return usuarios.filter(
    (u) =>
      (rol === "ALL" || u.role === rol) &&
      (plaza === "ALL" || u.plaza === plaza) &&
      coincideBusqueda(u, busqueda),
  );
}

/** Roles de asesor: los únicos con nivel de carrera (Junior → Senior → Top Producer…). */
const ROLES_CON_NIVEL_CARRERA = ["ASESOR", "ASESOR_SR", "ASESOR_JR"];

export function rolUsaNivelCarrera(role: string): boolean {
  return ROLES_CON_NIVEL_CARRERA.includes(role);
}

/** Qué puede hacer cada rol, en una frase (resumen de los permisos reales del CRM). */
export const AYUDA_ROL: Record<string, string> = {
  ADMIN: "Acceso total: usuarios, comisiones, configuración y todos los contactos de todas las plazas.",
  DIRECTOR: "Ve todos los contactos y la operación de todas las plazas, y administra usuarios y comisiones.",
  GERENTE: "Ve y gestiona los contactos de su plaza, administra usuarios y comisiones, y reparte el inbox.",
  TEAM_LEADER: "Ve los contactos de su equipo y reparte a su equipo los leads sin asignar.",
  ASESOR_SR: "Trabaja solo sus propios contactos y actividades; recibe leads asignados.",
  ASESOR_JR: "Trabaja solo sus propios contactos y actividades; recibe leads asignados.",
  ASESOR: "Trabaja solo sus propios contactos y actividades; recibe leads asignados.",
  BROKER: "Trabaja solo sus propios contactos y actividades; no recibe leads del reparto.",
  HOSTESS: "Solo consulta: ve los contactos pero no los modifica ni se adueña de leads.",
  MARKETING: "Solo consulta: ve los contactos y no los modifica ni se adueña de leads.",
  MANTENIMIENTO: "Acceso de consulta a todos los contactos; no los modifica.",
  DEVELOPER_EXT: "Desarrollador externo: ve todos los contactos; no se adueña de leads.",
};

export function ayudaDeRol(role: string): string | undefined {
  return AYUDA_ROL[role];
}
