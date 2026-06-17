import { randomBytes } from "crypto";

/** Token público de la shortlist (URL /p/[token]). 16 bytes → base64url. */
export function generateShortlistToken(): string {
  return randomBytes(16).toString("base64url");
}
