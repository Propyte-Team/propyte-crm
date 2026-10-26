// src/lib/inbox/unread.ts
// "No leídos" del Inbox: UNA definición para el badge del menú (/api/inbox/unread-count) y para
// «Marcar todo como leído» (/api/inbox/mark-all-read, #928). Si divergieran, el botón dejaría
// conversaciones que el badge sigue contando (o al revés) y el 99+ nunca se apagaría.
//
// `unreadCount` es de la conversación, no por usuario: marcar como leído —abriendo el hilo o con
// el botón— lo apaga para todos los que la ven. Así funciona desde el MVP del Inbox.
import type { Prisma } from "@prisma/client";
import type { VisibleBrands } from "@/lib/brands/visibility";
import { inboxScopeWhere, type InboxScopeUser } from "./scope";

/** Conversaciones abiertas (no CLOSED) con mensajes sin leer, dentro del alcance del usuario. */
export function unreadInboxWhere(user: InboxScopeUser, visible: VisibleBrands): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = {
    status: { not: "CLOSED" },
    unreadCount: { gt: 0 },
  };
  // Con marcas (2026-10-12): no cuenta ni toca hilos de marcas que el usuario no ve.
  const alcance = inboxScopeWhere(user, visible);
  if (alcance) where.contact = { AND: [alcance] };
  return where;
}
