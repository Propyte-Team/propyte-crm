// Modal "Nueva reunión" / "Nueva llamada" de las tablas de la Agenda (HUB #857) y, con
// `actividad`, "Editar reunión" / "Editar llamada" (HUB #859).
// Alta: crea la actividad PENDIENTE contra POST /api/agenda/citas. Edición: PATCH a
// /api/agenda/citas/[id]. Campos: asunto, tipo, fecha y hora, contacto (con buscador) y, en
// reuniones, duración opcional.
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { TablaAgenda } from "@/lib/agenda/columnas";
import { aDatetimeLocalCancun } from "@/lib/agenda/cita-form";
import type { AgendaActivityRow } from "@/server/agenda";
import { ContactPicker, type PickedContact } from "./contact-picker";

interface NuevaActividadProps {
  tabla: TablaAgenda;
  onClose: () => void;
  /** Si viene, el modal edita esa cita en vez de crear una nueva. */
  actividad?: AgendaActivityRow;
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

const TEXTOS: Record<TablaAgenda, { titulo: string; tituloEditar: string; tipo: string; asunto: string; placeholder: string }> = {
  reuniones: {
    titulo: "Nueva reunión",
    tituloEditar: "Editar reunión",
    tipo: "Tipo de reunión",
    asunto: "Título",
    placeholder: "Presentación de propuesta",
  },
  llamadas: {
    titulo: "Nueva llamada",
    tituloEditar: "Editar llamada",
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

export function NuevaActividad({ tabla, onClose, actividad }: NuevaActividadProps) {
  const router = useRouter();
  const textos = TEXTOS[tabla];
  const tipos = TIPOS[tabla];
  const editando = actividad !== undefined;
  const tituloModal = editando ? textos.tituloEditar : textos.titulo;

  const [tipo, setTipo] = React.useState(actividad?.activityType ?? tipos[0].value);
  const [asunto, setAsunto] = React.useState(actividad?.subject ?? "");
  // datetime-local: "YYYY-MM-DDTHH:mm", hora de Cancún
  const [fecha, setFecha] = React.useState(aDatetimeLocalCancun(actividad?.dueDate));
  const [duracion, setDuracion] = React.useState(
    actividad?.durationMinutes ? String(actividad.durationMinutes) : "",
  );
  const [descripcion, setDescripcion] = React.useState(actividad?.description ?? "");
  const [contacto, setContacto] = React.useState<PickedContact | null>(
    actividad?.contactId && actividad.contactName
      ? { id: actividad.contactId, name: actividad.contactName }
      : null,
  );
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
  // Alta: el contacto es obligatorio. Edición: solo si la cita ya tenía uno (no se puede
  // quitar); una cita antigua sin contacto se puede editar sin elegir ninguno.
  const contactoRequerido = !editando || Boolean(actividad?.contactId);
  const canSubmit =
    asunto.trim().length >= 3 &&
    fecha !== "" &&
    (contacto !== null || !contactoRequerido) &&
    duracionValida &&
    !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    try {
      const base = {
        activityType: tipo,
        subject: asunto.trim(),
        // El servidor ancla el datetime-local a la hora de Cancún (lib/due-date).
        dueDate: fecha,
      };
      // El schema es .strict(): en el alta las claves opcionales se omiten si están vacías;
      // en la edición se mandan null para que vaciar un campo lo borre de verdad.
      const payload = editando
        ? {
            ...base,
            description: descripcion.trim() ? descripcion.trim() : null,
            ...(tabla === "reuniones" ? { durationMinutes: duracionNum } : {}),
            // Solo si cambió: no hay razón para revalidar el contacto de una cita que no lo tocó.
            ...(contacto && contacto.id !== actividad?.contactId ? { contactId: contacto.id } : {}),
          }
        : {
            ...base,
            contactId: contacto!.id,
            ...(tabla === "reuniones" && duracionNum !== null ? { durationMinutes: duracionNum } : {}),
            ...(descripcion.trim() ? { description: descripcion.trim() } : {}),
          };

      const res = await fetch(editando ? `/api/agenda/citas/${actividad.id}` : "/api/agenda/citas", {
        method: editando ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
        aria-label={tituloModal}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-auto rounded-xl p-4 shadow-xl"
        style={{ background: "var(--bg-card, #fff)", border: "1px solid var(--border-subtle)" }}
      >
        <h3 className="text-[15px] font-semibold text-[color:var(--text-primary)]">{tituloModal}</h3>

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
