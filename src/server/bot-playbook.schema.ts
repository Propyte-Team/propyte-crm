// Esquema de validacion para crear/editar BotPlaybook + BotTask. Vive fuera de
// bot-playbook.ts porque un archivo "use server" solo puede exportar funciones
// async (ver https://nextjs.org/docs/messages/invalid-use-server-value).
import { z } from "zod";

export const CAPTURE_TYPES = [
  "TEXT",
  "FULL_NAME",
  "EMAIL",
  "PHONE",
  "MONEY",
  "BUDGET_RANGE",
  "ENUM",
  "ZONE",
  "BOOLEAN",
  "NUMBER",
] as const;

export const taskInputSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/, "key debe ser snake_case minúscula"),
  order: z.number().int().min(0),
  objective: z.string().min(1).max(500),
  targetField: z.string().min(1),
  captureType: z.enum(CAPTURE_TYPES),
  enumOptions: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().optional(),
        synonyms: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  extractionHint: z.string().max(500).optional().nullable(),
  required: z.boolean().default(true),
  skipIfFilled: z.boolean().default(true),
});

export const playbookUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  tasks: z.array(taskInputSchema).max(30),
});

export type PlaybookUpsertInput = z.infer<typeof playbookUpsertSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
