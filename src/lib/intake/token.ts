import { randomBytes } from "crypto";

/** Token url-safe (~16 chars) para el link público. */
export function generateToken(): string {
  return randomBytes(12).toString("base64url");
}

/** Un link es usable si no está revocado y no ha expirado. */
export function isLinkUsable(
  link: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date
): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt.getTime() < now.getTime()) return false;
  return true;
}

/** Caducidad por defecto: 15 días desde `now`. */
export function defaultExpiry(now: Date): Date {
  return new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
}
