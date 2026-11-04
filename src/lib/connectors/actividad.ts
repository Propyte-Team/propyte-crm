// Prospectos recibidos por conector en los últimos 30 días (E6). Alimenta «12 en 30 días» de
// Conexiones. Solo cuenta filas de `connector_lead_logs` (formularios): los canales de mensajes
// directos no dejan fila ahí, por eso la pantalla no muestra conteo para ellos
// (ver CANALES_SIN_REGISTRO en components/conexiones/connection-status.ts).
import prisma from "@/lib/db";

export const VENTANA_ACTIVIDAD_DIAS = 30;

export async function leadsUltimos30Dias(ids: string[], ahora: Date = new Date()): Promise<Record<string, number> | null> {
  if (ids.length === 0) return {};
  const desde = new Date(ahora.getTime() - VENTANA_ACTIVIDAD_DIAS * 86_400_000);
  try {
    const filas = await prisma.connectorLeadLog.groupBy({
      by: ["connectorId"],
      where: { connectorId: { in: ids }, receivedAt: { gte: desde } },
      _count: { _all: true },
    });
    return Object.fromEntries(filas.map((f) => [f.connectorId, f._count._all]));
  } catch (err) {
    // Best-effort: null = «no se pudo contar» (la pantalla omite la cifra en vez de mostrar 0).
    console.error("[connectors] no se pudo contar la actividad de 30 días:", err);
    return null;
  }
}
