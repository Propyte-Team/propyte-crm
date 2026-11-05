"use client";
// /journey: el embudo arriba (J1) y debajo los flujos de las reglas (J2, solo lectura). Una pastilla del
// embudo abre el flujo de esa regla. El mapa anterior queda colapsado hasta J3.
import { useCallback, useState } from "react";
import { Embudo } from "./embudo";
import { FlujosReglas } from "./flujos-reglas";
import { JourneyMapView } from "./journey-map-view";

/** `conMapa` = false para quien solo mira (el gerente): sin «Editar» ni mapa anterior (son de Dirección/Admin). */
export function JourneyView({ conMapa = true }: { conMapa?: boolean }) {
  const [abrirRegla, setAbrirRegla] = useState<{ id: string; n: number } | null>(null);
  const [verMapaAnterior, setVerMapaAnterior] = useState(false);

  const abrir = useCallback((id: string) => {
    setAbrirRegla((a) => ({ id, n: (a?.n ?? 0) + 1 }));
    document.getElementById("journey-flujos")?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  }, []);

  return (
    <>
      <div className="-mx-6 border-b border-neutral-200 px-6 pb-6 dark:border-neutral-800">
        <Embudo onAbrirRegla={abrir} />
      </div>
      <div id="journey-flujos" className="scroll-mt-4 pt-6">
        <FlujosReglas abrirRegla={abrirRegla} puedeEditar={conMapa} />
      </div>
      {conMapa && (
        <div id="journey-mapa" className="pt-6">
          <button
            type="button"
            onClick={() => setVerMapaAnterior((v) => !v)}
            aria-expanded={verMapaAnterior}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {verMapaAnterior ? "Ocultar mapa anterior" : "Ver mapa anterior"}
          </button>
          {/* El mapa trae su propio margen negativo (-m-6) y alto de pantalla: solo se monta al abrirlo. */}
          {verMapaAnterior && <div className="pt-6"><JourneyMapView /></div>}
        </div>
      )}
    </>
  );
}
