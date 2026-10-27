// Ayudas para zod 4 que conservan el comportamiento que el CRM tenía con zod 3 (#930).
//
// La migración de 3.25 a 4.x cerró la CVE-2023-54404 (agotamiento de memoria con arreglos
// grandes), pero zod 4 cambió dos cosas que el chequeo de tipos no ve y que sí cambian datos:
//
// 1. Los mensajes `required_error` / `invalid_type_error` ya no existen: ahora hay un solo
//    parámetro `error`, que recibe el issue. `siFalta`, `siTipoInvalido` y `mensajesDeTipo` dan
//    exactamente los mismos mensajes que antes. Cuando la función devuelve `undefined`, zod
//    usa su mensaje por defecto, igual que zod 3 cuando no se declaraba ese caso.
//
// 2. En zod 4, `.partial()` APLICA el `.default()` de los campos que no vienen. Con zod 3, un
//    campo ausente se quedaba ausente. En un PATCH eso significa sobrescribir: editar solo el
//    nombre de una regla la dejaba con `isActive: false` y su configuración en `{}`.
//    `parcialSinDefaults` quita los defaults antes de volver opcionales los campos, que es lo
//    que hacía `.partial()` en zod 3.
//
// Otra diferencia, resuelta sin ayuda: `.uuid()` en zod 4 sigue la RFC 9562 al pie de la
// letra (versión y variante) y rechaza IDs que zod 3 aceptaba. En todo el repo se usa
// `.guid()`, que acepta exactamente lo mismo que el `.uuid()` de zod 3.
import { z } from "zod";

type ConEntrada = { input?: unknown };

/** Mensaje propio solo cuando el campo falta (el `required_error` de zod 3). */
export const siFalta = (mensaje: string) => ({
  error: (issue: ConEntrada) => (issue.input === undefined ? mensaje : undefined),
});

/** Mensaje propio solo cuando el valor llega con otro tipo (el `invalid_type_error` de zod 3). */
export const siTipoInvalido = (mensaje: string) => ({
  error: (issue: ConEntrada) => (issue.input === undefined ? undefined : mensaje),
});

/** Los dos a la vez: `{ required_error, invalid_type_error }` de zod 3. */
export const mensajesDeTipo = (siFaltaMsg: string, siTipoMsg: string) => ({
  error: (issue: ConEntrada) => (issue.input === undefined ? siFaltaMsg : siTipoMsg),
});

type SinDefault<T> = T extends z.ZodDefault<infer Interno> ? Interno : T;
type ShapeParcial<T extends z.ZodRawShape> = {
  [K in keyof T]: z.ZodOptional<Extract<SinDefault<T[K]>, z.ZodType>>;
};

/**
 * Igual que el `.partial()` de zod 3: cada campo se vuelve opcional y, si no viene, se queda
 * fuera del resultado, aunque en el esquema de alta tenga un `.default()`. Usarlo en los
 * esquemas de edición que se arman a partir del de alta.
 */
export function parcialSinDefaults<T extends z.ZodRawShape>(esquema: z.ZodObject<T>): z.ZodObject<ShapeParcial<T>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [clave, campo] of Object.entries(esquema.shape) as [string, z.ZodType][]) {
    const sinDefault = campo instanceof z.ZodDefault ? campo.removeDefault() : campo;
    shape[clave] = (sinDefault as z.ZodType).optional();
  }
  return z.object(shape) as unknown as z.ZodObject<ShapeParcial<T>>;
}
