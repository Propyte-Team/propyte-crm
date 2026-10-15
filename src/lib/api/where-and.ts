// ============================================================
// Sumar condiciones a un `where` de Prisma sin pisar las que ya tenía
// ============================================================
//
// Tarjeta #881. Los listados arman el `where` en dos pasos: primero el alcance del ROL
// (`where.assignedToId = userId` para un asesor, `{ in: equipo }` para un líder de equipo) y
// después los filtros que llegan en la URL. Si un filtro de la URL se escribe en la MISMA
// clave suelta (`where.assignedToId = <de la URL>`), reemplaza al del rol en vez de sumarse,
// y el usuario ve lo que su rol no le deja ver.
//
// Todo lo que viene de la URL y toca un campo que el rol también acota tiene que entrar por
// aquí: en el AND, junto a lo que ya hubiera. Una condición imposible (un asesor que pide los
// de otro) da una lista vacía, no un 403: así la respuesta no confirma que ese id exista.

/** Lo mínimo que comparten los `*WhereInput` de Prisma para esto. */
type ConAnd<W> = { AND?: W | W[] };

/** Añade `condiciones` al `AND` de `where` (lo muta), conservando lo que ya tuviera. */
export function sumarAlAnd<W extends ConAnd<W>>(where: W, ...condiciones: W[]): void {
  if (condiciones.length === 0) return;
  const previos = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  where.AND = [...previos, ...condiciones];
}
