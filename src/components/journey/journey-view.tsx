"use client";
// /journey: el embudo arriba y debajo los flujos de las reglas. Una pastilla del embudo abre el flujo
// de esa regla. Admin y Dirección editan la regla en el mismo lienzo; el gerente solo la ve.
import { useCallback, useState } from "react";
import { Embudo } from "./embudo";
import { FlujosReglas } from "./flujos-reglas";

export function JourneyView({ puedeEditar = false }: { puedeEditar?: boolean }) {
  const [abrirRegla, setAbrirRegla] = useState<{ id: string; n: number } | null>(null);

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
        <FlujosReglas abrirRegla={abrirRegla} puedeEditar={puedeEditar} />
      </div>
    </>
  );
}
