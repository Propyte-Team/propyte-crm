import { z } from "zod";

// --- Etapas válidas del pipeline (coinciden con el enum DealStage de Prisma) ---
const VALID_STAGES = [
  "NEW_LEAD",
  "CONTACTED",
  "DISCOVERY_DONE",
  "MEETING_SCHEDULED",
  "MEETING_COMPLETED",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "RESERVED",
  "CONTRACT_SIGNED",
  "CLOSING",
  "WON",
  "LOST",
  "FROZEN",
] as const;

// Tipos de operación (coinciden con el enum DealType de Prisma)
const VALID_DEAL_TYPES = [
  "NATIVA_CONTADO",
  "NATIVA_FINANCIAMIENTO",
  "MACROLOTE",
  "CORRETAJE",
  "MASTERBROKER",
] as const;

// Razones de pérdida
const VALID_LOST_REASONS = [
  "PRECIO",
  "COMPETENCIA",
  "FINANCIAMIENTO_RECHAZADO",
  "NO_INTERESADO",
  "NO_CONTACTABLE",
  "COMPRO_DIRECTO",
  "DESARROLLO_CANCELADO",
  "OTRO",
] as const;

// --- Esquema para creación de deal ---
export const createDealSchema = z.object({
  // ID del contacto asociado
  contactId: z.string().uuid("ID de contacto inválido"),

  // ID del desarrollo (opcional al inicio)
  developmentId: z.string().uuid().optional(),

  // ID de la unidad (opcional al inicio)
  unitId: z.string().uuid().optional(),

  // Tipo de operación
  dealType: z.enum(VALID_DEAL_TYPES),

  // Valor estimado
  estimatedValue: z.number().positive("El valor debe ser positivo"),

  // Moneda
  currency: z.enum(["MXN", "USD"]).default("MXN"),

  // Fecha esperada de cierre
  expectedCloseDate: z.coerce.date(),

  // Fuente del lead al momento de crear el deal (snapshot)
  leadSourceAtDeal: z.string().min(1, "La fuente del lead es requerida"),
});

// --- Esquema para actualización de deal ---
export const updateDealSchema = z.object({
  developmentId: z.string().uuid().optional().nullable(),
  unitId: z.string().uuid().optional().nullable(),
  dealType: z.enum(VALID_DEAL_TYPES).optional(),
  estimatedValue: z.number().positive("El valor debe ser positivo").optional(),
  currency: z.enum(["MXN", "USD"]).optional(),
  expectedCloseDate: z.coerce.date().optional(),
  lostReason: z.enum(VALID_LOST_REASONS).optional(),
  lostReasonDetail: z.string().max(500).optional(),
});

// --- Esquema para transición de etapa con reglas de negocio ---
export const stageTransitionSchema = z
  .object({
    dealId: z.string().uuid("ID de negocio inválido"),
    fromStage: z.enum(VALID_STAGES),
    toStage: z.enum(VALID_STAGES),

    // Campos que pueden ser requeridos según la etapa destino
    unitId: z.string().uuid().optional(),
    estimatedValue: z.number().positive().optional(),
    actualCloseDate: z.coerce.date().optional(),
    lostReason: z.enum(VALID_LOST_REASONS).optional(),
    lostReasonDetail: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    // Orden de las etapas (excluyendo LOST y FROZEN que son especiales)
    const stageOrder: string[] = [
      "NEW_LEAD",
      "CONTACTED",
      "DISCOVERY_DONE",
      "MEETING_SCHEDULED",
      "MEETING_COMPLETED",
      "PROPOSAL_SENT",
      "NEGOTIATION",
      "RESERVED",
      "CONTRACT_SIGNED",
      "CLOSING",
      "WON",
    ];

    const fromIdx = stageOrder.indexOf(data.fromStage);
    const toIdx = stageOrder.indexOf(data.toStage);

    // Permitir transición a LOST y FROZEN desde cualquier etapa
    if (data.toStage !== "LOST" && data.toStage !== "FROZEN") {
      // No se puede retroceder más de una etapa
      if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx - 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "No se puede retroceder más de una etapa en el pipeline",
          path: ["toStage"],
        });
      }
    }

    // Regla: RESERVED requiere unidad asignada
    if (data.toStage === "RESERVED" && !data.unitId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Se requiere asignar una unidad para apartar",
        path: ["unitId"],
      });
    }

    // Regla: WON requiere fecha real de cierre
    if (data.toStage === "WON" && !data.actualCloseDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La fecha real de cierre es requerida para cerrar como ganado",
        path: ["actualCloseDate"],
      });
    }

    // Regla: LOST requiere razón de pérdida
    if (data.toStage === "LOST" && !data.lostReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El motivo de pérdida es obligatorio",
        path: ["lostReason"],
      });
    }
  });

// --- Tipos inferidos ---
export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type StageTransitionInput = z.infer<typeof stageTransitionSchema>;
