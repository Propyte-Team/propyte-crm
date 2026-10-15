// src/app/api/google/gmail/send-as/route.ts
// Alias de /api/email/remitentes (#885). Se conserva para no romper a quien todavía llame a
// esta dirección; el compositor del CRM ya usa la nueva.
export { GET } from "@/app/api/email/remitentes/route"

export const dynamic = "force-dynamic"
