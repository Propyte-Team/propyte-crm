// src/lib/crypto-google.ts
// Cifrado de tokens OAuth de Google a nivel app. AES-256-GCM.
// Formato: v1:<iv b64>:<authTag b64>:<ciphertext b64>
// Llave separada de KYC para aislamiento de rotación.
// Generar: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

function key(): Buffer {
  const k = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  if (!k) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY no configurada")
  const buf = Buffer.from(k, "base64")
  if (buf.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY debe ser 32 bytes en base64")
  return buf
}

export function encryptGoogleToken(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`
}

export function decryptGoogleToken(value: string | null | undefined): string | null {
  if (value == null || value === "") return null
  const [v, ivB64, tagB64, dataB64] = value.split(":")
  if (v !== "v1") throw new Error("Formato de cifrado desconocido")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}
