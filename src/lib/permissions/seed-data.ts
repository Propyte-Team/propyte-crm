// La semilla de permisos y las diferencias deliberadas respecto a hoy.
// Módulo PURO. Ver spec §8 y §8.1.
import type { Permission } from "./catalog";

/**
 * Quién tiene cada permiso HOY, según las listas hardcodeadas del repo.
 * Es el "antes" contra el que se mide la paridad. ADMIN se omite: es comodín.
 *
 * Verificado contra el código 2026-08-17:
 *  - ADMIN_ROLES            src/server/admin.ts:18, bot-config.ts:8,
 *                           bot-playbook.ts:10, bot-agents.ts:9
 *  - PASSWORD_RESET_ROLES   src/server/admin.ts:26
 *  - COMMENT_RULES_ROLES    src/lib/comments/roles.ts
 */
export const LEGACY_ROLE_LISTS = {
  "usuarios.ver": ["DIRECTOR", "GERENTE"],
  "usuarios.editar": ["DIRECTOR", "GERENTE"],
  "usuarios.password": ["DIRECTOR"],
  "comisiones.reglas": ["DIRECTOR", "GERENTE"],
  "config.actividad": ["DIRECTOR", "GERENTE"],
  "integraciones.gestionar": ["DIRECTOR", "GERENTE"],
  "bot.configurar": ["DIRECTOR", "GERENTE"],
  "comentarios.gestionar": ["DIRECTOR", "GERENTE", "MARKETING"],
  "permisos.gestionar": [], // no existe hoy
} as const satisfies Record<Permission, readonly string[]>;

/**
 * Diferencias a propósito entre lo de hoy y lo que siembra ROLE_SEED.
 *
 * Existe esta lista porque un test de paridad estricto no admite mejoras:
 * cualquier cambio intencional lo pone en rojo, y la tentación entonces es
 * aflojar el test — que es como se pierde la red entera. Aquí se declaran, con
 * su motivo, y el test comprueba que ocurran Y que no haya ninguna otra.
 */
export const DIVERGENCIAS = [
  {
    role: "GERENTE",
    permission: "integraciones.gestionar",
    antes: true,
    despues: false,
    motivo:
      "Decisión de Luis (2026-08-17): un GERENTE no necesita las API keys, " +
      "que son credenciales de sistemas externos. Comprobado antes de aplicar: " +
      "hay un solo GERENTE (Karla Muñoz, alta 2026-08-11) con cero filas en " +
      "audit_logs, cero actividades y cero contactos. Si resultara equivocado, " +
      "la salida es un override por persona, no revertir la decisión.",
  },
] as const satisfies readonly {
  role: string;
  permission: Permission;
  antes: boolean;
  despues: boolean;
  motivo: string;
}[];

/**
 * Lo que se escribe en role_permissions.
 *
 * ADMIN no aparece: resolvePermission lo deja pasar antes de consultar nada.
 * Los permisos sensibles tampoco: solo se conceden por persona.
 */
export const ROLE_SEED = {
  DIRECTOR: [
    "usuarios.ver",
    "usuarios.editar",
    "comisiones.reglas",
    "config.actividad",
    "integraciones.gestionar",
    "bot.configurar",
    "comentarios.gestionar",
  ],
  GERENTE: [
    "usuarios.ver",
    "usuarios.editar",
    "comisiones.reglas",
    "config.actividad",
    // integraciones.gestionar: retirado a propósito, ver DIVERGENCIAS
    "bot.configurar",
    "comentarios.gestionar",
  ],
  MARKETING: ["comentarios.gestionar"],
} as const satisfies Record<string, readonly Permission[]>;
