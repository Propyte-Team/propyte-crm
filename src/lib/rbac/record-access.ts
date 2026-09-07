// Acceso a nivel de objeto para los records núcleo (#711).
//
// Los campos personalizados y los vínculos entre records se manejan por `object` + `id`
// genéricos, así que necesitan un punto único que traduzca ese par al control de acceso
// que corresponda. Contactos y negocios ya tienen el suyo; esto solo los enruta.

import { verificarAccesoANegocio, type UsuarioParaAcceso } from "./deal-access";

export type ObjetoRecord = "contact" | "deal" | (string & {});

/**
 * ¿Puede este usuario tocar el record?
 *
 * - `deal` → el control de negocios (dueño / equipo / plaza / dirección).
 * - `contact` → el control de contactos, que ya existía en `getContactAccessInfo`.
 * - Cualquier otro objeto (unidades, desarrollos) → **sí**. Son catálogo compartido: no
 *   tienen dueño, y negarlos rompería flujos que hoy funcionan. Si algún día un objeto
 *   nuevo tiene dueño, hay que añadirlo aquí explícitamente y no confiar en este default.
 */
export async function puedeTocarRecord(
  object: ObjetoRecord,
  id: string,
  user: UsuarioParaAcceso,
  modo: "ver" | "editar" = "editar"
): Promise<boolean> {
  if (object === "deal") {
    const acceso = await verificarAccesoANegocio(id, user, modo);
    return acceso.ok;
  }

  if (object === "contact") {
    const { getContactAccessInfo } = await import("@/server/contacts");
    const acceso = await getContactAccessInfo(id, { user });
    return acceso.ok;
  }

  return true;
}
