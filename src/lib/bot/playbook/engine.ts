import { isCustomTarget } from "./fields";

export interface PlaybookTaskLite {
  key: string;
  order: number;
  objective: string;
  targetField: string;
  required: boolean;
  skipIfFilled: boolean;
}

export const COMPLETION_OBJECTIVE =
  "Ya tienes lo esencial del lead. Propón con naturalidad agendar una llamada o visita con el asesor y ofrece resolver dudas.";

export function isFieldFilled(contact: Record<string, unknown>, targetField: string): boolean {
  if (isCustomTarget(targetField)) {
    const customKey = targetField.slice("custom.".length);
    const custom = contact.custom as Record<string, unknown> | undefined;
    const value = custom?.[customKey];
    return value !== null && value !== undefined && value !== "";
  }

  const value = contact[targetField];
  return value !== null && value !== undefined && value !== "";
}

export function nextTask(
  tasks: PlaybookTaskLite[],
  completedKeys: string[],
  contact: Record<string, unknown>
): PlaybookTaskLite | null {
  const sorted = [...tasks].sort((a, b) => a.order - b.order);

  for (const task of sorted) {
    const isCompleted = completedKeys.includes(task.key);
    const isSkippedFilled = task.skipIfFilled && isFieldFilled(contact, task.targetField);
    if (!isCompleted && !isSkippedFilled) {
      return task;
    }
  }

  return null;
}

export function buildObjective(task: PlaybookTaskLite): string {
  return `Tu meta ahora: ${task.objective}. Consíguelo con UNA sola pregunta natural, sin sonar a formulario ni listar campos.`;
}
