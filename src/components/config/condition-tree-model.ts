// Lógica pura del editor guiado de condiciones (E2, tarjeta 963). Sin React.
// Las filas del árbol (`CondLeaf`) siguen siendo strings; aquí se decide qué se muestra para cada
// fila (campo del catálogo, operadores, tipo de input) y cómo se convierte el string de la fila
// a lo que edita el input y de vuelta. `buildConditionsTreeGuiado` guarda el DSL con los tipos
// correctos (boolean real, number, array para in/nin) sin tocar builder-model.
import {
  isGroup, parseValue,
  type CondLeaf, type ConditionTree,
} from "@/lib/workflows/builder-model";
import {
  campoPorKey, camposPara, operadoresPara, operadorExigeValor, valorParaGuardar, validarCondiciones,
  type CampoDeCondicion, type ContextoDeCondicion, type OperadorDeCondicion, type ValorEditable,
} from "@/lib/workflows/condition-catalog";

export type TipoDeInput = "select" | "multiselect" | "number" | "text" | "boolean" | "none";

export interface OpcionDeValor { value: string; label: string }

/** Campo del catálogo que corresponde a la fila, o null (fila "Avanzado"). */
export function campoDeFila(leaf: CondLeaf): CampoDeCondicion | null {
  return campoPorKey(leaf.field.trim()) ?? null;
}

/** Operadores que se ofrecen para la fila (vacío si no hay campo del catálogo). */
export function operadoresDeFila(leaf: CondLeaf): OperadorDeCondicion[] {
  const campo = campoDeFila(leaf);
  return campo ? operadoresPara(campo.tipo) : [];
}

/**
 * ¿La fila solo se puede editar en modo Avanzado? Sí cuando tiene un campo que no está en el
 * catálogo (p. ej. contact.custom.*), no es de este contexto, o su operador no aplica al tipo.
 * Una fila nueva (campo vacío) NO necesita Avanzado: arranca guiada.
 */
export function filaNecesitaAvanzado(leaf: CondLeaf, contexto: ContextoDeCondicion = "contact"): boolean {
  const key = leaf.field.trim();
  if (!key) return false;
  const campo = campoPorKey(key);
  if (!campo) return true;
  if (!campo.contextos.includes(contexto)) return true;
  return !operadoresPara(campo.tipo).some((o) => o.value === leaf.op);
}

/** Qué input se pinta para el campo y operador dados. */
export function tipoDeInput(campo: CampoDeCondicion | null, op: string): TipoDeInput {
  if (!campo) return "text";
  if (!operadorExigeValor(op)) return "none";
  if (campo.tipo === "boolean") return "boolean";
  if (campo.tipo === "number") return "number";
  if (campo.tipo === "enum") return (op === "in" || op === "nin") ? "multiselect" : "select";
  return "text";
}

/** Opciones (valor → etiqueta) de un enum; conserva valores actuales que el diccionario ya no trae. */
export function opcionesDeValor(campo: CampoDeCondicion | null, actuales: string[] = []): OpcionDeValor[] {
  if (!campo?.opciones) return [];
  const lista = Object.entries(campo.opciones).map(([value, label]) => ({ value, label }));
  for (const v of actuales) {
    if (v && !(v in campo.opciones)) lista.push({ value: v, label: v });
  }
  return lista;
}

