import { getServerSession as nextAuthGetServerSession } from "next-auth";
import { authOptions } from "./options";

/**
 * Obtiene la sesión del usuario actual desde el servidor.
 * Wrapper sobre getServerSession de NextAuth con las opciones preconfiguradas.
 * @returns La sesión del usuario o null si no está autenticado
 */
export async function getServerSession() {
  return nextAuthGetServerSession(authOptions);
}

/**
 * Obtiene la sesión del usuario o lanza un error si no está autenticado.
 * Útil en endpoints de API que requieren autenticación obligatoria.
 * @throws Error si no hay sesión activa
 * @returns La sesión del usuario autenticado
 */
export async function requireSession() {
  const session = await getServerSession();

  if (!session?.user) {
    throw new Error("No autorizado: se requiere iniciar sesión");
  }

  return session;
}

/**
 * Obtiene el ID del usuario actual desde la sesión del servidor.
 * @returns El ID del usuario o null si no está autenticado
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession();
  return session?.user?.id ?? null;
}

/**
 * Obtiene el rol del usuario actual desde la sesión del servidor.
 * @returns El rol del usuario o null si no está autenticado
 */
export async function getCurrentUserRole(): Promise<string | null> {
  const session = await getServerSession();
  return session?.user?.role ?? null;
}
