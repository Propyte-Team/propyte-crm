// Script para crear/actualizar usuarios admin del CRM
// Ejecutar: npx tsx scripts/seed-admin-users.ts
//
// Las contraseñas se leen de variables de entorno — NUNCA se escriben aquí.
// Este archivo tuvo contraseñas en texto plano hasta 2026-07-27; el historial de
// git sigue conteniéndolas, por eso esas credenciales fueron rotadas.
//
// Requiere en .env (no commitear):
//   SEED_ADMIN_PASSWORD_NACHO=...
//   SEED_ADMIN_PASSWORD_LUIS=...
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

const adminUsers = [
  {
    email: "nacho@propyte.com",
    name: "Nacho Propyte",
    passwordEnv: "SEED_ADMIN_PASSWORD_NACHO",
    role: "ADMIN" as const,
    plaza: "PDC" as const,
  },
  {
    email: "marketing@nativatulum.mx",
    name: "Luis Flores",
    passwordEnv: "SEED_ADMIN_PASSWORD_LUIS",
    role: "ADMIN" as const,
    plaza: "TULUM" as const,
  },
];

function readPassword(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${envVar}. Definila en .env antes de correr este script.`,
    );
  }
  if (value.length < 16) {
    throw new Error(`${envVar} es demasiado corta (mínimo 16 caracteres).`);
  }
  return value;
}

async function main() {
  // Validar todas las contraseñas antes de tocar la base: si falta una,
  // no queremos dejar a un usuario rotado y al otro no.
  const resolved = adminUsers.map((u) => ({ ...u, password: readPassword(u.passwordEnv) }));

  for (const userData of resolved) {
    const existing = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    const passwordHash = await hash(userData.password, 12);

    if (existing) {
      await prisma.user.update({
        where: { email: userData.email },
        data: { passwordHash, role: userData.role },
      });
      console.log(`Actualizado: ${userData.email} (rol: ${userData.role})`);
    } else {
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
    console.error("Error:", e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
