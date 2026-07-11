// Script para crear el playbook base de calificación del bot (inactivo por default)
// Ejecutar: npx tsx scripts/seed-bot-playbook.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PLAYBOOK_NAME = "Calificación base";

async function main() {
  const existing = await prisma.botPlaybook.findFirst({
    where: { name: PLAYBOOK_NAME, deletedAt: null },
  });

  if (existing) {
    console.log(`"${PLAYBOOK_NAME}" ya existe (id: ${existing.id}), skip.`);
    return;
  }

  const playbook = await prisma.botPlaybook.create({
    data: {
      name: PLAYBOOK_NAME,
      description:
        "Playbook base de calificación: nombre, presupuesto, zona, tipo de propiedad y plazo de compra.",
      isActive: false,
      tasks: {
        create: [
          {
            order: 0,
            key: "nombre",
            captureType: "FULL_NAME",
            targetField: "firstName",
            required: true,
            skipIfFilled: true,
            objective:
              "Pregunta su nombre para poder dirigirte a él o ella de forma personal.",
          },
          {
            order: 1,
            key: "presupuesto",
            captureType: "BUDGET_RANGE",
            targetField: "budgetMax",
            objective:
              "Pregunta el rango de presupuesto de inversión que maneja.",
          },
          {
            order: 2,
            key: "zona",
            captureType: "ZONE",
            targetField: "preferredZone",
            objective: "Pregunta en qué zona o destino está buscando.",
          },
          {
            order: 3,
            key: "tipo_propiedad",
            captureType: "ENUM",
            targetField: "propertyType",
            objective: "Pregunta qué tipo de propiedad busca.",
            enumOptions: [
              { value: "DEPARTAMENTO", synonyms: ["depa", "departamento", "depto"] },
              { value: "CASA", synonyms: ["casa"] },
              { value: "TERRENO", synonyms: ["terreno", "lote"] },
              { value: "MACROLOTE", synonyms: ["macrolote"] },
              { value: "LOCAL_COMERCIAL", synonyms: ["local", "comercial"] },
              { value: "OTRO", synonyms: ["otro"] },
            ],
          },
          {
            order: 4,
            key: "plazo",
            captureType: "ENUM",
            targetField: "purchaseTimeline",
            objective: "Pregunta en qué plazo planea comprar.",
            enumOptions: [
              {
                value: "IMMEDIATE",
                synonyms: ["ya", "ahora", "inmediato", "de inmediato"],
              },
              {
                value: "ONE_TO_THREE_MONTHS",
                synonyms: ["1 a 3 meses", "pronto", "unos meses"],
              },
              {
                value: "THREE_TO_SIX_MONTHS",
                synonyms: ["3 a 6 meses", "medio año"],
              },
              {
                value: "SIX_PLUS_MONTHS",
                synonyms: ["más de 6 meses", "el próximo año", "después"],
              },
            ],
          },
        ],
      },
    },
    include: { tasks: true },
  });

  console.log(
    `Creado playbook "${playbook.name}" (id: ${playbook.id}) con ${playbook.tasks.length} tareas. isActive=${playbook.isActive}`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("Error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
