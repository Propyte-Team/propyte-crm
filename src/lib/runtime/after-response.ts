// Trabajo que corre DESPUÉS de mandar la respuesta (2026-10-12).
//
// Por qué existe: los webhooks de Meta exigen un 200 en menos de 20 s (requisito de App
// Review para Messenger). Si tardamos más, Meta reintenta, duplica eventos o marca el
// webhook. Lo lento (Claude + envío por Graph del bot, respuestas a comentarios) no tiene
// por qué ocurrir antes del 200: se agenda aquí y corre cuando la respuesta ya salió.
//
// `after()` de Next funciona en route handlers con `next start` autoalojado: el servidor
// de Node mantiene vivas las tareas con su `waitUntil` interno. El proceso no muere al
// terminar la petición (no es serverless), así que el trabajo termina.
//
// Por qué un envoltorio de una línea: con el `after` real el callback corre al cerrarse la
// respuesta y una prueba no tiene forma de esperarlo ni de saber que se agendó. Las pruebas
// sustituyen este módulo por un doble que guarda el callback y lo ejecuta a voluntad.
import { after } from "next/server";

/**
 * Agenda `fn` para después de enviar la respuesta. Solo se puede llamar dentro de una
 * petición (route handler, server action); fuera de una, `after` lanza.
 *
 * `fn` debe atrapar sus propios errores: aunque Next registra lo que se escape, ahí ya no
 * hay respuesta a la cual avisar y nadie más lo va a ver.
 */
export function runAfterResponse(fn: () => unknown | Promise<unknown>): void {
  after(fn);
}
