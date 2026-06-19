// src/lib/mcp/auth.ts
import { timingSafeEqual } from "crypto";
import prisma from "@/lib/db";

export function checkBearer(header: string | null, expected: string): boolean {
  if (!expected) return false;
  if (!header?.startsWith("Bearer ")) return false;
  const got = header.slice(7).trim(); // gotcha conocido: \n trailing
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

let cachedUserId: string | null = null;
const SYSTEM_EMAIL = "mcp@propyte.local";

/** id del usuario-sistema MCP para AuditLog. Lanza si no existe (correr seed). */
export async function getMcpUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const u = await prisma.user.findUnique({ where: { email: SYSTEM_EMAIL }, select: { id: true } });
  if (!u) throw new Error("MCP system user missing: run scripts/seed-mcp-user.ts");
  cachedUserId = u.id;
  return u.id;
}
