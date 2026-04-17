// ============================================================
// Seed usuarios migrados desde vieja DB
// Lee scripts/migrated-users.json (generado por migrate-to-new-db.ts)
// EJECUTAR DESPUÉS de prisma db push con nueva DATABASE_URL
//
//   npx tsx scripts/seed-migrated-users.ts
// ============================================================

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface MigratedUser {
  email: string;
  name: string;
  role: string;
  plaza: string;
  careerLevel: string;
  passwordHash: string;
  isActive: boolean;
  phone: string | null;
  avatarUrl: string | null;
}

async function main() {
  const jsonPath = path.join(__dirname, "migrated-users.json");

  if (!fs.existsSync(jsonPath)) {
    console.error("❌ No se encontró scripts/migrated-users.json");
    console.error("   Ejecuta primero: npx tsx scripts/migrate-to-new-db.ts");
    process.exit(1);
  }

  const users: MigratedUser[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`Encontrados ${users.length} usuarios para migrar\n`);

  for (const userData of users) {
    const existing = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (existing) {
      await prisma.user.update({
        where: { email: userData.email },
        data: {
          name: userData.name,
          role: userData.role as never,
          plaza: userData.plaza as never,
          careerLevel: (userData.careerLevel || "SR") as never,
          passwordHash: userData.passwordHash,
          isActive: userData.isActive,
          phone: userData.phone,
          avatarUrl: userData.avatarUrl,
        },
      });
      console.log(`✓ Actualizado: ${userData.email} (${userData.role})`);
    } else {
      await prisma.user.create({
        data: {
          email: userData.email,
          name: userData.name,
          role: userData.role as never,
          plaza: userData.plaza as never,
          careerLevel: (userData.careerLevel || "SR") as never,
          passwordHash: userData.passwordHash,
          isActive: userData.isActive,
          phone: userData.phone,
          avatarUrl: userData.avatarUrl,
        },
      });
      console.log(`✓ Creado: ${userData.email} (${userData.role})`);
    }
  }

  console.log("\n✅ Usuarios migrados exitosamente");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
