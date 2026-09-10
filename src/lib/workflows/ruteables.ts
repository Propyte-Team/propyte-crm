/**
 * Quién puede recibir un lead. Una sola definición, sin base de datos.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Estas tres condiciones —activo, no borrado, correo que no
 * termina en `.local`— vivían solo dentro de `autoRouteLead` (`routableWhere`, routing.ts),
 * y el apartado (e) de la #678 pide publicarlas en la revisión diaria. Copiarlas allá
 * habría creado la segunda copia de la misma regla, que es exactamente el defecto que este
 * tablero lleva encontrando: la #730 (el enum de fuentes copiado a mano), la #682 (el
 * filtro de leads reales copiado en nueve sitios), la #715 A-03 (las listas de roles
 * copiadas tres veces, ya divergidas). Una revisión que mida «asesores ruteables» con su
 * propia copia del criterio publica un número que el reparto no usa, y entonces no mide el
 * reparto: mide una tercera versión de la verdad que nadie más ve.
 *
 * Sin imports a propósito, igual que `routing-diagnostico.ts`: así se puede probar sola y
 * la puede leer la puerta de revisión, que no tiene acceso a `@/lib/db`.
 */

/**
 * El dominio de las cuentas internas y de QA.
 *
 * AUD-20260710-09: el round-robin le asignó un lead REAL a un usuario de prueba. Desde
 * entonces el reparto excluye este dominio, y la bandeja lo excluye también al asignar a
 * mano (`lib/inbox/assign.ts`). No es cosmético: hoy `agentes@propyte.local` es dueño de
 * 88 de los 113 contactos vivos del CRM (#734), así que un conteo de asesores que no
 * descuente este dominio sobreestima la capacidad real de atención por un factor grande.
 */
export const DOMINIO_TECNICO = ".local";

/**
 * Los roles a los que el reparto le entrega leads cuando la regla no nombra otros.
 *
 * Es el default de `targets.roles` en `autoRouteLead`. Una regla puede nombrar roles
 * distintos; esta lista es la que aplica cuando no lo hace.
 */
export const ROLES_RUTEABLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR"] as const;

export type RolRuteable = (typeof ROLES_RUTEABLES)[number];

/**
 * Las condiciones que un usuario debe cumplir para recibir un lead, sin el filtro de rol
 * ni el de plaza. Se devuelve un objeto NUEVO en cada llamada en vez de exportar una
 * constante: el valor se esparce dentro de `where` que luego se mutan con más claves, y
 * una constante compartida invita a que un llamador le escriba encima al de al lado.
 */
export function usuarioRuteableWhere() {
  return {
    isActive: true,
    deletedAt: null,
    NOT: { email: { endsWith: DOMINIO_TECNICO } },
  };
}

/** Los asesores que el reparto puede elegir hoy, sin recortar por plaza. */
export function asesorRuteableWhere() {
  return { role: { in: [...ROLES_RUTEABLES] }, ...usuarioRuteableWhere() };
}

/** ¿Este correo es de una cuenta interna o de QA, y no de una persona? */
export function esCuentaTecnica(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(DOMINIO_TECNICO);
}

/**
 * Los roles de mando: a quién se escala un problema que el asesor no resolvió.
 *
 * Vive aquí, junto a `ROLES_RUTEABLES`, porque es la otra mitad de la misma pregunta —quién
 * puede recibir algo— y porque ya tenía DOS copias en el repositorio: el `managerWhere` de
 * `sendToPond` (routing.ts) y el aviso de vencimiento de la #756. Una tercera copia era
 * cuestión de tiempo, y es exactamente el defecto de la #715 A-03, la #730 y la #682.
 */
export const ROLES_DE_MANDO = ["GERENTE", "DIRECTOR", "ADMIN"] as const;

/** Quién es mando hoy, sin recortar por plaza. Objeto nuevo en cada llamada, como los otros. */
export function mandoWhere() {
  return { role: { in: [...ROLES_DE_MANDO] }, ...usuarioRuteableWhere() };
}

/**
 * El complemento: las cuentas del dominio técnico que TIENEN rol de asesor.
 *
 * Se publica junto al conteo de ruteables porque el par es lo que se lee, no cada número
 * suelto: «3 ruteables» no dice nada, «3 ruteables y 1 técnica» explica por qué
 * `usuarios_activos` de la revisión da un número más alto.
 */
export function asesorTecnicoWhere() {
  return {
    role: { in: [...ROLES_RUTEABLES] },
    isActive: true,
    deletedAt: null,
    email: { endsWith: DOMINIO_TECNICO },
  };
}
