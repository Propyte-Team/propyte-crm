// Autenticación por API Key para endpoints de integraciones externas (Zapier)
import { prisma } from "@/lib/db";
import { createHash } from "crypto";
import { NextRequest } from "next/server";

/**
 * Autentica una request usando API Key en el header Authorization.
 * Formato esperado: "Bearer pk_live_xxxxxxxxxxxx"
 * Retorna el registro de ApiKey si es válido, null si no.
 */
export async function authenticateApiKey(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const rawKey = authHeader.slice(7);
  if (!rawKey) return null;

  // Hashear la key para comparar con la almacenada
  const hashedKey = hashApiKey(rawKey);

  const apiKey = await prisma.apiKey.findUnique({
    where: { hashedKey, isActive: true },
  });

  if (!apiKey) return null;

  // Actualizar último uso
  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return apiKey;
}

/**
 * Genera un par de API key: raw (para el usuario) y hashed (para almacenar).
 */
export function generateApiKeyPair(): { raw: string; hashed: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = "pk_live_" + Buffer.from(bytes).toString("base64url");
  const hashed = hashApiKey(raw);
  const prefix = raw.substring(0, 16);

  return { raw, hashed, prefix };
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
