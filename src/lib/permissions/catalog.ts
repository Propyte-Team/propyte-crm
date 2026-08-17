// Catálogo de permisos — módulo PURO (sin imports, testeable en node).
//
// Vive en código y no en base a propósito: una clave de permiso está acoplada
// al código que la consulta. Si viviera en base, alguien podría borrarla desde
// una UI y dejar un can() preguntando por algo inexistente. En código,
// TypeScript no deja escribir una clave que no existe.
//
// `sensitive: true` = permite volverse otra persona o repartirse el resto de
// permisos. Un permiso sensible NUNCA tiene default de rol: solo se concede a
// una persona concreta y con razón escrita. Ver spec §4.1.

export interface PermissionMeta {
  label: string;
  sensitive?: true;
}

export const PERMISSIONS = {
  "usuarios.ver": { label: "Ver la lista de usuarios" },
  "usuarios.editar": { label: "Crear y editar usuarios" },
  "usuarios.password": { label: "Restablecer contraseñas de otros", sensitive: true },
  "comisiones.reglas": { label: "Editar las reglas de comisión" },
  "config.actividad": { label: "Configurar el acuerdo de actividad" },
  // NO sensible: marcarlo se lo quitaría también a DIRECTOR. Lo único
  // decidido fue que GERENTE lo pierda, vía DIVERGENCIAS. Ver spec §4.1.
  "integraciones.gestionar": { label: "Conectores, webhooks y API keys" },
  "bot.configurar": { label: "Configuración del bot, playbooks y agentes" },
  "comentarios.gestionar": { label: "Reglas de comentarios en redes" },
  "permisos.gestionar": { label: "Administrar este moderador de permisos", sensitive: true },
} as const satisfies Record<string, PermissionMeta>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const SENSITIVE_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => (PERMISSIONS[p] as PermissionMeta).sensitive === true,
);

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function isSensitive(value: string): boolean {
  return isPermission(value) && (PERMISSIONS[value] as PermissionMeta).sensitive === true;
}
