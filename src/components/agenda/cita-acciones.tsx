// Menú de tres puntos de cada reunión o llamada de la Agenda (HUB #860): Editar, Notas y
// Eliminar. El menú va en `position: fixed` porque la tabla vive dentro de un contenedor con
// scroll horizontal y `overflow-hidden`, que recortaría un menú absoluto.
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Pencil, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";
import type { TablaAgenda } from "@/lib/agenda/columnas";
import type { AgendaActivityRow } from "@/server/agenda";
import type { CitaNota } from "@/server/agenda-notas";

interface CitaAccionesProps {
  row: AgendaActivityRow;
  tabla: TablaAgenda;
  onEditar: () => void;
}

const MENU_WIDTH = 160;

const nombre = (tabla: TablaAgenda) => (tabla === "reuniones" ? "reunión" : "llamada");

export function CitaAcciones({ row, tabla, onEditar }: CitaAccionesProps) {
  const [abierto, setAbierto] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const [modal, setModal] = React.useState<null | "notas" | "eliminar">(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  function abrir() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Que no se salga por la derecha en pantallas angostas.
    const left = Math.min(r.left, window.innerWidth - MENU_WIDTH - 8);
    setPos({ top: r.bottom + 4, left: Math.max(8, left) });
    setAbierto(true);
  }

  React.useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      cerrar();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cerrar();
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    // Con el menú fijo, un scroll lo dejaría flotando lejos de su fila: mejor cerrarlo.
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);

  function elegir(accion: "editar" | "notas" | "eliminar") {
    setAbierto(false);
    if (accion === "editar") onEditar();
    else setModal(accion);
  }

  const item =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/5 focus:bg-black/5 focus:outline-none";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        aria-label={`Acciones: ${row.subject}`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        title="Acciones"
        className="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--text-tertiary)] hover:bg-black/5"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>

      {abierto && pos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Acciones de la ${nombre(tabla)}`}
          className="fixed z-50 overflow-hidden rounded-lg py-1 shadow-lg"
          style={{
            top: pos.top,
            left: pos.left,
            width: MENU_WIDTH,
            background: "var(--bg-card, #fff)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <button type="button" role="menuitem" autoFocus onClick={() => elegir("editar")} className={item} style={{ color: "var(--text-primary)" }}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
          <button type="button" role="menuitem" onClick={() => elegir("notas")} className={item} style={{ color: "var(--text-primary)" }}>
            <FileText className="h-3.5 w-3.5" /> Notas
          </button>
          <button type="button" role="menuitem" onClick={() => elegir("eliminar")} className={item} style={{ color: "#DC2626" }}>
            <Trash2 className="h-3.5 w-3.5" /> Eliminar
          </button>
        </div>
      )}

      {modal === "notas" && <NotasCita row={row} tabla={tabla} onClose={() => setModal(null)} />}
      {modal === "eliminar" && <EliminarCita row={row} tabla={tabla} onClose={() => setModal(null)} />}
    </>
  );
}

/** Contenedor de modal compartido: fondo oscuro, Escape y clic fuera cierran salvo si `bloqueado`. */
function Modal({
  label,
  bloqueado,
  onClose,
  children,
}: {
  label: string;
  bloqueado: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !bloqueado && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, bloqueado]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !bloqueado && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-xl p-4 shadow-xl"
        style={{ background: "var(--bg-card, #fff)", border: "1px solid var(--border-subtle)" }}
      >
        {children}
      </div>
    </div>
  );
}

const FECHA_NOTA: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

function NotasCita({ row, tabla, onClose }: { row: AgendaActivityRow; tabla: TablaAgenda; onClose: () => void }) {
  const router = useRouter();
  const [notas, setNotas] = React.useState<CitaNota[] | null>(null);
  const [errorCarga, setErrorCarga] = React.useState<string | null>(null);
  const [texto, setTexto] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/agenda/citas/${row.id}/notas`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar las notas");
        if (!cancelado) setNotas(body.data as CitaNota[]);
      } catch (err) {
        if (!cancelado) setErrorCarga(err instanceof Error ? err.message : "No se pudieron cargar las notas");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [row.id]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    const limpio = texto.trim();
    if (!limpio || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agenda/citas/${row.id}/notas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto: limpio }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "No se pudo guardar la nota");
      setNotas((prev) => [body.data as CitaNota, ...(prev ?? [])]);
      setTexto("");
      // "Notas recientes" de la Agenda también muestra esta nota.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la nota");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal label={`Notas de la ${nombre(tabla)}`} bloqueado={saving} onClose={onClose}>
      <div>
        <h3 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Notas</h3>
        <p className="truncate text-[12px] text-[color:var(--text-tertiary)]">{row.subject}</p>
      </div>

      <form onSubmit={agregar} className="flex flex-col gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder={`Escribe una nota sobre esta ${nombre(tabla)}`}
          aria-label="Nueva nota"
          autoFocus
          className="resize-none rounded-md px-3 py-2 text-[13px]"
          style={{
            background: "var(--bg-input, transparent)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
          }}
        />
        {error && (
          <p role="alert" className="text-[12px]" style={{ color: "#DC2626" }}>
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!texto.trim() || saving}
            className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] font-semibold disabled:opacity-40"
            style={{ background: "var(--text-primary)", color: "var(--text-inverse, #fff)" }}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Agregar nota
          </button>
        </div>
      </form>

      <div className="min-h-0 flex-1 overflow-auto" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        {errorCarga ? (
          <p role="alert" className="py-3 text-[12px]" style={{ color: "#DC2626" }}>
            {errorCarga}
          </p>
        ) : notas === null ? (
          <p className="flex items-center gap-2 py-3 text-[12px] text-[color:var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando notas…
          </p>
        ) : notas.length === 0 ? (
          <p className="py-3 text-[12px] text-[color:var(--text-tertiary)]">Esta {nombre(tabla)} todavía no tiene notas.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {notas.map((n) => (
              <li key={n.id} className="py-2.5">
                <p className="whitespace-pre-wrap break-words text-[13px] text-[color:var(--text-primary)]">{n.texto}</p>
                <p className="mt-1 text-[11px] text-[color:var(--text-tertiary)]">
                  {formatDateTime(n.createdAt, FECHA_NOTA)}
                  {n.autor ? ` · ${n.autor}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
          style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

function EliminarCita({ row, tabla, onClose }: { row: AgendaActivityRow; tabla: TablaAgenda; onClose: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function eliminar() {
    setSaving(true);
    setError(null);
    try {
      // Borrado lógico (deletedAt) con el permiso por dueño/rol de deleteActivity.
      const res = await fetch(`/api/activities/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo eliminar");
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar");
      setSaving(false);
    }
  }

  return (
    <Modal label={`Eliminar ${nombre(tabla)}`} bloqueado={saving} onClose={onClose}>
      <h3 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Eliminar {nombre(tabla)}</h3>
      <p className="text-[13px] text-[color:var(--text-secondary)]">
        ¿Eliminar «{row.subject}»? Dejará de aparecer en tu agenda. Las notas que tenga no se borran.
      </p>
      {error && (
        <p role="alert" className="text-[12px]" style={{ color: "#DC2626" }}>
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          autoFocus
          className="rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
          style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={eliminar}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
          style={{ background: "#DC2626" }}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Eliminar
        </button>
      </div>
    </Modal>
  );
}
