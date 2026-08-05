// Mismo conjunto que ya puede borrar contactos en src/app/api/contacts/route.ts
// (unión de FULL_ACCESS_ROLES y PLAZA_ACCESS_ROLES tal como están escritos ahí).
// Se declara UNA vez aquí porque marcar spam borra datos: no debe divergir de
// quién puede borrar un contacto.
export const CAN_MARK_SPAM_ROLES = [
  "ADMIN",
  "DIRECTOR",
  "GERENTE",
  "DEVELOPER_EXT",
  "MANTENIMIENTO",
] as const;

export function canMarkSpam(role: string): boolean {
  return (CAN_MARK_SPAM_ROLES as readonly string[]).includes(role);
}
