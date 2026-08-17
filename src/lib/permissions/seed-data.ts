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
 *  - Conectores             src/app/api/admin/connectors/route.ts:18,
 *                           connectors/[id]/route.ts:9, connectors/test/route.ts:8,
 *                           connectors/[id]/test-mapping/route.ts:9 (4 archivos
 *                           route.ts) más src/app/(dashboard)/conexiones/page.tsx:6
 *                           (1 página) → ["ADMIN","DIRECTOR","GERENTE","MARKETING"].
 *                           Nota: la ruta hermana connectors/health/route.ts:8 NO
 *                           incluye MARKETING (inconsistencia existente, no
 *                           arreglada aquí — la lista dominante de los 4 route.ts
 *                           más la página manda).
 *  - Webhooks y API keys    ADMIN_ROLES en src/server/admin.ts → sin MARKETING.
 */
export const LEGACY_ROLE_LISTS = {
  "usuarios.ver": ["DIRECTOR", "GERENTE"],
  "usuarios.editar": ["DIRECTOR", "GERENTE"],
  "usuarios.password": ["DIRECTOR"],
  "comisiones.reglas": ["DIRECTOR", "GERENTE"],
  "config.sistema": ["DIRECTOR", "GERENTE"],
  "integraciones.conectores": ["DIRECTOR", "GERENTE", "MARKETING"],
  "integraciones.apikeys": ["DIRECTOR", "GERENTE"],
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
    permission: "integraciones.apikeys",
    antes: true,
    despues: false,
    motivo:
      "Decisión de Luis (2026-08-17): un GERENTE no necesita las API keys, " +
      "que son credenciales de sistemas externos. Conserva los conectores de " +
      "leads (integraciones.conectores): nadie pidió quitárselos. Comprobado " +
      "antes de aplicar: hay un solo GERENTE (Karla Muñoz, alta 2026-08-11) " +
      "con cero filas en audit_logs, cero actividades y cero contactos. Si " +
      "resultara equivocado, la salida es un override por persona, no " +
      "revertir la decisión.",
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
    "config.sistema",
    "integraciones.conectores",
    "integraciones.apikeys",
    "bot.configurar",
    "comentarios.gestionar",
  ],
  GERENTE: [
    "usuarios.ver",
    "usuarios.editar",
    "comisiones.reglas",
    "config.sistema",
    "integraciones.conectores",
    // integraciones.apikeys: retirado a propósito, ver DIVERGENCIAS
    "bot.configurar",
    "comentarios.gestionar",
  ],
  MARKETING: ["integraciones.conectores", "comentarios.gestionar"],
} as const satisfies Record<string, readonly Permission[]>;

/**
 * Accesos que se pierden por marcar un permiso como sensible, no por una
 * decisión sobre ese rol. Los sensibles no se siembran nunca, así que quien
 * hoy los tiene por rol necesitará un override por persona ANTES de que su
 * superficie se migre, o se queda fuera sin que nadie lo haya decidido.
 *
 * No es una divergencia: DIVERGENCIAS son decisiones sobre un rol. Esto es
 * consecuencia mecánica del diseño, y va anotado para que la fase 1 no lo
 * olvide.
 */
export const PERDIDAS_POR_SENSIBILIDAD = [
  {
    role: "DIRECTOR",
    permission: "usuarios.password",
    accion:
      "Conceder override por persona a cada DIRECTOR activo antes de migrar " +
      "resetUserPassword() en la fase 1, o perderán el botón de restablecer contraseña.",
  },
] as const satisfies readonly {
  role: string;
  permission: Permission;
  accion: string;
}[];
