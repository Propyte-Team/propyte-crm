/**
 * Error con código HTTP de la puerta de revisión.
 *
 * Los códigos conservan su significado en vez de aplanarse a "falló": un agente que
 * recibe el código y el motivo puede corregir; uno que recibe "error" vuelve a intentar
 * lo mismo. `message` lleva la guía en prosa; `details` lo estructurado que no cabe en
 * una frase.
 */
export class RevisionError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "RevisionError";
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): RevisionError {
  return new RevisionError(400, message, details);
}

export function notFound(que: string): RevisionError {
  return new RevisionError(404, `${que} no encontrado`);
}

/**
 * Falta una variable de entorno.
 *
 * NOMBRA LA VARIABLE, siempre. Ya pasó en esta casa con los secretos de los crons: había
 * dos, se configuró el equivocado, y el síntoma fue un 401 mudo que nadie miró en
 * semanas. Con cuatro secretos MCP distintos en el mismo dominio, un mensaje que no
 * nombra la variable manda a rotar la que sí estaba bien.
 */
export function faltaVariable(nombre: string, consecuencia: string): RevisionError {
  return new RevisionError(
    503,
    `Falta la variable de entorno ${nombre}. ${consecuencia}`,
    { variable: nombre },
  );
}
