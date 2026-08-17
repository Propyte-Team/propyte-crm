// Siembra role_permissions desde ROLE_SEED. Idempotente: se puede correr
// las veces que haga falta — la segunda corrida no duplica nada.
//
// Correr con: npm run seed:permissions
import { PrismaClient } from "@prisma/client";
import { ROLE_SEED } from "../src/lib/permissions/seed-data";
import { isSensitive } from "../src/lib/permissions/catalog";

const prisma = new PrismaClient();

async function main() {
  let creados = 0;
  let yaEstaban = 0;

  for (const [role, permisos] of Object.entries(ROLE_SEED)) {
    for (const permission of permisos) {
      // Cinturón además del test: un sensible en la semilla sería un agujero
      // silencioso, así que el script se niega en vez de escribirlo.
      if (isSensitive(permission)) {
        throw new Error(
          `ABORTADO: ${permission} es sensible y no puede sembrarse a un rol (${role}). ` +
            `Los sensibles solo se conceden por persona.`,
        );
      }

      const existente = await prisma.rolePermission.findUnique({
        where: { role_permission: { role: role as never, permission } },
        select: { id: true },
      });

      if (existente) {
        yaEstaban++;
        continue;
      }

      await prisma.rolePermission.create({
        data: { role: role as never, permission },
      });
      creados++;
      console.log(`  + ${role} → ${permission}`);
    }
  }

  console.log(`\nSemilla lista: ${creados} creados, ${yaEstaban} ya existían.`);

  // Lo que la semilla NO hace, dicho en voz alta para que nadie lo asuma:
  console.log(
    "\nRecordatorio: ADMIN no se siembra (es comodín) y los permisos " +
      "sensibles tampoco (solo por persona). Ninguna superficie del CRM " +
      "consulta can() todavía: esto no cambia el comportamiento de nada.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
