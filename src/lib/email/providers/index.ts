// Registro de proveedores de correo del asesor (#885). Ver types.ts para cómo sumar uno.
import { gmailProvider } from "./gmail"
import type { ConexionCorreo, EmailProvider, EmailProviderId } from "./types"

export * from "./types"

/** En orden de preferencia: si un asesor conectara dos, se usa el primero conectado. */
export const PROVEEDORES: readonly EmailProvider[] = [gmailProvider]

export function proveedorPorId(id: string): EmailProvider | undefined {
  return PROVEEDORES.find((p) => p.id === id)
}

/** Lo que la interfaz necesita saber para decidir qué hace el botón «Correo». */
export interface EstadoCorreo extends ConexionCorreo {
  proveedor: EmailProviderId | null
  nombreProveedor: string | null
  /** Pantalla donde conectar (o reconectar) la cuenta. */
  urlConectar: string
  /** Proveedores que el CRM sabe conectar, para el mensaje «Conecta tu…». */
  disponibles: { id: EmailProviderId; nombre: string; urlConectar: string }[]
}

/**
 * Proveedor con el que este usuario envía, y su estado. Prefiere uno usable; si solo hay
 * conexiones vencidas, devuelve la primera para poder decir «reconecta tu Gmail».
 * Nunca lanza (las `conexion()` tampoco).
 */
export async function resolverCorreoDelUsuario(
  userId: string,
): Promise<{ provider: EmailProvider | null; estado: EstadoCorreo }> {
  const disponibles = PROVEEDORES.map((p) => ({ id: p.id, nombre: p.nombre, urlConectar: p.urlConectar }))
  const conexiones = await Promise.all(PROVEEDORES.map(async (p) => ({ p, c: await p.conexion(userId) })))

  const elegido =
    conexiones.find(({ c }) => c.conectado && !c.requiereReconexion) ??
    conexiones.find(({ c }) => c.conectado) ??
    null

  if (!elegido) {
    return {
      provider: null,
      estado: {
        conectado: false,
        requiereReconexion: false,
        proveedor: null,
        nombreProveedor: null,
        urlConectar: PROVEEDORES[0].urlConectar,
        disponibles,
      },
    }
  }

  return {
    provider: elegido.p,
    estado: {
      ...elegido.c,
      proveedor: elegido.p.id,
      nombreProveedor: elegido.p.nombre,
      urlConectar: elegido.p.urlConectar,
      disponibles,
    },
  }
}
