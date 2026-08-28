"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { puedeVerTokenRevision } from "@/lib/mcp/revision/conexion";
import { CLAVE_TOKEN } from "@/lib/mcp/revision/token";

/**
 * El lado que ESCRIBE del token de la puerta de revisión.
 *
 * Vive aquí y no en `src/lib/mcp/revision/` a propósito: ese directorio es de solo
 * lectura y hay un test que lo recorre buscando escrituras. Meter el `upsert` ahí lo
 * rompería, y con razón — la puerta no debe poder cambiar su propia credencial.
 *
 * La separación no es estética: si mañana alguien agrega una tool y por comodidad importa
 * algo de este archivo, el guardia se lo dice.
 */

const RUTA_PANTALLA = "/admin/revision/conectar";

/**
 * Comprueba la sesión y devuelve el id del usuario.
 *
 * Se repite en las dos funciones en vez de confiar en el guardia de la página: una acción
 * de servidor es un endpoint público: quien conozca su identificador puede invocarla sin
 * pasar por la pantalla. El `redirect` del componente no la protege.
 */
async function exigirAdmin(): Promise<string> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado: se requiere iniciar sesión.");
  if (!puedeVerTokenRevision(session.user.role)) {
    throw new Error("No autorizado: solo ADMIN o DIRECTOR administran la puerta de revisión.");
  }
  return session.user.id;
}

/**
 * Genera un token nuevo y revoca el anterior en el mismo movimiento.
 *
 * 32 bytes en hexadecimal: el mismo largo que `openssl rand -hex 32`, que es lo que
 * documenta el spec para el arranque manual. Dos formas de generarlo que dieran largos
 * distintos harían dudar de cuál es el bueno.
 *
 * 🚨 EFECTO INMEDIATO Y SIN GRACIA. No hay ventana de convivencia: en cuanto esto
 * termina, el conector que Cowork tenga configurado deja de funcionar hasta que se
 * pegue la URL nueva. Es deliberado —una rotación que deja vivo el secreto viejo no
 * revoca nada— y la pantalla lo advierte antes de dejar pulsar.
 */
export async function rotarTokenRevision(): Promise<{ token: string; rotadoEn: string }> {
  const userId = await exigirAdmin();

  const token = randomBytes(32).toString("hex");
  const rotadoEn = new Date().toISOString();

  await prisma.systemConfig.upsert({
    where: { key: CLAVE_TOKEN },
    create: { key: CLAVE_TOKEN, value: { token, rotadoEn } },
    update: { value: { token, rotadoEn } },
  });

  // 🚨 El token NUNCA entra al registro. Un log de auditoría que guarda la credencial
  // convierte cada respaldo de la base en una copia del secreto, y la rotación deja de
  // servir de nada.
  await prisma.auditLog
    .create({
      data: {
        userId,
        action: "UPDATE",
        entity: "SystemConfig",
        entityId: CLAVE_TOKEN,
        changes: { source: "ui", rotado: true, rotadoEn },
      },
    })
    .catch(() => null);

  revalidatePath(RUTA_PANTALLA);
  return { token, rotadoEn };
}
