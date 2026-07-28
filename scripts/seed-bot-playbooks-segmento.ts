// Aplica a la BD los playbooks por segmento y los engancha a su agente. Idempotente.
// Ejecutar: npx tsx scripts/seed-bot-playbooks-segmento.ts
//
// El CONTENIDO de los playbooks vive en src/lib/bot/playbook/segment-playbooks.ts
// (versionado y con tests que validan los targetField contra la whitelist). Este
// script solo lo escribe.
//
// Notas verificadas contra el código, no supuestas:
//   * `captureType: "ENUM"` SÍ funciona con targets `custom.*`: coerceEnum valida
//     contra el enumOptions de la tarea, no contra la whitelist de nativos.
//   * `isFieldFilled` (engine.ts) lee `contact.custom[key]`, así que skipIfFilled
//     también respeta los campos custom.
//   * Los playbooks se crean con isActive=true. El runner NO filtra por
//     playbook.isActive cuando el playbook viene de un agente (solo mira deletedAt
//     y tasks.isActive), así que true es la dirección segura: false no los apagaría
//     hoy, pero sí en silencio si alguien agrega ese filtro mañana.
//   * Re-ejecutable: reemplaza las tareas conservando el id del playbook. Es seguro
//     para conversaciones en curso porque ConversationPlaybookState guarda
//     currentTaskKey/completedTaskKeys como STRINGS, sin FK a BotTask.
//
// Esto NO activa a los agentes. Mientras BotAgentProfile.isActive siga en false, el
// bot se comporta igual que hoy. Activar es un paso aparte y consciente.
import { PrismaClient } from "@prisma/client";
import {
  SEGMENT_PLAYBOOKS,
  type SegmentTaskSpec,
} from "@/lib/bot/playbook/segment-playbooks";

const prisma = new PrismaClient();

function toTaskCreate(tasks: SegmentTaskSpec[]) {
  return tasks.map((t, i) => ({
    order: i,
    key: t.key,
    targetField: t.targetField,
    captureType: t.captureType,
    objective: t.objective,
    required: t.required ?? true,
    skipIfFilled: true,
    isActive: true,
    enumOptions: t.enumOptions ?? [],
    ...(t.extractionHint ? { extractionHint: t.extractionHint } : {}),
  }));
}

async function main() {
  for (const spec of SEGMENT_PLAYBOOKS) {
    const agent = await prisma.botAgentProfile.findFirst({
      where: { name: spec.agentName, deletedAt: null },
    });
    if (!agent) {
      console.error(
        `✗ No existe el agente "${spec.agentName}". Se omite "${spec.name}" — ` +
          `siembra primero los BotAgentProfile.`,
      );
      continue;
    }

    const existing = await prisma.botPlaybook.findFirst({
      where: { name: spec.name, deletedAt: null },
    });

    let playbookId: string;
    if (existing) {
      // Reemplaza las tareas conservando el id del playbook, para que un agente ya
      // enganchado no quede apuntando a un registro huérfano.
      await prisma.botTask.deleteMany({ where: { playbookId: existing.id } });
      const updated = await prisma.botPlaybook.update({
        where: { id: existing.id },
        data: {
          description: spec.description,
          isActive: true,
          tasks: { create: toTaskCreate(spec.tasks) },
        },
        include: { tasks: true },
      });
      playbookId = updated.id;
      console.log(`↻ "${updated.name}" actualizado — ${updated.tasks.length} tareas`);
    } else {
      const created = await prisma.botPlaybook.create({
        data: {
          name: spec.name,
          description: spec.description,
          isActive: true,
          tasks: { create: toTaskCreate(spec.tasks) },
        },
        include: { tasks: true },
      });
      playbookId = created.id;
      console.log(`+ "${created.name}" creado — ${created.tasks.length} tareas`);
    }

    if (agent.playbookId === playbookId) {
      console.log(`  = "${agent.name}" ya apuntaba a este playbook`);
    } else {
      await prisma.botAgentProfile.update({
        where: { id: agent.id },
        data: { playbookId },
      });
      console.log(`  → "${agent.name}" enganchado (antes: ${agent.playbookId ?? "sin playbook"})`);
    }
  }

  const activos = await prisma.botAgentProfile.count({
    where: { deletedAt: null, isActive: true },
  });
  console.log(
    `\nListo. Agentes ACTIVOS ahora mismo: ${activos}. ` +
      (activos === 0
        ? "Con 0 activos el bot sigue usando el playbook global — estos no corren hasta que actives los agentes."
        : "Ojo: ya hay agentes activos, estos playbooks entran en vigor de inmediato."),
  );
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
