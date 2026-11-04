"use client";

// Tarjeta de Configuración → Flujos de trabajo y SLA: reasignación por falta de primer
// contacto. La regla vive en lib/workflows/sla-reasignacion.ts; esto solo la enciende y fija
// el plazo y el tope.
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui/use-toast";
import {
  CONFIG_POR_DEFECTO,
  LIMITES,
  formatoPlazo,
  type ConfigReasignacion,
} from "@/lib/workflows/sla-reasignacion-model";

export function SlaReasignacionCard({ canEdit }: { canEdit: boolean }) {
  const [guardada, setGuardada] = useState<ConfigReasignacion>(CONFIG_POR_DEFECTO);
  const [activo, setActivo] = useState(false);
  const [minutos, setMinutos] = useState(String(CONFIG_POR_DEFECTO.minutosHabiles));
  const [tope, setTope] = useState(String(CONFIG_POR_DEFECTO.maxReasignaciones));
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const aplicar = useCallback((c: ConfigReasignacion) => {
    setGuardada(c);
    setActivo(c.activo);
    setMinutos(String(c.minutosHabiles));
    setTope(String(c.maxReasignaciones));
  }, []);

  useEffect(() => {
    fetch("/api/admin/automation/sla-reasignacion")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && aplicar(j.data))
      .catch(() => {});
  }, [aplicar]);

  const minutosNum = Number(minutos);
  const topeNum = Number(tope);
  const valido =
    Number.isInteger(minutosNum) &&
    minutosNum >= LIMITES.minutosHabiles.min &&
    minutosNum <= LIMITES.minutosHabiles.max &&
    Number.isInteger(topeNum) &&
    topeNum >= LIMITES.maxReasignaciones.min &&
    topeNum <= LIMITES.maxReasignaciones.max;
  const cambio =
    activo !== guardada.activo ||
    minutosNum !== guardada.minutosHabiles ||
    topeNum !== guardada.maxReasignaciones;

  async function guardar() {
    if (!valido) {
      setMsg(
        `El plazo va de ${LIMITES.minutosHabiles.min} a ${LIMITES.minutosHabiles.max} minutos y el tope ` +
          `de ${LIMITES.maxReasignaciones.min} a ${LIMITES.maxReasignaciones.max}.`,
      );
      return;
    }
    setGuardando(true);
    setMsg("");
    const res = await fetch("/api/admin/automation/sla-reasignacion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo, minutosHabiles: minutosNum, maxReasignaciones: topeNum }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      setMsg("No se pudo guardar. Intenta de nuevo.");
      return;
    }
    const { data } = await res.json();
    aplicar(data);
    toast({ title: data.activo ? "Reasignación encendida" : "Reasignación apagada" });
  }

  return (
    <div className="crm-card !p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 hairline-b">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Reasignación por falta de primer contacto</p>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Si el asesor no contacta al lead dentro del plazo (en horario laboral), el lead pasa al siguiente
            asesor del turno. Solo aplica a leads que repartió el sistema.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={activo}
          aria-label="Reasignación por falta de primer contacto"
          disabled={!canEdit}
          onClick={() => setActivo(!activo)}
          className="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40"
          style={{ background: activo ? "var(--color-success)" : "var(--bg-badge-neutral)" }}
        >
          <span
            className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
            style={{ left: activo ? "18px" : "2px", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }}
          />
        </button>
      </div>

      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            Plazo para el primer contacto (minutos hábiles)
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={LIMITES.minutosHabiles.min}
            max={LIMITES.minutosHabiles.max}
            step={15}
            value={minutos}
            disabled={!canEdit}
            onChange={(e) => setMinutos(e.target.value)}
            className="form-input mt-1 text-[13px]"
          />
          {Number.isInteger(minutosNum) && minutosNum > 0 && (
            <span className="mt-1 block text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {formatoPlazo(minutosNum)} de horario laboral
            </span>
          )}
        </label>
        <label className="block">
          <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            Máximo de reasignaciones por lead
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={LIMITES.maxReasignaciones.min}
            max={LIMITES.maxReasignaciones.max}
            step={1}
            value={tope}
            disabled={!canEdit}
            onChange={(e) => setTope(e.target.value)}
            className="form-input mt-1 text-[13px]"
          />
          <span className="mt-1 block text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Después del tope, el lead se queda y sigue el escalamiento al líder.
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pb-4">
        <p className="text-[12px]" style={{ color: msg ? "var(--color-error)" : "var(--text-tertiary)" }}>
          {msg ||
            (guardada.activo && guardada.activoDesde
              ? `Encendida desde ${new Date(guardada.activoDesde).toLocaleString("es-MX", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}. Los leads asignados antes no se tocan.`
              : "Apagada. Los leads asignados antes de encenderla no se tocan.")}
        </p>
        {canEdit && (
          <button
            type="button"
            className="btn-primary shrink-0 text-[12px]"
            disabled={!cambio || guardando}
            onClick={guardar}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        )}
      </div>
    </div>
  );
}
