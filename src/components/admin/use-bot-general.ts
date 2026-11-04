// Hook compartido: baja de /api/admin/bot/resumen la configuración general del bot (estilo,
// guion activo, autonomía), los agentes, las marcas y las cuentas. Lo usan el resumen
// "¿Quién contesta?" y los selectores de Agentes y Marcas para escribir "Hereda: X (general)".
"use client";

import { useCallback, useEffect, useState } from "react";
import { leerError } from "@/lib/api-errors";
import type { AgenteLite, BotConfigLite, CuentaLite, MarcaLite, PlaybookLite } from "@/lib/bot/quien-contesta";

export interface DatosBotGeneral {
  botConfig: BotConfigLite;
  agentes: AgenteLite[];
  marcas: MarcaLite[];
  cuentas: CuentaLite[];
  playbooks: PlaybookLite[];
}

export function useBotGeneral() {
  const [datos, setDatos] = useState<DatosBotGeneral | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const recargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/admin/bot/resumen");
      if (!res.ok) {
        setError(await leerError(res, "No se pudo cargar el resumen"));
        return;
      }
      setDatos(await res.json());
    } catch {
      setError("No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { datos, cargando, error, recargar };
}
