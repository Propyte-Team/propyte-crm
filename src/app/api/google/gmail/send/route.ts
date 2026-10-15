// src/app/api/google/gmail/send/route.ts
// Alias de /api/email/enviar (#885), que ya no está atado a Gmail. Se conserva para no romper
// a quien todavía llame a esta dirección; el compositor del CRM ya usa la nueva.
export { POST } from "@/app/api/email/enviar/route"

export const dynamic = "force-dynamic"
