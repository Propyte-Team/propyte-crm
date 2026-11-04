// Panel «Probar con un contacto» del constructor de reglas (975). Solo lectura: manda la regla en
// edición (guardada o no) y un contacto a POST /api/admin/automation/rules/probar y pinta qué
// pasaría. No ejecuta acciones ni escribe nada.
"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { ContactPicker, type PickedContact } from "@/components/agenda/contact-picker";
import type { ResultadoPrueba } from "@/lib/workflows/probar-regla";
import type { FuentesDeAccion } from "@/lib/workflows/action-catalog";
import type { PayloadDeRegla } from "./workflow-builder-model";

type Respuesta = ResultadoPrueba & { contacto: { id: string; nombre: string } };

interface Props {
  regla: PayloadDeRegla;
  fuentes: FuentesDeAccion;
}

export function ProbarReglaPanel({ regla, fuentes }: Props) {
  const [contacto, setContacto] = useState<PickedContact | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ firma: string; data: Respuesta } | null>(null);

  const cuerpo = useMemo(
    () => ({
      rule: { triggerType: regla.triggerType, triggerConfig: regla.triggerConfig, conditions: regla.conditions, actions: regla.actions },
      fuentes: { plantillas: fuentes.plantillas, cadencias: fuentes.cadencias, usuarios: fuentes.usuarios },
    }),
    [regla, fuentes],
  );
  const firma = JSON.stringify([contacto?.id, cuerpo]);
  // Si la regla o el contacto cambian después de probar, el resultado ya no corresponde.
  const vigente = resultado && resultado.firma === firma ? resultado.data : null;

  async function probar() {
    if (!contacto) return;
    setCargando(true);
    setError(null);
    const enviada = firma;
    try {
      const res = await fetch("/api/admin/automation/rules/probar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contacto.id, ...cuerpo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d?.error === "string" ? d.error : "No se pudo probar la regla");
      } else {
        setResultado({ firma: enviada, data: d.data as Respuesta });
      }
    } catch {
      setError("No se pudo probar la regla. Revisa tu conexión.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <details className="crm-card !p-4">
      <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
        Probar con un contacto
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          Elige un contacto y mira qué pasaría con esta regla, tal como está ahora. No se ejecuta nada ni se guarda nada.
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[16rem] max-w-[26rem] flex-1">
            <ContactPicker value={contacto} onChange={setContacto} placeholder="Buscar por nombre, teléfono o email" />
          </div>
          <button type="button" className="btn-secondary text-[13px]" onClick={probar} disabled={!contacto || cargando}>
            {cargando ? "Probando…" : "Probar"}
          </button>
        </div>
        {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error}</div>}
        {resultado && !vigente && !cargando && (
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>La regla o el contacto cambió: vuelve a probar.</p>
        )}
        {vigente && <Resultado r={vigente} />}
      </div>
    </details>
  );
}

function Marca({ ok }: { ok: boolean }) {
  return ok
    ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Se cumple" />
    : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-label="No se cumple" />;
}

function Resultado({ r }: { r: Respuesta }) {
  const d = r.disparador;
  return (
    <div className="space-y-3 text-[13px]" aria-live="polite">
      <p
        className={`rounded-md border px-3 py-2 font-medium ${r.correria ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
      >
        {r.contacto.nombre ? `${r.contacto.nombre}: ` : ""}{r.veredicto}
      </p>

      <div className="space-y-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Cuando</h4>
        <p className="flex items-start gap-1.5">
          {d.aplica !== null && <Marca ok={d.aplica} />}
          <span>{d.frase}</span>
        </p>
        {d.detalle && <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{d.detalle}</p>}
      </div>

      <div className="space-y-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Si</h4>
        {r.condiciones.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>Sin condiciones: aplica siempre que ocurra el disparador.</p>
        ) : (
          <ul className="space-y-1">
            {r.condiciones.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Marca ok={c.cumple} />
                <span>
                  {c.texto}
                  <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}> — el contacto tiene: {c.actual}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {r.condiciones.length > 1 && (
          <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            En conjunto: {r.condicionesCumplen ? "se cumplen" : "no se cumplen"} ({r.condicionesFrase}).
          </p>
        )}
      </div>

      <div className="space-y-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          {r.correria ? "Entonces correría" : "Entonces correría (si se cumpliera)"}
        </h4>
        {r.acciones.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>La regla no tiene acciones.</p>
        ) : (
          <ol className="list-decimal space-y-0.5 pl-5">
            {r.acciones.map((a, i) => <li key={i}>{a}</li>)}
          </ol>
        )}
      </div>
    </div>
  );
}
