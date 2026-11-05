// Búsqueda de contactos por texto libre — #960.
//
// Antes cada buscador comparaba el texto COMPLETO contra el nombre y contra el apellido por
// separado. «Camilo Aguilar» no está contenido ni en «Camilo René» ni en «Aguilar Pino», así que
// no aparecía nadie aunque la persona existiera. Ahora el texto se parte en palabras y CADA
// palabra tiene que estar en el nombre o en el apellido (en cualquier orden): «Camilo Aguilar»,
// «Aguilar Camilo» y «cam agui» encuentran a Camilo René Aguilar Pino.
//
// Es un superconjunto de lo de antes: con una sola palabra la condición es la misma, y una frase
// que ya cabía entera en el nombre o en el apellido sigue cabiendo palabra por palabra.
// El correo y el teléfono se siguen comparando con el texto entero.
//
// Una sola regla para todos los buscadores (lista de Contactos, Inbox, paleta de comandos,
// selector de brokers, asistentes): cada copia escrita a mano es una que se desincroniza (#730).
import type { Prisma } from "@prisma/client";

/** Más palabras no afinan nada y solo alargan la consulta. */
export const MAX_PALABRAS_BUSQUEDA = 5;

export function palabrasDeBusqueda(texto: string | null | undefined): string[] {
  return (texto ?? "").trim().split(/\s+/).filter(Boolean).slice(0, MAX_PALABRAS_BUSQUEDA);
}

/** Cada palabra en el nombre o en el apellido. `null` si no hay palabras. */
export function whereNombreCompleto(texto: string | null | undefined): Prisma.ContactWhereInput | null {
  const palabras = palabrasDeBusqueda(texto);
  if (palabras.length === 0) return null;
  return {
    AND: palabras.map((p) => ({
      OR: [
        { firstName: { contains: p, mode: "insensitive" as const } },
        { lastName: { contains: p, mode: "insensitive" as const } },
      ],
    })),
  };
}

export type OpcionesBusqueda = {
  /** Comparar también contra el correo (texto entero). Default true. */
  email?: boolean;
  /**
   * Teléfono: `"tal_cual"` compara el texto entero (lista de Contactos, Inbox); `"solo_digitos"`
   * le quita lo que no es dígito antes (asistentes y pasarela, que reciben «+52 984…»); `false`,
   * no se compara. Default `"tal_cual"`.
   */
  telefono?: "tal_cual" | "solo_digitos" | false;
};

/** Condición de búsqueda por nombre completo, correo o teléfono. `null` si el texto está vacío. */
export function whereBusquedaContacto(
  texto: string | null | undefined,
  opts: OpcionesBusqueda = {},
): Prisma.ContactWhereInput | null {
  const q = (texto ?? "").trim();
  if (!q) return null;
  const { email = true, telefono = "tal_cual" } = opts;
  const or: Prisma.ContactWhereInput[] = [];
  const nombre = whereNombreCompleto(q);
  if (nombre) or.push(nombre);
  if (email) or.push({ email: { contains: q, mode: "insensitive" } });
  if (telefono === "tal_cual") or.push({ phone: { contains: q } });
  else if (telefono === "solo_digitos") or.push({ phone: { contains: q.replace(/\D/g, "") || q } });
  return { OR: or };
}
