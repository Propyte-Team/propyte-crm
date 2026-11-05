// #988 — Copilot → Plantillas: los textos de la cadencia de nuevos (ES/EN, por toque y variante).
// Las editan dirección, gerencia, Marketing y Admin; los asesores las ven.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Plantilla } from "@/lib/copilot/plantillas";

const CANAL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS (solo +1)", CORREO: "Correo", BUZON: "Buzón de voz", DATO: "Dato" };

function Fila({ p, editable }: { p: Plantilla & { updatedAt?: string | Date }; editable: boolean }) {
  const router = useRouter();
  const [cuerpo, setCuerpo] = useState(p.cuerpo);
  const [asunto, setAsunto] = useState(p.asunto ?? "");
  const [estado, setEstado] = useState<"" | "guardando" | "ok" | string>("");
  const cambio = cuerpo !== p.cuerpo || (asunto || null) !== (p.asunto || null);

  async function guardar() {
    setEstado("guardando");
    try {
      const res = await fetch(`/api/copilot/plantillas/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuerpo, ...(p.canal === "CORREO" ? { asunto: asunto || null } : {}) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setEstado(j?.error ?? "No se pudo guardar");
      setEstado("ok");
      router.refresh();
    } catch {
      setEstado("No se pudo guardar (sin conexión)");
    }
  }

  return (
    <div className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-semibold text-[color:var(--text-primary)]">{p.nombre}</span>
        <span className="rounded border px-1.5 py-0.5 text-[11px]" style={{ borderColor: "var(--border-default)" }}>
          {p.idioma === "EN" ? "Inglés" : "Español"}
        </span>
        <span className="text-[color:var(--text-tertiary)]">{CANAL[p.canal] ?? p.canal}</span>
      </div>
      {p.canal === "CORREO" && (
        <input
          className="form-input w-full text-[13px]"
          value={asunto}
          placeholder="Asunto (vacío: lo escribe el asesor)"
          onChange={(e) => setAsunto(e.target.value)}
          readOnly={!editable}
          aria-label={`Asunto de ${p.nombre}`}
        />
      )}
      <textarea
        className="form-input min-h-[88px] w-full text-[13px] leading-snug"
        value={cuerpo}
        onChange={(e) => setCuerpo(e.target.value)}
        readOnly={!editable}
        aria-label={`Texto de ${p.nombre} en ${p.idioma === "EN" ? "inglés" : "español"}`}
      />
      {editable && (
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary text-[12px]" disabled={!cambio || estado === "guardando"} onClick={guardar}>
            {estado === "guardando" ? "Guardando…" : "Guardar"}
          </button>
          {estado === "ok" && <span className="text-[12px] text-emerald-600">Guardado</span>}
          {estado && estado !== "ok" && estado !== "guardando" && <span className="text-[12px] text-red-600">{estado}</span>}
        </div>
      )}
    </div>
  );
}

export function EditorPlantillas({ plantillas, editable }: { plantillas: (Plantilla & { updatedAt?: string | Date })[]; editable: boolean }) {
  return (
    <div className="space-y-4">
      <div className="crm-card space-y-1 text-[12px] text-[color:var(--text-secondary)]">
        <p>
          Variables que llena el CRM: [NOMBRE] [ASESOR] [ROL] [ZONA] [wa.me/NÚMERO] [WhatsApp] [firma] [LÍNEA DE VALOR] (según la
          zona) y [CIFRA] (la de la zona). Las demás —[PROYECTO], [TICKET], [N], [M], [FECHA], [EVENTO]…— las llena el asesor
          antes de enviar.
        </p>
        <p>Guardarraíles del PDF: cifra real o no se usa; un solo llamado a la acción; Tracción solo con dato real y favorable; cierre sin culpa.</p>
        {!editable && <p>Solo dirección, gerencia, Marketing o Admin pueden editarlas.</p>}
      </div>
      <div className="crm-card divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {plantillas.map((p) => (
          <Fila key={p.id} p={p} editable={editable} />
        ))}
      </div>
    </div>
  );
}
