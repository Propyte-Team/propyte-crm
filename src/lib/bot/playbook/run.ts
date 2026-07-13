// Orquestador de un paso de playbook dentro de botRespond (Anexo Técnico §B-Task 8).
// Regla de oro: NUNCA debe romper la respuesta del bot. Cualquier error en
// extracción/captura/aplicación/avance cae de vuelta al objective de la ruta A
// (buildOpener/goal en bot-respond.ts).
import type { PrismaClient, PlaybookRunStatus } from "@prisma/client";
import type { BotMessage } from "../claude";
import { extractFields, type ExtractTaskLite } from "./extract";
import { coerceCapture, type EnumOption } from "./capture";
import { applyCapture } from "./apply";
import { nextTask, buildObjective, COMPLETION_OBJECTIVE, type PlaybookTaskLite } from "./engine";

export interface PlaybookTaskFull {
  key: string;
  order: number;
  objective: string;
  targetField: string;
  captureType: string;
  enumOptions: unknown;
  required: boolean;
  skipIfFilled: boolean;
}

export async function runPlaybookStep(
  db: PrismaClient,
  args: {
    playbook: { id: string; tasks: PlaybookTaskFull[] };
    conversationId: string;
    contact: any;
    messages: BotMessage[];
    model: string;
  },
): Promise<{ objective?: string; status: PlaybookRunStatus }> {
  try {
    const { playbook, conversationId, contact, messages, model } = args;
    const tasks = playbook.tasks;

    const state = await db.conversationPlaybookState.upsert({
      where: { conversationId },
      create: {
        id: crypto.randomUUID(),
        conversationId,
        playbookId: playbook.id,
        status: "IN_PROGRESS",
        completedTaskKeys: [],
      },
      update: {},
    });

    let completedKeys = ((state.completedTaskKeys as string[]) ?? []) as string[];

    const pending = tasks.filter((t) => !completedKeys.includes(t.key));
    const newlyDone: string[] = [];

    if (pending.length > 0) {
      const extractTasks: ExtractTaskLite[] = pending.map((t) => ({
        key: t.key,
        objective: t.objective,
        captureType: t.captureType,
        enumOptions: t.enumOptions as { value: string; synonyms?: string[] }[],
      }));
      const extracted = await extractFields({ messages, tasks: extractTasks, model });

      for (const t of pending) {
        const raw = extracted[t.key];
        if (typeof raw !== "string" || !raw.trim()) continue;

        const res = coerceCapture(
          {
            targetField: t.targetField,
            captureType: t.captureType as any,
            enumOptions: t.enumOptions as EnumOption[],
          },
          raw,
        );
        if (res.ok) {
          await applyCapture(db, contact.id, res.writes, { taskKey: t.key, conversationId });
          newlyDone.push(t.key);

          // Caso 1: detección de duplicado al capturar teléfono/email — best
          // effort, NUNCA debe romper el flujo del bot (regla de oro de este
          // orquestador).
          if (t.captureType === "PHONE" || t.captureType === "EMAIL") {
            try {
              const { detectDuplicatesForContact } = await import("@/lib/contacts/duplicate-alert");
              await detectDuplicatesForContact(contact.id);
            } catch {
              /* best-effort: nunca romper el flujo del bot */
            }
          }
        }
      }
    }

    if (newlyDone.length > 0) {
      completedKeys = [...completedKeys, ...newlyDone];
      await db.conversationPlaybookState.update({
        where: { conversationId },
        data: { completedTaskKeys: completedKeys },
      });
    }

    const fresh = (await db.contact.findUnique({ where: { id: contact.id } })) ?? contact;

    const task = nextTask(tasks as unknown as PlaybookTaskLite[], completedKeys, fresh as any);

    if (task) {
      await db.conversationPlaybookState.update({
        where: { conversationId },
        data: { currentTaskKey: task.key, status: "IN_PROGRESS" },
      });
      return { objective: buildObjective(task), status: "IN_PROGRESS" };
    }

    await db.conversationPlaybookState.update({
      where: { conversationId },
      data: { status: "COMPLETED", completedAt: new Date(), currentTaskKey: null },
    });
    return { objective: COMPLETION_OBJECTIVE, status: "COMPLETED" };
  } catch {
    // Defensivo: cualquier fallo cae al objective de la ruta A (§ ver bot-respond.ts).
    return { objective: undefined, status: "IN_PROGRESS" };
  }
}
