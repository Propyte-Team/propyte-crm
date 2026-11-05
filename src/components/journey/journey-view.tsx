"use client";
// /journey: el embudo arriba (J1) y el mapa de reglas debajo. Una pastilla del embudo abre el flujo
// de esa regla en el mapa.
import { useCallback, useState } from "react";
import { Embudo } from "./embudo";
import { JourneyMapView } from "./journey-map-view";

/** `conMapa` = false para quien solo ve el embudo (el gerente: el mapa y sus métricas son de Dirección/Admin). */
export function JourneyView({ conMapa = true }: { conMapa?: boolean }) {
  const [abrirRegla, setAbrirRegla] = useState<{ id: string; n: number } | null>(null);

  const abrir = useCallback((id: string) => {
    setAbrirRegla((a) => ({ id, n: (a?.n ?? 0) + 1 }));
    document.getElementById("journey-mapa")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <>
      <div className="-mx-6 border-b border-neutral-200 px-6 pb-6 dark:border-neutral-800">
        <Embudo onAbrirRegla={conMapa ? abrir : undefined} />
      </div>
      {/* El mapa trae su propio margen negativo (-m-6): este borde lo compensa. */}
      {conMapa && (
        <div id="journey-mapa" className="pt-6">
          <JourneyMapView abrirRegla={abrirRegla} />
        </div>
      )}
    </>
  );
}
