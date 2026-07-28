// Captura rápida de la agenda personal (spec §6): un input, un toggle TASK/NOTE
// y fecha opcional. Sin contacto — eso es lo que hace personal a la actividad.
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, StickyNote, Loader2, Plus } from "lucide-react";

type CaptureType = "TASK" | "NOTE";

export function QuickCapture() {
  const router = useRouter();
  const [type, setType] = React.useState<CaptureType>("TASK");
  const [subject, setSubject] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSubmit = subject.trim().length >= 3 && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/agenda/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityType: type,
          subject: subject.trim(),
          // Solo se manda dueDate si el usuario puso fecha: el schema es .strict()
          // y rechaza una cadena vacía, así que la clave se omite por completo.
          ...(type === "TASK" && dueDate ? { dueDate } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo guardar");
      }

      setSubject("");
      setDueDate("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="crm-card p-4">
      <div className="flex items-center gap-2 pb-3">
        {(["TASK", "NOTE"] as CaptureType[]).map((t) => {
          const active = type === t;
          const Icon = t === "TASK" ? CheckSquare : StickyNote;
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t);
                // Al salir de TASK se descarta la fecha: si no, reaparece al
                // volver a TASK aunque el usuario la haya dado por descartada.
                if (t !== "TASK") setDueDate("");
              }}
              aria-pressed={active}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
              style={{
                background: active ? "var(--text-primary)" : "transparent",
                color: active ? "var(--text-inverse, #fff)" : "var(--text-secondary)",
                border: `1px solid ${active ? "var(--text-primary)" : "var(--border-subtle)"}`,
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {t === "TASK" ? "Tarea" : "Nota"}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={
            type === "TASK" ? "Preparar propuesta para la junta del jueves" : "Anotar una idea…"
          }
          maxLength={200}
          aria-label={type === "TASK" ? "Asunto de la tarea" : "Asunto de la nota"}
          className="min-w-0 flex-1 rounded-md px-3 py-2 text-[13px]"
          style={{
            background: "var(--bg-input, transparent)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
          }}
        />

        {type === "TASK" && (
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Fecha de vencimiento (opcional)"
            className="rounded-md px-3 py-2 text-[13px]"
            style={{
              background: "var(--bg-input, transparent)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
            }}
          />
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
          style={{ background: "var(--text-primary)", color: "var(--text-inverse, #fff)" }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Guardar
        </button>
      </div>

      {error && (
        <p role="alert" className="pt-2 text-[12px]" style={{ color: "#DC2626" }}>
          {error}
        </p>
      )}
    </form>
  );
}
