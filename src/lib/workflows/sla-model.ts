// Lógica pura del editor de SLA por segmento: zod de la política + horario laboral.
import { z } from "zod";
import { conditionsDslSchema } from "@/lib/validations/rebuild-f1";

const dayKeys = ["0", "1", "2", "3", "4", "5", "6"] as const;

const timeTuple = z
  .tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)])
  .refine(([open, close]) => open < close, { message: "apertura debe ser menor que cierre" });

const tzSchema = z.string().min(1).refine(
  (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } },
  { message: "zona horaria inválida" }
);

export const businessHoursSchema = z.union([
  z.object({}).strict(),
  z
    .object({
      tz: tzSchema,
      days: z
        .record(z.string(), timeTuple.nullable())
        .refine((days) => Object.keys(days).every((k) => (dayKeys as readonly string[]).includes(k)), {
          message: "Las llaves de days deben ser \"0\"..\"6\"",
        }),
    })
    .strict(),
]);

export const slaPolicyInputSchema = z.object({
  name: z.string().min(1).max(120),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  priority: z.number().int().min(0).max(1000).default(100),
  conditions: conditionsDslSchema.default({}),
  firstTouchMinutes: z.number().int().min(1).max(1440),
  retryMinutes: z.number().int().min(1).max(1440),
  orphanHours: z.number().int().min(1).max(720),
  businessHours: businessHoursSchema.default({}),
});

export type SlaPolicyInput = z.infer<typeof slaPolicyInputSchema>;
