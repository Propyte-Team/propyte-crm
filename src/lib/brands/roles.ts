// Quién puede ver y quién puede editar las marcas del agente — módulo PURO
// (testeable en node, sin React/Next/Prisma). 2026-10-09, spec marcas-agente.
//
// Hay DOS listas a propósito, porque las marcas se tocan desde dos pantallas con guards distintos:
//   · LECTURA = los roles de /conexiones (ADMIN, DIRECTOR, GERENTE, MARKETING). Marketing necesita
//     ver las marcas para asignar cada cuenta (LeadConnector) a la suya, y buscar desarrollos.
//   · ESCRITURA = los roles de la configuración del bot (ADMIN, DIRECTOR, GERENTE). Una marca define
//     persona, conocimiento, canales y si el agente contesta solos: es configuración del bot, así
//     que no se le concede a MARKETING más de lo que ya puede cambiar en la config global.
// Si se unificaran en una sola, o MARKETING quedaría sin poder asignar cuentas, o editaría lo que
// el agente le dice a los clientes.
//
// Fail-closed: un rol ausente o desconocido no pasa.
export const BRAND_READ_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"] as const;
export const BRAND_WRITE_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"] as const;

/** True si el rol puede listar marcas y buscar desarrollos. */
export function canReadBrands(role: string | null | undefined): boolean {
  if (!role) return false;
  return (BRAND_READ_ROLES as readonly string[]).includes(role);
}

/** True si el rol puede crear, editar y borrar marcas. */
export function canWriteBrands(role: string | null | undefined): boolean {
  if (!role) return false;
  return (BRAND_WRITE_ROLES as readonly string[]).includes(role);
}
