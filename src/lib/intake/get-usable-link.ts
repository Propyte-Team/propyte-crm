import prisma from "@/lib/db";
import { isLinkUsable } from "./token";

/** Devuelve el link si es usable (existe, no revocado, no expirado); si no, null. */
export async function getUsableLink(token: string) {
  const link = await prisma.intakeLink.findUnique({ where: { token } });
  if (!link || link.deletedAt) return null;
  if (!isLinkUsable({ revokedAt: link.revokedAt, expiresAt: link.expiresAt }, new Date())) return null;
  return link;
}
