// scripts/seed-mcp-user.ts
import prisma from "@/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  const email = "mcp@propyte.local";
  // Sin login interactivo: hash de un secreto aleatorio inutilizable.
  const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", isActive: true },
    create: { email, name: "MCP Admin", role: "ADMIN", plaza: "PDC", passwordHash, isActive: true },
  });
  console.log("MCP system user:", user.id);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
