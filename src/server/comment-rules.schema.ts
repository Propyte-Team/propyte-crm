// Validación de reglas de comentarios. Vive fuera de cualquier archivo
// "use server" (solo funciones async pueden exportarse de ahí).
import { z } from "zod";

export const PUBLIC_REPLY_MAX = 500;
export const DM_MAX = 900; // el límite de Meta es 1000; margen para {{usuario}}
/** Tope diario de fábrica. Muy por encima del uso normal: es un fusible
 * contra una publicación viral, no una cuota de marketing. */
export const DAILY_CAP_DEFAULT = 200;

export const commentRuleCreateSchema = z.object({
  name: z.string().min(2).max(120),
  connectorId: z.string().min(1),
  phrases: z.array(z.string().min(2).max(60)).min(1).max(20),
  // Negativas de la regla. Un tope mas alto que las frases a proposito: la
  // lista de "lo que NO es un cliente" crece con cada falso positivo real,
  // mientras que las frases utiles son pocas.
  excludePhrases: z.array(z.string().min(2).max(60)).max(40).default([]),
  // Tope de actuaciones en 24 h. 0 = sin tope (hay que pedirlo a mano).
  dailyCap: z.number().int().min(0).max(5000).default(DAILY_CAP_DEFAULT),
  publicReplies: z.array(z.string().min(1).max(PUBLIC_REPLY_MAX)).min(1).max(5),
  dmTemplate: z.string().min(1).max(DM_MAX),
  postFilter: z.array(z.string().min(3).max(120)).max(50).default([]),
  priority: z.number().int().min(1).max(999).default(100),
});

export const commentRuleUpdateSchema = commentRuleCreateSchema
  .omit({ connectorId: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

// z.infer da el tipo de SALIDA (postFilter y priority ya resueltos por el
// default). Para lo que el cliente MANDA hay que usar z.input.
export type CommentRuleCreateInput = z.input<typeof commentRuleCreateSchema>;
export type CommentRuleUpdateInput = z.input<typeof commentRuleUpdateSchema>;
