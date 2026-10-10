// Esquemas del alta conjunta «Meta DMs» (Messenger + Instagram de una Página), 2026-10-10.
// Viven aquí y no en las rutas porque un route.ts de Next solo puede exportar handlers.
//
// Todos los mensajes son nuestros y en español: ninguno repite el valor recibido, así que se
// pueden devolver tal cual aunque el campo sea el token.
import { z } from "zod";
import { metaDmBaseName } from "@/lib/connectors/meta-dms";

const required = (msg: string) => ({ required_error: msg, invalid_type_error: msg });

// trim() va primero: zod 3 aplica los checks en orden, y así un valor pegado con un salto de
// línea al final no cuenta como distinto ni un "   " pasa como no vacío.
const idField = (label: string) =>
  z
    .string(required(`Falta el ${label}`))
    .trim()
    .min(1, `Falta el ${label}`)
    .max(64, `El ${label} es demasiado largo`)
    .regex(/^\S+$/, `El ${label} no puede tener espacios`);

// Mismo criterio que /api/admin/connectors/[id]/token: los tokens de Meta rondan los 200-300
// caracteres; 2048 deja margen sin aceptar cualquier cosa.
const pageTokenField = z
  .string(required("Pega el Page Access Token"))
  .trim()
  .min(1, "Pega el Page Access Token")
  .max(2048, "El token es demasiado largo")
  .regex(/^\S+$/, "El token no puede tener espacios");

const secretField = (label: string) =>
  z.string(required(`Falta el ${label}`)).trim().min(1, `Falta el ${label}`).max(512, `El ${label} es demasiado largo`);

/** POST /api/admin/connectors/meta-dms/lookup — ¿de qué Página es el token y qué IG tiene vinculado? */
export const metaDmsLookupSchema = z.object(
  { pageId: idField("Page ID"), pageAccessToken: pageTokenField },
  required("Datos inválidos")
);

/** POST /api/admin/connectors/meta-dms — crea Messenger y, si se pide, Instagram. */
export const metaDmsCreateSchema = z.object(
  {
    // El nombre es el de la marca/Página; "Messenger | DM " (15 caracteres) + 100 cabe en
    // los 120 que acepta el resto de Conexiones.
    name: z
      .string(required("Escribe el nombre de la cuenta"))
      .transform(metaDmBaseName)
      .pipe(
        z
          .string()
          .min(2, "El nombre debe tener al menos 2 caracteres")
          .max(100, "El nombre es demasiado largo (máx. 100)")
      ),
    brandId: z.string({ invalid_type_error: "Marca inválida" }).uuid("Marca inválida").nullable().optional(),
    includeInstagram: z.boolean({ invalid_type_error: "«Incluir Instagram» debe ser sí o no" }).default(false),
    fields: z.object(
      {
        pageId: idField("Page ID"),
        pageAccessToken: pageTokenField,
        appSecret: secretField("App Secret"),
        verifyToken: secretField("Verify Token"),
        brand: z.string({ invalid_type_error: "La marca visible debe ser texto" }).trim().max(120, "La marca visible es demasiado larga").optional(),
        igBusinessId: z
          .string({ invalid_type_error: "El Instagram Business ID debe ser texto" })
          .trim()
          .max(64, "El Instagram Business ID es demasiado largo")
          .regex(/^\S*$/, "El Instagram Business ID no puede tener espacios")
          .optional(),
      },
      required("Faltan los datos de la Página")
    ),
  },
  required("Datos inválidos")
);

export type MetaDmsCreateInput = z.infer<typeof metaDmsCreateSchema>;

/** Primer problema como texto para la pantalla. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos";
}
