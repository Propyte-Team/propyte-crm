// Validación de «Marcas que ve» un usuario (2026-10-12, spec marcas-visibilidad).
//
// `min(1)` a propósito: en user_brand_access "sin filas" significa "solo la predeterminada"
// (decisión 3). Un conjunto vacío no se puede guardar sin que se lea como Propyte, que es lo
// contrario de lo que pidió quien apagó todo. Lo asignado al usuario lo ve siempre, así que no
// hace falta un "no ve ninguna marca".
// `.strict()`: una clave desconocida se rechaza en vez de ignorarse, como en brand.ts.
import { z } from "zod";

export const userBrandAccessSchema = z
  .object({
    brandIds: z
      .array(z.string().trim().min(1).max(64))
      .min(1, "Elige al menos una marca")
      .max(50)
      .transform((ids) => Array.from(new Set(ids))),
  })
  .strict();

export type UserBrandAccessInput = z.infer<typeof userBrandAccessSchema>;
