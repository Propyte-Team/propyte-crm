// «Probar» una cuenta YA conectada (E6): una sola llamada de lectura al proveedor con las
// credenciales guardadas, sin pedirle nada al usuario. Reutiliza `testConnection` (la misma que
// usa el asistente de alta) para no duplicar las llamadas a Graph/TikTok/LinkedIn/Google.
//
//   - Éxito: { ok: true, detalle: "Conexión válida · <nombre de la cuenta>" }.
//   - Fallo: { ok: false, detalle: <causa en español>, error: <texto crudo del proveedor> } y la
//     ruta sube `errorCount` y guarda `lastError`. Un éxito NO limpia errores viejos: el error pudo
//     venir de otra causa (p. ej. una firma inválida) y borrarlo escondería un problema vigente.
//
// Las credenciales se descifran aquí, en el servidor, y nunca salen en el resultado.
import type { LeadConnector } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";
import { providerById } from "./registry";
import { testConnection, type TestResult } from "./test-connection";
import { traducirErrorConexion } from "@/components/conexiones/connection-status";

export interface ResultadoPrueba {
  ok: boolean;
  /** Mensaje para el usuario, en español. */
  detalle: string;
  /** Texto crudo del proveedor (solo si falló): va a `lastError` y al «Detalle técnico». */
  error?: string;
}

type ConectorProbable = Pick<LeadConnector, "provider" | "config" | "credentials">;

export interface DepsProbar {
  /** Inyectables para probar sin red ni llave de cifrado. */
  leerCredenciales?: (c: ConectorProbable) => Record<string, string> | null;
  probar?: (provider: string, creds: Record<string, string>) => Promise<TestResult>;
}

/** Une config (IDs no secretos) y credenciales (cifradas) con las claves que espera testConnection. */
export function credencialesParaProbar(
  config: unknown,
  credenciales: Record<string, string>,
): Record<string, string> {
  const plano: Record<string, string> = {};
  if (config && typeof config === "object") {
    for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number") plano[k] = String(v);
    }
  }
  // Las credenciales ganan sobre config si una clave está en ambos.
  return { ...plano, ...credenciales };
}

export async function probarConector(c: ConectorProbable, deps: DepsProbar = {}): Promise<ResultadoPrueba> {
  const def = providerById(c.provider);
  if (!def || def.testKind === "none") {
    return { ok: false, detalle: "Este tipo de cuenta todavía no se puede probar desde aquí." };
  }
  const leer = deps.leerCredenciales ?? ((x: ConectorProbable) => readCredentials(x as LeadConnector));
  const guardadas = leer(c);
  if (!guardadas) {
    return {
      ok: false,
      detalle: "No se pudieron leer las credenciales guardadas de esta cuenta. Vuelve a conectarla o cambia su token.",
    };
  }
  const creds = credencialesParaProbar(c.config, guardadas);
  const r = await (deps.probar ?? testConnection)(c.provider, creds);
  if (r.ok) {
    return { ok: true, detalle: r.accountName ? `Conexión válida · ${r.accountName}` : "Conexión válida" };
  }
  const crudo = (r.detail ?? "Sin detalle").slice(0, 500);
  const t = traducirErrorConexion(crudo);
  return { ok: false, detalle: t?.mensaje ?? "La cuenta no respondió bien.", error: crudo };
}
