/**
 * A quién se le avisa cuando un reloj de SLA vence. Tarjeta #756.
 *
 * EL HUECO: `checkSlaBreaches` hacía tres cosas al vencer un reloj —marcar BREACHED,
 * encadenar el RETRY y emitir `sla.breach`— y **ninguna avisaba a una persona**. El evento
 * solo lo consume una `AutomationRule` con disparador `SLA_BREACH`, y hay cero activas por
 * la decisión del BETA. Así que el vencimiento era mudo POR CONSTRUCCIÓN: encender las
 * automatizaciones no lo habría arreglado, porque no existe la regla ni apagada.
 *
 * Eso explica el hallazgo de la #751 sin hablar de la actitud de nadie: **0 de 83 reintentos
 * cumplidos en toda la historia**. Nunca se le dijo a una persona que un plazo se había
 * pasado. El 0 era el resultado esperable.
 *
 * La decisión vive aquí y sin base de datos, para poder probarla sola — igual que
 * `routing-diagnostico.ts` de la #678 (a). La resolución de QUIÉN es el mando concreto la
 * hace `sla.ts`, que sí tiene la base.
 */
import { esCuentaTecnica } from "./ruteables";

export type TipoDeReloj = "FIRST_TOUCH" | "RETRY" | "ORPHAN";

/** Lo que hay que saber del dueño del contacto para decidir. Nada más. */
export type DuenoDelContacto = {
  asesorId: string | null;
  email: string | null;
  teamLeaderId: string | null;
  plaza: string | null;
};

export type MotivoSinAviso =
  /** El contacto no tiene asesor: no hay a quién reclamarle el plazo. */
  | "sin_dueno"
  /** El dueño es una cuenta interna/QA que ninguna persona abre (#734). */
  | "cuenta_tecnica"
  /** Este tipo de reloj ya avisó al crearse; hacerlo otra vez es el segundo aviso. */
  | "ya_aviso_al_crearse";

export type Destino =
  | { a: "asesor"; usuarioId: string }
  | { a: "mando"; teamLeaderId: string | null; plaza: string | null }
  | { a: "nadie"; motivo: MotivoSinAviso };

/**
 * Quién debe enterarse de este vencimiento.
 *
 * LAS TRES REGLAS, con su razón:
 *
 * 1. **Primera respuesta vencida → el asesor dueño.** Es su plazo, y lo más probable es que
 *    simplemente se le pasara. Avisar al jefe de entrada convierte un olvido de cinco
 *    minutos en un problema de desempeño.
 *
 * 2. **Reintento vencido → ESCALA, no repite.** Un RETRY solo nace cuando el FIRST_TOUCH de
 *    ese contacto ya venció, o sea que el asesor YA no contestó una vez con el aviso puesto.
 *    Mandarle el segundo aviso a la misma persona es previsible que no funcione — es
 *    literalmente la pregunta que la #751 dejó abierta. Va al líder de su equipo si tiene, y
 *    si no a la gerencia de su plaza.
 *
 * 3. **La bandeja de rescate no avisa aquí.** `sendToPond` ya notifica a la gerencia en el
 *    momento en que sella el ORPHAN, o sea cuando el lead se queda sin dueño. Avisar otra vez
 *    24 horas después es el segundo aviso del mismo hecho, y un aviso repetido es la forma
 *    más rápida de que se dejen de leer todos.
 *
 * Y EL FILTRO QUE VA ANTES DE LAS TRES: si el contacto no tiene dueño, o su dueño es una
 * cuenta del dominio técnico, no se avisa a nadie. No es cosmético — hoy 90 de los 113
 * contactos vivos están en cuentas `.local` (#734), y de los 168 vencimientos de la historia
 * **166 son de una de ellas**. Sin este filtro, el día que esto se despliegue la gerencia
 * recibe un centenar de avisos sobre un buzón que nadie abre y deja de mirar la campana.
 * El problema de esos contactos es la #734, no un plazo.
 */
export function destinoDelVencimiento(tipo: TipoDeReloj, dueno: DuenoDelContacto): Destino {
  if (tipo === "ORPHAN") return { a: "nadie", motivo: "ya_aviso_al_crearse" };
  if (!dueno.asesorId) return { a: "nadie", motivo: "sin_dueno" };
  if (esCuentaTecnica(dueno.email)) return { a: "nadie", motivo: "cuenta_tecnica" };

  if (tipo === "RETRY") {
    return { a: "mando", teamLeaderId: dueno.teamLeaderId, plaza: dueno.plaza };
  }
  return { a: "asesor", usuarioId: dueno.asesorId };
}

/** El texto del aviso. Aparte de la decisión para poder probar cada cosa por su lado. */
export function tituloDelAviso(tipo: TipoDeReloj): string {
  return tipo === "RETRY" ? "Segundo plazo vencido — sin respuesta" : "Plazo de primera respuesta vencido";
}

export function mensajeDelAviso(
  tipo: TipoDeReloj,
  nombre: string,
  fuente: string | null,
  paraMando: boolean,
): string {
  const quien = `${nombre}${fuente ? ` (${fuente})` : ""}`;
  if (tipo === "RETRY") {
    // Al mando se le dice que el asesor ya no contestó DOS veces, porque eso es lo
    // accionable para él; repetirle «contéstale» a quien no contestó no lo es.
    return paraMando
      ? `${quien} lleva dos plazos vencidos sin respuesta. El asesor asignado no ha contestado.`
      : `${quien} sigue sin respuesta y ya venció el segundo plazo.`;
  }
  return `${quien} lleva más del plazo sin primera respuesta.`;
}

/** Por qué no se avisó, en una frase, para los registros del servidor. */
export function explicacionSinAviso(motivo: MotivoSinAviso): string {
  switch (motivo) {
    case "sin_dueno":
      return "el contacto no tiene asesor asignado, así que no hay a quién avisarle (ver #748 y #734)";
    case "cuenta_tecnica":
      return "el dueño es una cuenta del dominio técnico que ninguna persona abre (ver #734)";
    case "ya_aviso_al_crearse":
      return "es un reloj de la bandeja de rescate, y sendToPond ya avisó a la gerencia al sellarlo";
  }
}
