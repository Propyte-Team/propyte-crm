import { z } from "zod";

export const ESTADO_UNIDAD = [
  "Disponible", "Preventa", "Reservada", "Vendida", "Entrega inmediata", "No Disponible",
] as const;

export const tipologiaSchema = z.object({
  etiqueta: z.string().min(1),
  recamaras: z.coerce.number().int().min(0),
  banosCompletos: z.coerce.number().int().min(0),
  mediosBanos: z.coerce.number().int().min(0).default(0),
  m2: z.coerce.number().positive(),
  precioDesde: z.coerce.number().nonnegative().optional(),
  moneda: z.enum(["MXN", "USD"]).default("MXN"),
  estado: z.enum(ESTADO_UNIDAD).default("Preventa"),
});
export type Tipologia = z.infer<typeof tipologiaSchema>;

export const intakePayloadSchema = z.object({
  generales: z.object({
    nombre: z.string().min(2),
    desarrollador: z.string().optional().default(""),
    tipo: z.enum(["vertical", "horizontal", "mixto", "lotes"]).default("vertical"),
    etapa: z.string().optional().default(""),
    avancePct: z.coerce.number().min(0).max(100).optional(),
    fechaEntrega: z.string().optional().default(""),
    unidadesTotales: z.coerce.number().int().nonnegative().optional(),
    unidadesDisponibles: z.coerce.number().int().nonnegative().optional(),
  }),
  ubicacion: z
    .object({
      estado: z.string().optional().default(""),
      municipio: z.string().optional().default(""),
      ciudad: z.string().optional().default(""),
      colonia: z.string().optional().default(""),
      calle: z.string().optional().default(""),
      numeroExt: z.string().optional().default(""),
      playaDistanciaValor: z.coerce.number().optional(),
      playaDistanciaUnidad: z.enum(["min", "horas", "metros", "km"]).optional(),
      linkMaps: z.string().optional().default(""),
      lat: z.coerce.number().optional(),
      lng: z.coerce.number().optional(),
    })
    .default({}),
  amenidades: z
    .object({
      flags: z.record(z.boolean()).default({}),
      adicionales: z.array(z.string()).default([]),
    })
    .default({ flags: {}, adicionales: [] }),
  descripciones: z
    .object({
      descripcionEs: z.string().optional().default(""),
      descripcionCortaEs: z.string().optional().default(""),
      conceptoDiseno: z.string().optional().default(""),
    })
    .default({}),
  tipologias: z.array(tipologiaSchema).min(1),
  multimedia: z
    .object({
      tourVirtual: z.string().optional().default(""),
      brochureUrl: z.string().optional().default(""),
    })
    .default({}),
  faq: z
    .array(z.object({ pregunta: z.string().min(1), respuesta: z.string().min(1) }))
    .default([]),
});
export type IntakePayload = z.infer<typeof intakePayloadSchema>;