function partir(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** String de la fila → forma que muestra el input (string[] multi, boolean, string). */
export function valorParaInput(leaf: CondLeaf): ValorEditable {
  const campo = campoDeFila(leaf);
  if (leaf.op === "exists") return "";
  if (leaf.op === "in" || leaf.op === "nin") return partir(leaf.value);
  if (campo?.tipo === "boolean") return leaf.value.trim().toLowerCase() === "true";
  return leaf.value;
}

/** Lo que edita el input → string de la fila (in/nin "a,b,c", booleano "true"/"false"). */
export function valorDeInput(campo: CampoDeCondicion | null, op: string, editable: ValorEditable): string {
  if (op === "exists") return "";
  if (Array.isArray(editable)) return editable.join(",");
  if (typeof editable === "boolean") return editable ? "true" : "false";
  if (campo?.tipo === "boolean") return editable.trim().toLowerCase() === "true" ? "true" : "false";
  return editable;
}

/** Fila nueva tras elegir otro campo: conserva el operador si aplica, limpia el valor. */
export function cambiarCampo(leaf: CondLeaf, key: string): CondLeaf {
  const campo = campoPorKey(key);
  if (!campo) return { field: key, op: leaf.op || "eq", value: leaf.value };
  const ops = operadoresPara(campo.tipo);
  const op = ops.some((o) => o.value === leaf.op) ? leaf.op : "eq";
  return { field: key, op, value: campo.tipo === "boolean" ? "true" : "" };
}

/** Fila nueva tras elegir otro operador: ajusta el valor al nuevo tipo de input. */
export function cambiarOperador(leaf: CondLeaf, op: string): CondLeaf {
  const multi = (o: string) => o === "in" || o === "nin";
  if (op === "exists") return { ...leaf, op, value: "" };
  if (multi(leaf.op) === multi(op)) return { ...leaf, op };
  // De lista a un solo valor conserva el primero; de uno a lista, el mismo valor.
  const value = multi(leaf.op) ? (partir(leaf.value)[0] ?? "") : leaf.value;
  return { ...leaf, op, value };
}

function hojaADsl(c: CondLeaf): { field: string; op: string; value: unknown } {
  const campo = campoDeFila(c);
  if (!campo) return { field: c.field, op: c.op, value: parseValue(c.op, c.value) };
  const raw: string | string[] | boolean =
    (c.op === "in" || c.op === "nin") ? partir(c.value)
      : campo.tipo === "boolean" ? c.value.trim().toLowerCase() === "true"
        : c.value;
  return { field: c.field, op: c.op, value: valorParaGuardar(campo, c.op, raw) };
}

/**
 * Igual que `buildConditionsTree` (descarta filas sin campo/operador), pero los campos del
 * catálogo se guardan con su tipo real: boolean, number, array. Los desconocidos usan `parseValue`.
 */
export function buildConditionsTreeGuiado(tree: ConditionTree): Record<string, unknown> {
  const parts: unknown[] = [];
  for (const item of tree.items) {
    if (isGroup(item)) {
      const valid = item.conditions.filter((c) => c.field && c.op);
      if (valid.length > 0) parts.push({ [item.combinator]: valid.map(hojaADsl) });
    } else if (item.field && item.op) {
      parts.push(hojaADsl(item));
    }
  }
  if (parts.length === 0) return {};
  return { [tree.combinator]: parts };
}

/** Campos por grupo para pintar los <optgroup> (en el orden de `grupos`). */
export function camposAgrupados(
  contexto: ContextoDeCondicion,
  grupos: readonly string[],
): Array<{ grupo: string; campos: CampoDeCondicion[] }> {
  const campos = camposPara(contexto);
  return grupos
    .map((grupo) => ({ grupo, campos: campos.filter((c) => c.grupo === grupo) }))
    .filter((g) => g.campos.length > 0);
}

/**
 * Problemas del árbol antes de guardar (lista vacía = ok). Incluye las filas a medias (sin dato u
 * operador), que `buildConditionsTreeGuiado` descartaría en silencio, y luego `validarCondiciones`.
 */
export function problemasDeCondiciones(tree: ConditionTree): string[] {
  const hojas = tree.items.flatMap((item) => (isGroup(item) ? item.conditions : [item]));
  const problemas: string[] = [];
  if (hojas.some((c) => !c.field.trim() || !c.op)) problemas.push("Hay una condición sin dato u operador");
  problemas.push(...validarCondiciones(buildConditionsTreeGuiado(tree)).problemas);
  return problemas;
}
