// #988 — Sección «Cadencia de nuevos» de la ficha del contacto: en qué día va, los toques de hoy
// (y los atrasados) para marcarlos aquí mismo, lo que ya se hizo y lo que sigue. No se muestra si
// el contacto nunca tuvo cadencia.
"use client";

import { useCallback, useEffect, useState } from "react";
import type { CadenciaDeContacto } from "@/lib/copilot/cadencia-servicio";
import { CANAL_LABELS, RESULTADO_LABELS, TIPO_CADENCIA_LABELS, type Canal, type Resultado } from "@/lib/copilot/cadencia-nuevos";
import { TareaDelDia } from "./tarea-del-dia";

const MOTIVO_FIN: Record<string, string> = {
  RESPONDIO: "Terminó: el lead respondió y pasó a Contactado",
  SALIO_DEL_ESTADO: "Terminó: el contacto salió de Nuevo / Sin respuesta",
  YA_NO_APLICA: "Terminó: el contacto ya no lleva la cadencia (tipo, flujo o No contactar)",
  SIN_RESPUESTA: "Terminó sin respuesta: pasó a Perdido · Sin respuesta tras cadencia",
};

export function CadenciaDelContacto({ contactId, userId, onCambio }: { contactId: string; userId: string; onCambio?: () => void }) {
  const [data, setData] = useState<CadenciaDeContacto | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/copilot/contactos/${contactId}`);
      if (!res.ok) return setData(null);
      setData((await res.json()).data ?? null);
    } catch {
      setData(null);
    }
  }, [contactId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!data) return null;

  const pendientes = data.tareas.filter((t) => t.pendientes > 0);
  const hechas = data.tareas.filter((t) => t.pendientes === 0);
  const activa = data.estado === "ACTIVA";
  const refrescar = () => {
    void cargar();
    onCambio?.();
  };

  return (
    <div className="crm-card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-[color:var(--text-primary)]">{TIPO_CADENCIA_LABELS[data.tipo]}</h3>
        <span className="text-[12px] text-[color:var(--text-secondary)]">
          {activa ? `Día ${Math.min(data.dia, data.ultimoDia)} de ${data.ultimoDia}` : MOTIVO_FIN[data.motivoFin ?? ""] ?? "Terminó"}
        </span>
      </div>

      {activa && pendientes.length === 0 && (
        <p className="text-[12px] text-[color:var(--text-tertiary)]">Hoy no hay toques pendientes.</p>
      )}
      {pendientes.map((t) => (
        <TareaDelDia key={t.clave} tarea={t} userId={userId} onCambio={refrescar} mostrarContacto={false} />
      ))}

      {(hechas.length > 0 || data.siguientes.length > 0) && (
        <button type="button" className="text-[12px] text-[color:var(--text-secondary)] underline" onClick={() => setVerHistorial((v) => !v)}>
          {verHistorial ? "Ocultar el historial y lo que sigue" : "Ver el historial y lo que sigue"}
        </button>
      )}
      {verHistorial && (
        <div className="space-y-2 text-[12px]">
          {hechas.map((t) => (
            <div key={t.clave}>
              <span className="font-medium text-[color:var(--text-primary)]">Día {t.dia}:</span>{" "}
              <span className="text-[color:var(--text-secondary)]">
                {t.toques.map((q) => `${q.codigo} ${RESULTADO_LABELS[q.resultado as Resultado] ?? q.resultado ?? "pendiente"}`).join(" · ")}
              </span>
            </div>
          ))}
          {data.siguientes.length > 0 && (
            <div>
              <span className="font-medium text-[color:var(--text-primary)]">Lo que sigue:</span>{" "}
              <span className="text-[color:var(--text-secondary)]">
                {Object.entries(
                  data.siguientes.reduce<Record<number, string[]>>((acc, s) => {
                    (acc[s.dia] ??= []).push(`${s.codigo} (${CANAL_LABELS[s.canal as Canal] ?? s.canal})`);
                    return acc;
                  }, {}),
                )
                  .map(([dia, qs]) => `día ${dia}: ${qs.join(", ")}`)
                  .join(" · ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
