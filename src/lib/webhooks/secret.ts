// Secret de firma HMAC de los webhooks salientes. El valor completo solo sale del servidor
// una vez (al crear o regenerar); las listas llevan una pista enmascarada.
import { randomBytes } from "crypto";

/** Secret nuevo para firmar (HMAC-SHA256): 32 bytes aleatorios en hex. */
export function generarSecretWebhook(): string {
  return randomBytes(32).toString("hex");
}

/** Pista enmascarada: «••••ab12» (últimos 4). */
export function pistaDeSecret(secret: string): string {
  return `••••${secret.slice(-4)}`;
}

/** Quita `secret` de la fila y añade `secretHint`. Nunca devuelve el valor completo. */
export function sinSecretConPista<T extends { secret: string }>(fila: T): Omit<T, "secret"> & { secretHint: string } {
  const { secret, ...resto } = fila;
  return { ...resto, secretHint: pistaDeSecret(secret) };
}
