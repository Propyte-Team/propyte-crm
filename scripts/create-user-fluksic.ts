// Crea el usuario Felipe Luksic (fluksic@propyte.com) como ADMIN
// Ejecutar: npx tsx scripts/create-user-fluksic.ts
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "fluksic@propyte.com";
  const plainPassword = "Caro202603";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Usuario ${email} ya existe (id: ${existing.id}). Actualizando password + rol ADMIN.`);
    const passwordHash = await hash(plainPassword, 12);
    const updated = await prisma.user.update({
      where: { email },
      data: {
        name: "Felipe Luksic",
        role: "ADMIN",
        isActive: true,
        passwordHash,
      },
    });
    console.log(`  ID:    ${updated.id}`);
    console.log(`  Email: ${updated.email}`);
    console.log(`  Rol:   ${updated.role}`);
    return;
  }

  const passwordHash = await hash(plainPassword, 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: "Felipe Luksic",
      role: "ADMIN",
      careerLevel: "GERENTE",
      plaza: "PDC",
      isActive: true,
      passwordHash,
    },
  });

  console.log(`Usuario creado:`);
  console.log(`  ID:    ${user.id}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Rol:   ${user.role}`);
  console.log(`  Plaza: ${user.plaza}`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
