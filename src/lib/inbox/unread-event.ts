// src/lib/inbox/unread-event.ts (#928)
// Va aparte de ./unread.ts a propósito: este archivo lo importan componentes cliente (sidebar,
// Inbox) y no debe arrastrar al bundle el alcance del inbox ni nada de Prisma.

/**
 * Evento de ventana para que el badge del menú se actualice en el momento en que algo se marca
 * como leído (abrir un hilo, «Marcar todo como leído»), sin esperar a su sondeo de 20 s.
 */
export const INBOX_UNREAD_CHANGED_EVENT = "inbox:unread-changed";

export function notifyInboxUnreadChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INBOX_UNREAD_CHANGED_EVENT));
}
