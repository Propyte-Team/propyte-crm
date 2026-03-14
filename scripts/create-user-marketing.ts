// Script para crear usuario de marketing con acceso por código OTP
// Ejecutar: npx tsx scripts/create-user-marketing.ts
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  const email = "marketing@nativatulum.mx";

  // Verificar si ya existe
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Usuario ${email} ya existe (id: ${existing.id})`);
    return;
  }

  // Generar contraseña temporal (el usuario solicitará un código por email)
  const tempPassword = crypto.randomBytes(32).toString("hex");
  const passwordHash = await hash(tempPassword, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name: "Luis Flores",
      role: "MARKETING",
      careerLevel: "SR",
      plaza: "TULUM",
      isActive: true,
      passwordHash,
    },
  });

  console.log(`Usuario creado exitosamente:`);
  console.log(`  ID:    ${user.id}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Rol:   ${user.role}`);
  console.log(`  Plaza: ${user.plaza}`);
  console.log(`\nPara acceder, solicita un código desde la página de login.`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
