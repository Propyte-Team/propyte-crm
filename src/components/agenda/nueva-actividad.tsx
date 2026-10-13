// Modal "Nueva reunión" / "Nueva llamada" de las tablas de la Agenda (HUB #857).
// Crea la actividad PENDIENTE contra POST /api/agenda/citas: asunto, tipo, fecha y hora,
// contacto (obligatorio, con buscador) y, en reuniones, duración opcional.
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { TablaAgenda } from "@/lib/agenda/columnas";
import { ContactPicker, type PickedContact } from "./contact-picker";

interface NuevaActividadProps {
  tabla: TablaAgenda;
  onClose: () => void;
}

const TIPOS: Record<TablaAgenda, { value: string; label: string }[]> = {
  reuniones: [
    { value: "MEETING_VIRTUAL", label: "Virtual" },
    { value: "MEETING_PRESENTIAL", label: "Presencial" },
    { value: "MEETING_SHOWROOM", label: "Showroom" },
  ],
  llamadas: [
    { value: "CALL_OUTBOUND", label: "Saliente" },
    { value: "CALL_INBOUND", label: "Entrante" },
  ],
};

const TEXTOS: Record<TablaAgenda, { titulo: string; tipo: string; asunto: string; placeholder: string }> = {
  reuniones: {
    titulo: "Nueva reunión",
    tipo: "Tipo de reunión",
    asunto: "Título",
    placeholder: "Presentación de propuesta",
  },
  llamadas: {
    titulo: "Nueva llamada",
    tipo: "Tipo de llamada",
    asunto: "Asunto",
    placeholder: "Dar seguimiento a la cotización",
  },
};

const fieldStyle: React.CSSProperties = {
  background: "var(--bg-input, transparent)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};

export function NuevaActividad({ tabla, onClose }: NuevaActividadProps) {
  const router = useRouter();
  const textos = TEXTOS[tabla];
  const tipos = TIPOS[tabla];

  const [tipo, setTipo] = React.useState(tipos[0].value);
  const [asunto, setAsunto] = React.useState("");
  const [fecha, setFecha] = React.useState(""); // datetime-local: "YYYY-MM-DDTHH:mm", hora de Cancún
  const [duracion, setDuracion] = React.useState("");
  const [descripcion, setDescripcion] = React.useState("");
  const [contacto, setContacto] = React.useState<PickedContact | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const duracionNum = duracion.trim() === "" ? null : Number(duracion);
  const duracionValida =
    duracionNum === null || (Number.isInteger(duracionNum) && duracionNum >= 1 && duracionNum <= 480);
  const canSubmit = asunto.trim().length >= 3 && fecha !== "" && contacto !== null && duracionValida && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !contacto) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/agenda/citas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityType: tipo,
          subject: asunto.trim(),
          // El servidor ancla el datetime-local a la hora de Cancún (lib/due-date).
          dueDate: fecha,
          contactId: contacto.id,
          // El schema es .strict(): las claves opcionales se omiten si están vacías.
          ...(tabla === "reuniones" && duracionNum !== null ? { durationMinutes: duracionNum } : {}),
          ...(descripcion.trim() ? { description: descripcion.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo guardar");
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={textos.titulo}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-auto rounded-xl p-4 shadow-xl"
        style={{ background: "var(--bg-card, #fff)", border: "1px solid var(--border-subtle)" }}
      >
        <h3 className="text-[15px] font-semibold text-[color:var(--text-primary)]">{textos.titulo}</h3>

        <label className="flex flex-col gap-1 text-[12px] text-[color:var(--text-secondary)]">
          {textos.asunto}
          <input
            type="text"
            value={asunto}
            onChange={(e) => setAsunto(e.target.value)}
            placeholder={textos.placeholder}
            maxLength={200}
            autoFocus
            className="rounded-md px-3 py-2 text-[13px]"
            style={fieldStyle}
          />
        </label>

        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-[color:var(--text-secondary)]">
            {textos.tipo}
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="rounded-md px-3 py-2 text-[13px]"
              style={fieldStyle}
            >
              {tipos.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {tabla === "reuniones" && (
            <label className="flex w-28 flex-col gap-1 text-[12px] text-[color:var(--text-secondary)]">
              Duración (min)
              <input
                type="number"
                min={1}
                max={480}
                step={1}
                value={duracion}
                onChange={(e) => setDuracion(e.target.value)}
                placeholder="Opcional"
                className="rounded-md px-3 py-2 text-[13px]"
                style={fieldStyle}
              />
            </label>
          )}
        </div>

        <label className="flex flex-col gap-1 text-[12px] text-[color:var(--text-secondary)]">
          Fecha y hora
          <input
            type="datetime-local"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded-md px-3 py-2 text-[13px]"
            style={fieldStyle}
          />
        </label>

        <div className="flex flex-col gap-1 text-[12px] text-[color:var(--text-secondary)]">
          Contacto
          <ContactPicker value={contacto} onChange={setContacto} disabled={saving} />
        </div>

        <label className="flex flex-col gap-1 text-[12px] text-[color:var(--text-secondary)]">
          Descripción (opcional)
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            maxLength={5000}
            className="resize-none rounded-md px-3 py-2 text-[13px]"
            style={fieldStyle}
          />
        </label>

        {!duracionValida && (
          <p className="text-[12px]" style={{ color: "#DC2626" }}>
            La duración debe ser un número entero entre 1 y 480 minutos.
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12px]" style={{ color: "#DC2626" }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
            style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] font-semibold disabled:opacity-40"
            style={{ background: "var(--text-primary)", color: "var(--text-inverse, #fff)" }}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
