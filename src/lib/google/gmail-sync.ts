// Revisión del correo entrante de todos los buzones conectados (#889).
//
// Una sola definición para los dos que la llaman:
//   - la etapa `correoEntrante` del tick /api/cron/workflows, que corre cada minuto;
//   - /api/cron/google/gmail-sync, el cron de respaldo de GW-1 (si sigue agendado en
//     Hostinger, ahora hace lo mismo que la etapa y no estorba: todo es idempotente por
//     gmailMessageId).
//
// Lo que NO es: tiempo real. Entre que el correo llega a Gmail y aparece en el CRM pasa
// hasta un minuto (lo que tarde el siguiente tick). El push de Gmail (Pub/Sub +
// users.watch) sigue sin configurar; ver la #706.
import prisma from "@/lib/db"
import { processGmailHistory } from "./gmail"
import { GWNotConnectedError } from "./workspace.service"

export interface ResultadoSincronizacion {
  cuentas: number
  registrados: number
  omitidos: number
  /** Cuentas cuyo token Google ya no sirve: quedan marcadas para reconectar, no es un fallo. */
  desconectadas: number
  errores: string[]
}

export async function sincronizarCorreoEntrante(): Promise<ResultadoSincronizacion> {
  const tokens = await prisma.googleOAuthToken.findMany({ where: { isValid: true }, select: { userId: true } })

  const r: ResultadoSincronizacion = { cuentas: tokens.length, registrados: 0, omitidos: 0, desconectadas: 0, errores: [] }
  for (const t of tokens) {
    try {
      const { logged, skipped } = await processGmailHistory(t.userId)
      r.registrados += logged
      r.omitidos += skipped
    } catch (e) {
      if (e instanceof GWNotConnectedError) {
        r.desconectadas++
        continue
      }
      // Solo el message: el error de Gaxios trae client_secret en su config.
      r.errores.push(`${t.userId}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    }
  }
  return r
}

/**
 * Versión para el tick: si alguna cuenta falló por algo que NO es estar desconectada,
 * lanza DESPUÉS de procesar todas, para que la etapa salga en `fallos` y el tick dé 500.
 * Una cuenta rota no frena a las demás.
 */
export async function sincronizarCorreoEntranteTick(): Promise<ResultadoSincronizacion> {
  const r = await sincronizarCorreoEntrante()
  if (r.errores.length > 0) {
    throw new Error(`correo entrante: ${r.errores.length} cuenta(s) con error — ${r.errores.slice(0, 3).join(" | ")}`)
  }
  return r
}
