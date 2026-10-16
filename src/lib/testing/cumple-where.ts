// ============================================================
// Evaluador mínimo de un `where` de Prisma sobre filas en memoria — SOLO PARA PRUEBAS
// ============================================================
//
// Nació en la #881 y se sacó aquí en la #895 para no copiarlo. Las pruebas de alcance por rol
// no deben mirar la FORMA del `where` (dos formas distintas pueden significar lo mismo, y una
// forma "razonable" puede significar otra cosa): lo aplican a un puñado de filas y comparan
// QUÉ FILAS saldrían.
//
// Cubre lo que usan esas pruebas: igualdad, null, Date, `in`, `equals`, `not`, `contains`
// (con `mode: "insensitive"`), AND / OR / NOT y filtros de relación 1-1 (`user: { plaza }`).
// Lanza ante un campo que la fila no tiene, para que un cambio de forma futuro haga fallar la
// prueba en vez de pasarla en silencio. No lo importes desde código de la app.

export type Fila = Record<string, unknown>;

const OPERADORES = new Set(["in", "equals", "contains", "mode", "not"]);

function esOperador(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    Object.keys(v).some((k) => OPERADORES.has(k))
  );
}

function igual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function cumpleCampo(valor: unknown, filtro: unknown): boolean {
  if (filtro === undefined) return true; // Prisma ignora las claves undefined
  if (filtro === null) return valor === null || valor === undefined;
  if (filtro instanceof Date) return igual(valor, filtro);
  if (esOperador(filtro)) {
    for (const [op, arg] of Object.entries(filtro)) {
      if (op === "mode") continue;
      if (op === "in" && !(arg as unknown[]).some((x) => igual(x, valor))) return false;
      if (op === "equals" && !igual(valor, arg)) return false;
      if (op === "not" && !(arg === null ? valor !== null && valor !== undefined : !igual(valor, arg))) return false;
      if (op === "contains") {
        if (typeof valor !== "string") return false;
        const insensible = (filtro as { mode?: string }).mode === "insensitive";
        const a = insensible ? valor.toLowerCase() : valor;
        const b = insensible ? String(arg).toLowerCase() : String(arg);
        if (!a.includes(b)) return false;
      }
    }
    return true;
  }
  if (typeof filtro === "object") {
    // Filtro de relación 1-1 (p. ej. `assignedTo: { plaza }`).
    if (typeof valor !== "object" || valor === null) return false;
    return cumple(valor as Fila, filtro as Fila);
  }
  return igual(valor, filtro);
}

/** ¿La fila pasa el `where`? */
export function cumple(fila: Fila, where: Fila): boolean {
  for (const [clave, filtro] of Object.entries(where)) {
    if (filtro === undefined) continue;
    const lista = (f: unknown) => (Array.isArray(f) ? f : [f]) as Fila[];
    if (clave === "AND") {
      if (!lista(filtro).every((w) => cumple(fila, w))) return false;
    } else if (clave === "OR") {
      if (!(filtro as Fila[]).some((w) => cumple(fila, w))) return false;
    } else if (clave === "NOT") {
      if (lista(filtro).some((w) => cumple(fila, w))) return false;
    } else if (!(clave in fila)) {
      throw new Error(`El evaluador de la prueba no conoce el campo «${clave}»: amplía las filas`);
    } else if (!cumpleCampo(fila[clave], filtro)) {
      return false;
    }
  }
  return true;
}
