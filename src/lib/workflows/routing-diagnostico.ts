// ============================================================
// Por qué el reparto de leads no pudo asignar
// ============================================================
//
// Tarjeta #678, apartado (a). Es el apartado que los cotejos del 04-sep y del 07-sep
// subieron al primer puesto con este argumento: «es lo único que puede decir qué está
// pasando». Y lo decían porque desde fuera no se puede distinguir «a este lead ni se le
// llamó al reparto» de «se le llamó y el reparto no encontró a nadie», que son arreglos
// distintos.
//
// Lo que ya existía y NO hace falta repetir: el Pond (routing.ts) sella un temporizador
// ORPHAN, avisa a la gerencia de la plaza y emite `lead.orphaned`. O sea que el reparto ya
// no es del todo mudo. Lo que faltaba es CUÁL de los motivos fue: hoy los cinco caminos
// posibles de fallo terminan en el mismo `if (!assigneeId)` y el evento solo lleva el
// motivo que pasó QUIEN LLAMÓ —por qué se invocó el reparto— no por qué falló.
//
// Este módulo es la parte pura, sin base de datos, para que se pueda probar sola.

/** Cada forma distinta en que el bucle de reglas puede acabar sin asignar. */
export type MotivoSinAsignar =
  /** `routing_rules` no tiene ninguna fila activa. Es configuración, no código. */
  | "sin_reglas_activas"
  /** Hay reglas, pero ninguna matcheó las condiciones de este contacto. */
  | "ninguna_regla_matchea"
  /** #729: la regla matcheó pero no hay plaza resoluble, así que no asigna a propósito. */
  | "sin_plaza_resoluble"
  /** La regla matcheó y resolvió plaza, pero no quedó ningún usuario ruteable. */
  | "sin_candidatos_ruteables"
  /** Había candidatos y la estrategia no eligió a ninguno. Esto sería un defecto. */
  | "estrategia_no_eligio";

/** Lo que cada regla evaluada dejó anotado. */
export interface PasoDeReparto {
  reglaId: string;
  motivo: Exclude<MotivoSinAsignar, "sin_reglas_activas" | "ninguna_regla_matchea">;
}

/**
 * De más informativo a menos. El orden importa: si una regla se quedó sin candidatos
 * ruteables y otra ni resolvió plaza, lo que hay que contar es la primera, porque señala un
 * problema de personas (no hay a quién asignar) y la otra señala un dato faltante en el
 * contacto. Y `estrategia_no_eligio` va primero de todos porque sería un defecto de código,
 * no un estado de los datos.
 */
const PRIORIDAD: PasoDeReparto["motivo"][] = [
  "estrategia_no_eligio",
  "sin_candidatos_ruteables",
  "sin_plaza_resoluble",
];

/**
 * El motivo que mejor explica por qué no se asignó, a partir de lo que dejó el bucle.
 *
 * `pasos` son las reglas que SÍ matchearon y aun así no produjeron asignación. Si está
 * vacío, la explicación depende de si había reglas para empezar — que es justo la
 * distinción que la tarjeta #698 no podía hacer desde fuera.
 */
export function motivoSinAsignar(pasos: PasoDeReparto[], reglasActivas: number): MotivoSinAsignar {
  if (pasos.length === 0) {
    return reglasActivas === 0 ? "sin_reglas_activas" : "ninguna_regla_matchea";
  }
  for (const candidato of PRIORIDAD) {
    if (pasos.some((p) => p.motivo === candidato)) return candidato;
  }
  // Inalcanzable mientras PRIORIDAD cubra el tipo; se deja explícito en vez de un `!`.
  return pasos[0].motivo;
}

/** Una línea para el log, legible por una persona que abre los registros a las 11 de la noche. */
export function explicacion(motivo: MotivoSinAsignar): string {
  switch (motivo) {
    case "sin_reglas_activas":
      return "no hay ninguna regla de ruteo activa: es configuración, no código";
    case "ninguna_regla_matchea":
      return "hay reglas activas pero ninguna matchea las condiciones de este contacto";
    case "sin_plaza_resoluble":
      return "la regla matchea pero el contacto no tiene plaza y la regla no nombra una (#729)";
    case "sin_candidatos_ruteables":
      return "la regla matchea y resuelve plaza, pero no quedó ningún asesor ruteable (activo, no .local, no excluido)";
    case "estrategia_no_eligio":
      return "había candidatos y la estrategia no eligió a ninguno: esto es un defecto, no un estado de los datos";
  }
}
