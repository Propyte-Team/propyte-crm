// src/lib/google/workspace.service.ts
// Capa de acceso a Google Workspace. Server-side only (PG2).
// OAuth2 web client + refresh automático + cifrado de tokens.
import { OAuth2Client } from "google-auth-library"
import { google } from "googleapis"
import prisma from "@/lib/db"
import { encryptGoogleToken, decryptGoogleToken } from "@/lib/crypto-google"

// Scopes mínimos (PG5): leer + enviar Gmail.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
]

export class GWNotConnectedError extends Error {
  constructor(msg = "Cuenta Google no conectada") {
    super(msg)
    this.name = "GWNotConnectedError"
  }
}

/** Crea un OAuth2Client con las credenciales de la app. */
export function getOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI")
  }
  return new OAuth2Client({ clientId, clientSecret, redirectUri })
}

/** URL de consentimiento (offline + consent para obtener refresh_token). */
export function buildConsentUrl(state: string): string {
  return getOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  })
}

/** Devuelve un access token vigente para el usuario, refrescando si expiró. */
export async function getValidAccessToken(userId: string): Promise<string> {
  const record = await prisma.googleOAuthToken.findUnique({ where: { userId } })
  if (!record || !record.isValid) throw new GWNotConnectedError()

  // Margen de 60s
  if (record.tokenExpiry.getTime() > Date.now() + 60_000) {
    const tok = decryptGoogleToken(record.accessToken)
    if (tok) {
      await prisma.googleOAuthToken.update({ where: { userId }, data: { lastUsedAt: new Date() } })
      return tok
    }
  }

  // Refrescar
  const client = getOAuthClient()
  const refresh = decryptGoogleToken(record.refreshToken)
  if (!refresh) throw new GWNotConnectedError()
  client.setCredentials({ refresh_token: refresh })
  try {
    const { token } = await client.getAccessToken()
    if (!token) throw new Error("Sin access token tras refresh")
    const expiry = client.credentials.expiry_date ?? Date.now() + 3500_000
    await prisma.googleOAuthToken.update({
      where: { userId },
      data: {
        accessToken: encryptGoogleToken(token)!,
        tokenExpiry: new Date(expiry),
        lastUsedAt: new Date(),
      },
    })
    return token
  } catch (err) {
    // Refresh token inválido → marcar para reconexión (PG7)
    await prisma.googleOAuthToken.update({ where: { userId }, data: { isValid: false } }).catch(() => {})
    throw new GWNotConnectedError("El refresh token de Google expiró; reconecta tu cuenta")
  }
}

/** Cliente Gmail autenticado para el usuario (usado por GW-1). */
export async function getGmailClient(userId: string) {
  const accessToken = await getValidAccessToken(userId)
  const client = getOAuthClient()
  client.setCredentials({ access_token: accessToken })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return google.gmail({ version: "v1", auth: client as any })
}

export interface GWConnectionStatus {
  connected: boolean
  googleEmail?: string
  connectedAt?: Date
  isValid?: boolean
}

/** Estado de conexión para /settings (degradación suave: nunca lanza). */
export async function getConnectionStatus(userId: string): Promise<GWConnectionStatus> {
  try {
    const record = await prisma.googleOAuthToken.findUnique({ where: { userId } })
    if (!record) return { connected: false }
    return {
      connected: true,
      googleEmail: record.googleEmail,
      connectedAt: record.connectedAt,
      isValid: record.isValid,
    }
  } catch {
    // tabla aún no aplicada / error → tratar como no conectado
    return { connected: false }
  }
}
