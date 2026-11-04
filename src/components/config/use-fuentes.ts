// Carga una vez las listas para los selectores de acciones (plantillas, cadencias, usuarios).
// Si la ruta falla, `fuentes` queda {} (mapas ausentes = no validar) y `error` dice por qué.
"use client";

import { useEffect, useState } from "react";
import { fuentesDesdeRespuesta, type FuentesDeAccion } from "@/lib/workflows/action-catalog";
import { leerError } from "@/lib/api-errors";
import { LISTAS_VACIAS, type ListasDeFuentes } from "./action-card-model";

export type { ListasDeFuentes } from "./action-card-model";

export interface UseFuentes {
  fuentes: FuentesDeAccion;
  listas: ListasDeFuentes;
  cargando: boolean;
  error: string | null;
}

export function useFuentes(): UseFuentes {
  const [estado, setEstado] = useState<UseFuentes>({ fuentes: {}, listas: LISTAS_VACIAS, cargando: true, error: null });

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/automation/fuentes");
        if (!res.ok) {
          const error = await leerError(res, "No se pudieron cargar las listas");
          if (vivo) setEstado({ fuentes: {}, listas: LISTAS_VACIAS, cargando: false, error });
          return;
        }
        const json = await res.json().catch(() => ({}));
        const data = (json?.data ?? json) as Partial<ListasDeFuentes>;
        const listas: ListasDeFuentes = {
          plantillas: Array.isArray(data.plantillas) ? data.plantillas : [],
          cadencias: Array.isArray(data.cadencias) ? data.cadencias : [],
          usuarios: Array.isArray(data.usuarios) ? data.usuarios : [],
        };
        if (vivo) setEstado({ fuentes: fuentesDesdeRespuesta(listas), listas, cargando: false, error: null });
      } catch {
        if (vivo) setEstado({ fuentes: {}, listas: LISTAS_VACIAS, cargando: false, error: "No se pudieron cargar las listas" });
      }
    })();
    return () => { vivo = false; };
  }, []);

  return estado;
}
