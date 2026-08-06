// Control de asignación del hilo (Anexo B §I.6) — chip + menú para mando, "Reclamar"
// para el asesor. Minimalista B/N: sin color, solo badge-neutral y btn-secondary.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { canOwnInboxContact, isInboxManager } from "@/lib/inbox/roles";

/** Shape real de GET /api/users?basic=true → { data: [...] } */
interface BasicUser {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface AssignControlProps {
  assignedTo: { id: string; name: string } | null;
  userId: string;
  userRole: string;
  onAssign: (assigneeId: string | null) => Promise<void>;
}

export function AssignControl({ assignedTo, userId, userRole, onAssign }: AssignControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<BasicUser[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  // Cierre por click fuera / Escape. Los listeners solo viven mientras el menú
  // está abierto: nada que hacer si el control es un chip informativo.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Carga perezosa: una sola vez, al abrir el menú. Si falla se libera el flag
  // para poder reintentar al reabrir.
  const loadUsers = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoadError(false);
    try {
      const res = await fetch("/api/users?basic=true&isActive=true");
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data?: BasicUser[] };
      // El backend rechaza (422) a quien no puede ser dueño de un contacto:
      // filtramos con la misma regla para no ofrecer opciones que siempre fallan.
      setUsers((json.data ?? []).filter((u) => canOwnInboxContact(u.role)));
    } catch {
      fetchedRef.current = false;
      setLoadError(true);
    }
  }, []);

  async function run(assigneeId: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      await onAssign(assigneeId);
      setOpen(false);
    } catch {
      // El llamador ya reporta el error; el menú queda abierto para reintentar.
    } finally {
      setBusy(false);
    }
  }

  // ── No mando: sin menú ──
  if (!isInboxManager(userRole)) {
    if (assignedTo) {
      return (
        <span className="badge badge-neutral" title={`Contacto asignado a ${assignedTo.name}`}>
          {assignedTo.id === userId ? "Asignado a ti" : `Asignado a ${assignedTo.name}`}
        </span>
      );
    }
    // Quien no puede ser dueño (hostess, marketing…) solo ve el estado.
    if (!canOwnInboxContact(userRole)) {
      return <span className="badge badge-neutral">Sin asignar</span>;
    }
    return (
      <button
        type="button"
        className="btn-secondary !py-1.5 !px-3 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-teal)]"
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1 }}
        title="Reclamar este hilo: el contacto queda asignado a ti"
        onClick={() => run(userId)}
      >
        <UserPlus className="h-3.5 w-3.5" /> Reclamar
      </button>
    );
  }

  // ── Mando: chip-botón + menú ──
  function toggleMenu() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void loadUsers();
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="btn-secondary !py-1.5 !px-3 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-teal)]"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1 }}
        title="Cambiar la asignación de este contacto"
        onClick={toggleMenu}
      >
        <span className="max-w-[160px] truncate">
          {assignedTo ? `Asignado a ${assignedTo.name}` : "Sin asignar"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Asignar conversación"
          className="absolute right-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg shadow-lg"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
        >
          {loadError ? (
            <p className="px-3 py-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              No se pudieron cargar los usuarios
            </p>
          ) : users === null ? (
            <p className="px-3 py-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              Cargando…
            </p>
          ) : users.length === 0 ? (
            <p className="px-3 py-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              Sin usuarios disponibles
            </p>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                type="button"
                role="menuitem"
                className={cn(
                  "block w-full truncate px-3 py-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-teal)]",
                  u.id === assignedTo?.id && "font-semibold"
                )}
                style={{
                  color: "var(--text-primary)",
                  background: u.id === assignedTo?.id ? "var(--color-teal-light)" : "transparent",
                }}
                disabled={busy}
                onClick={() => run(u.id)}
              >
                {u.name}
                {u.id === userId && (
                  <span className="ml-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    (tú)
                  </span>
                )}
              </button>
            ))
          )}

          {assignedTo && (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-teal)]"
              style={{ color: "var(--text-secondary)", borderTop: "1px solid var(--border-subtle)" }}
              disabled={busy}
              onClick={() => run(null)}
            >
              Quitar asignación
            </button>
          )}
        </div>
      )}
    </div>
  );
}
