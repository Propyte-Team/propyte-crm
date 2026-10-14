// Escritura del estado de coexistencia (`LeadConnector.config.coex`) — 2026-10-14.
//
// Por qué SQL y no `prisma.leadConnector.update({ config })`: a la misma cuenta le llegan en
// paralelo los webhooks del historial (varios trozos a la vez), el `account_update` y el propio
// alta. Un leer-modificar-escribir desde JS pierde lo que escribió el otro entre la lectura y la
// escritura. Esta sentencia mezcla las claves de `patch` dentro de `config.coex` en UNA sola
// operación de Postgres: cada clave de nivel superior se reemplaza entera y las demás se quedan.
// Por eso el estado se parte en claves independientes (`historySync`, `historySyncRequestId`,
// `accountState`…): quien escribe una no pisa las otras.
import prisma from "@/lib/db";
import type { CoexState } from "./status";

export async function mergeCoexState(connectorId: string, patch: Partial<CoexState>): Promise<void> {
  const json = JSON.stringify(patch);
  await prisma.$executeRaw`
    UPDATE "propyte_crm"."lead_connectors"
    SET "config" = jsonb_set(
          COALESCE("config", '{}'::jsonb),
          '{coex}',
          COALESCE("config"->'coex', '{}'::jsonb) || ${json}::jsonb,
          true
        ),
        "updatedAt" = NOW()
    WHERE "id" = ${connectorId}`;
}

/** Igual que mergeCoexState pero nunca lanza: para los webhooks, donde el estado es un dato de más. */
export async function mergeCoexStateSafe(connectorId: string, patch: Partial<CoexState>): Promise<void> {
  try {
    await mergeCoexState(connectorId, patch);
  } catch (err) {
    console.error(
      `[whatsapp-coex] no se pudo guardar el estado de la cuenta ${connectorId}:`,
      (err as { code?: string } | null)?.code ?? (err instanceof Error ? err.message : "error"),
    );
  }
}
