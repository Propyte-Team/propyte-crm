// Matriz de reglas de comisión: filas = origen del lead + rol, columnas = tipo de operación,
// celda = la regla (como máximo una por combinación: la unicidad la valida el servidor, E8).
import type { ReglaClave } from "./reglas-texto";

export interface ReglaMatriz extends ReglaClave {
  id: string;
  percentage: unknown;
  isActive: boolean;
}

export interface FilaMatriz<T extends ReglaMatriz> {
  leadSourceCategory: string;
  role: string;
  /** Una entrada por columna, en el mismo orden que `columnas`; null = sin regla. */
  celdas: (T | null)[];
}

export interface MatrizReglas<T extends ReglaMatriz> {
  /** Tipos de operación presentes, en el orden de `ordenColumnas` (los desconocidos al final). */
  columnas: string[];
  filas: FilaMatriz<T>[];
}

function posicion(orden: string[], clave: string): number {
  const i = orden.indexOf(clave);
  return i === -1 ? orden.length : i;
}

/**
 * Arma la matriz. Las filas se ordenan por origen del lead y luego por rol, según los órdenes
 * dados (lo que no esté en la lista va al final, alfabético). Si hay dos reglas en la misma
 * celda (no debería pasar) gana la primera.
 */
export function construirMatrizReglas<T extends ReglaMatriz>(
  reglas: T[],
  orden: { dealTypes?: string[]; origenes?: string[]; roles?: string[] } = {},
): MatrizReglas<T> {
  const ordenTipos = orden.dealTypes ?? [];
  const ordenOrigenes = orden.origenes ?? [];
  const ordenRoles = orden.roles ?? [];

  const cmp = (lista: string[]) => (a: string, b: string) =>
    posicion(lista, a) - posicion(lista, b) || a.localeCompare(b);

  const columnas = [...new Set(reglas.map((r) => r.dealType))].sort(cmp(ordenTipos));

  const filasMap = new Map<string, { leadSourceCategory: string; role: string }>();
  for (const r of reglas) {
    const k = `${r.leadSourceCategory}|${r.role}`;
    if (!filasMap.has(k)) filasMap.set(k, { leadSourceCategory: r.leadSourceCategory, role: r.role });
  }
  const filasOrdenadas = [...filasMap.values()].sort(
    (a, b) =>
      cmp(ordenOrigenes)(a.leadSourceCategory, b.leadSourceCategory) || cmp(ordenRoles)(a.role, b.role),
  );

  const filas = filasOrdenadas.map((f) => ({
    ...f,
    celdas: columnas.map(
      (dealType) =>
        reglas.find(
          (r) => r.dealType === dealType && r.leadSourceCategory === f.leadSourceCategory && r.role === f.role,
        ) ?? null,
    ),
  }));

  return { columnas, filas };
}
