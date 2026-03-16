// Script para crear usuarios admin del CRM
// Ejecutar: npx tsx scripts/seed-admin-users.ts
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

const adminUsers = [
  {
    email: "fluksic@nativatulum.mx",
    name: "Felipe Solar Luksic",
    password: "Luisesmifav",
    role: "ADMIN" as const,
    plaza: "TULUM" as const,
  },
  {
    email: "marketing@nativatulum.mx",
    name: "Luis Flores",
    password: "Propyte2026",
    role: "ADMIN" as const,
    plaza: "TULUM" as const,
  },
];

async function main() {
  for (const userData of adminUsers) {
    const existing = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (existing) {
      // Actualizar contraseña y rol si ya existe
      const passwordHash = await hash(userData.password, 12);
      await prisma.user.update({
        where: { email: userData.email },
        data: { passwordHash, role: userData.role },
      });
      console.log(`Actualizado: ${userData.email} (rol: ${userData.role})`);
    } else {
      const passwordHash = await hash(userData.password, 12);
      const user = await prisma.user.create({
        data: {
          email: userData.email,
          name: userData.name,
          role: userData.role,
          careerLevel: "SR",
          plaza: userData.plaza,
          isActive: true,
          passwordHash,
        },
      });
      console.log(`Creado: ${user.email} (id: ${user.id}, rol: ${user.role})`);
    }
  }

  console.log("\nUsuarios admin listos.");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
