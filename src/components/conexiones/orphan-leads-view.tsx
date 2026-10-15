// Panel «Leads huérfanos» (2026-10-12, entrega 3 de marcas, decisión 3). Lista lo que se puede
// estar perdiendo y deja asignarlo ahí mismo con el selector de asesor y la misma ruta de guardado
// que la ficha del contacto (PUT /api/contacts). Mismo lenguaje visual que Conexiones.
//
// Asignación masiva (2026-10-14, #883): casillas en los renglones huérfanos y una barra fija arriba
// para «Seleccionar todos → Asignar a…». Va por POST /api/contacts/asignar-huerfanos, que asigna
// cada contacto por el mismo camino que la bandeja y manda un solo aviso con el total.
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdvisorSelect } from "@/components/shared/advisor-select";
import { BrandBadges } from "@/components/brands/brand-view";
import { formatDate } from "@/lib/format-date";
import { LEAD_SOURCE_LABELS } from "@/lib/constants";
import type { OrphanAssignee, OrphanContactRow, OrphanConversationRow, OrphanLeads } from "@/server/orphan-leads";
import {
  contactosMarcables,
  enLotes,
  esMarcable,
  marcablesDe,
  resumenLote,
  sumarResultados,
  type ResultadoLoteCliente,
} from "./orphan-bulk";

const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", MESSENGER: "Messenger" };

function fecha(iso: string | null): string {
  return iso ? formatDate(iso, { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

function Section({
  title,
  hint,
  total,
  shown,
  seleccion,
  children,
}: {
  title: string;
  hint: string;
  total: number;
  shown: number;
  /** Marcar / desmarcar los renglones marcables de esta sección. Sin marcables, no se pinta. */
  seleccion?: { ids: string[]; selected: ReadonlySet<string>; onToggle: (ids: string[], on: boolean) => void };
  children: React.ReactNode;
}) {
  const todas = seleccion && seleccion.ids.length > 0 && seleccion.ids.every((id) => seleccion.selected.has(id));
  return (
    <section className="mb-8">
      <h2 className="flex items-baseline justify-between border-t border-foreground pt-2 text-[12px] font-semibold uppercase tracking-wide">
        <span>{title}</span>
        <span className="flex items-baseline gap-3">
          {seleccion && seleccion.ids.length > 0 && (
            <button
              type="button"
              className="text-[11px] font-normal normal-case underline"
              onClick={() => seleccion.onToggle(seleccion.ids, !todas)}
            >
              {todas ? "Quitar de la selección" : `Seleccionar los ${seleccion.ids.length}`}
            </button>
          )}
          <span className="font-mono text-[11px] font-normal normal-case text-muted-foreground">{total}</span>
        </span>
      </h2>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      {total === 0 ? (
        <p className="mt-2 rounded-md border border-dashed p-2 text-[12px] text-muted-foreground">Nada por aquí.</p>
      ) : (
        <>
          {children}
          {total > shown && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Mostrando {shown} de {total}, los más recientes.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Asignación rápida: el selector se carga solo al abrirlo (cada uno pide la lista de asesores). */
function QuickAssign({
  contactId,
  currentUser,
  onError,
}: {
  contactId: string;
  currentUser: { id: string; name: string | null };
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="text-[11px] underline" onClick={() => setOpen(true)}>
        Asignar
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <AdvisorSelect
        value={null}
        self={{ id: currentUser.id, name: currentUser.name, email: null }}
        onChange={async (assignedToId) => {
          if (!assignedToId) return;
          onError(null);
          try {
            const res = await fetch(`/api/contacts?id=${contactId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assignedToId }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              onError(typeof data.error === "string" ? data.error : "No se pudo asignar el contacto.");
              return;
            }
            setOpen(false);
            router.refresh();
          } catch {
            onError("Error de red al asignar el contacto.");
          }
        }}
      />
      <button className="text-[11px] underline" onClick={() => setOpen(false)}>
        Cancelar
      </button>
    </span>
  );
}

type Marca = { selected: ReadonlySet<string>; onToggle: (ids: string[], on: boolean) => void };

/** Casilla del renglón; solo en los marcables (ver esMarcable). La clave es el contacto. */
function Casilla({ contactId, name, marca }: { contactId: string; name: string; marca: Marca }) {
  return (
    <input
      type="checkbox"
      className="h-3.5 w-3.5 shrink-0 rounded border-input"
      aria-label={`Seleccionar ${name || "contacto sin nombre"}`}
      checked={marca.selected.has(contactId)}
      onChange={(e) => marca.onToggle([contactId], e.target.checked)}
    />
  );
}

function ContactRow({
  row,
  currentUser,
  onError,
  showOwner,
  marca,
}: {
  row: OrphanContactRow;
  currentUser: { id: string; name: string | null };
  onError: (msg: string | null) => void;
  showOwner: boolean;
  marca: Marca;
}) {
  return (
    <div className="mt-1.5 rounded-md border p-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {esMarcable(row.owner) && <Casilla contactId={row.id} name={row.name} marca={marca} />}
          <Link href={`/contacts/${row.id}`} className="truncate font-medium hover:underline">
            {row.name || "Sin nombre"}
          </Link>
          <BrandBadges brandIds={row.brandIds} />
        </span>
        <QuickAssign contactId={row.id} currentUser={currentUser} onError={onError} />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {LEAD_SOURCE_LABELS[row.leadSource] ?? row.leadSource} · alta {fecha(row.createdAt)} · último mensaje{" "}
        {fecha(row.lastMessageAt)}
        {showOwner && row.owner ? ` · dueño ${row.owner.email}` : ""}
      </p>
    </div>
  );
}

function ConversationRow({
  row,
  currentUser,
  onError,
  marca,
}: {
  row: OrphanConversationRow;
  currentUser: { id: string; name: string | null };
  onError: (msg: string | null) => void;
  marca: Marca;
}) {
  const cuenta = row.account
    ? `${CHANNEL_LABEL[row.account.channel] ?? row.account.channel} ${row.account.account}` +
      (row.account.account !== row.account.accountId ? ` (id ${row.account.accountId})` : "")
    : "cuenta sin registrar";
  return (
    <div className="mt-1.5 rounded-md border p-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {esMarcable(row.owner) && <Casilla contactId={row.contactId} name={row.name} marca={marca} />}
          <Link href={`/inbox?c=${row.conversationId}`} className="truncate font-medium hover:underline">
            {row.name || "Sin nombre"}
          </Link>
          <BrandBadges brandIds={row.brandIds} />
          {!row.owner && (
            <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground">Sin asignar</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <Link href={`/contacts/${row.contactId}`} className="text-[11px] underline">
            Ficha
          </Link>
          <QuickAssign contactId={row.contactId} currentUser={currentUser} onError={onError} />
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Llegó a <span className="font-mono">{cuenta}</span> · {LEAD_SOURCE_LABELS[row.leadSource] ?? row.leadSource} · alta{" "}
        {fecha(row.createdAt)} · último mensaje {fecha(row.lastMessageAt)}
      </p>
    </div>
  );
}

/**
 * Barra de la asignación masiva. Fija arriba para que el botón quede a la vista mientras se baja
 * por la lista. Pide confirmar con la cifra y el nombre antes de mandar: con 111 prospectos, un
 * clic de más no se deshace con otro clic.
 */
function BulkAssignBar({
  marcables,
  selected,
  onSelectAll,
  onClear,
  assignees,
  currentUser,
  maxPorLote,
  onDone,
  onError,
}: {
  marcables: number;
  selected: ReadonlySet<string>;
  onSelectAll: () => void;
  onClear: () => void;
  assignees: OrphanAssignee[];
  currentUser: { id: string; name: string | null };
  maxPorLote: number;
  onDone: (mensaje: string) => void;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  // Por defecto, quien mira, si puede recibir prospectos: el caso que lo pidió es tomarlos uno mismo.
  const yo = assignees.find((a) => a.id === currentUser.id);
  const [target, setTarget] = useState<string>(yo?.id ?? "");
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = selected.size;
  const destino = assignees.find((a) => a.id === target);
  const nombreDestino = destino ? (destino.id === currentUser.id ? "ti" : destino.name) : "";
  const opciones = yo ? [yo, ...assignees.filter((a) => a.id !== yo.id)] : assignees;

  async function asignar() {
    if (!destino || n === 0) return;
    setBusy(true);
    onError(null);
    const partes: ResultadoLoteCliente[] = [];
    try {
      // Más que el tope → varias peticiones en serie (el servidor también lo exige).
      for (const lote of enLotes([...selected], maxPorLote)) {
        const res = await fetch("/api/contacts/asignar-huerfanos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactIds: lote, assigneeId: destino.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          onError(typeof json.error === "string" ? json.error : "No se pudo asignar.");
          break;
        }
        partes.push(json.data as ResultadoLoteCliente);
      }
    } catch {
      onError("Error de red al asignar. Lo que alcanzó a guardarse ya quedó asignado.");
    } finally {
      setBusy(false);
      setConfirmando(false);
    }
    if (partes.length > 0) {
      onDone(resumenLote(sumarResultados(partes), nombreDestino));
      router.refresh();
    }
  }

  if (marcables === 0) return null;
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-6 border-y bg-background px-4 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-input"
            checked={n > 0 && n >= marcables}
            ref={(el) => {
              if (el) el.indeterminate = n > 0 && n < marcables;
            }}
            onChange={(e) => (e.target.checked ? onSelectAll() : onClear())}
            disabled={busy}
          />
          <span>{n === 0 ? `Seleccionar todos (${marcables})` : `${n} de ${marcables} seleccionados`}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Asignar a</span>
          <select
            className="form-input max-w-[220px] text-[13px]"
            value={target}
            disabled={busy}
            onChange={(e) => {
              setTarget(e.target.value);
              setConfirmando(false);
            }}
          >
            <option value="" disabled>
              Elegir persona…
            </option>
            {opciones.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === currentUser.id ? `${a.name} (yo)` : a.name}
              </option>
            ))}
          </select>
        </label>
        {!confirmando ? (
          <button
            type="button"
            className="rounded-md border border-foreground px-2 py-1 font-medium disabled:opacity-40"
            disabled={busy || n === 0 || !destino}
            onClick={() => setConfirmando(true)}
          >
            {n > 0 ? `Asignar ${n}` : "Asignar"}
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <span>
              ¿Asignar {n === 1 ? "1 prospecto" : `${n} prospectos`} a {nombreDestino}?
            </span>
            <button
              type="button"
              className="rounded-md bg-foreground px-2 py-1 font-medium text-background disabled:opacity-40"
              disabled={busy}
              onClick={asignar}
            >
              {busy ? "Asignando…" : "Sí, asignar"}
            </button>
            <button type="button" className="underline" disabled={busy} onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export function OrphanLeadsView({
  data,
  currentUser,
  assignees,
  maxPorLote,
}: {
  data: OrphanLeads;
  currentUser: { id: string; name: string | null };
  assignees: OrphanAssignee[];
  maxPorLote: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const marcables = useMemo(() => contactosMarcables(data), [data]);
  // Tras asignar, la página se recarga y los asignados salen de la lista: la selección se queda
  // solo con lo que sigue listado (así no se manda de nuevo lo que ya no está a la vista).
  const seleccion = useMemo(() => {
    const listados = new Set(marcables);
    return new Set([...selected].filter((id) => listados.has(id)));
  }, [selected, marcables]);

  const onToggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const marca: Marca = { selected: seleccion, onToggle };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <Link href="/conexiones" className="hover:underline">
            Conexiones
          </Link>
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight">Leads huérfanos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prospectos que se pueden estar perdiendo. Solo ves los de las marcas que tienes prendidas.
        </p>
      </header>

      <BulkAssignBar
        marcables={marcables.length}
        selected={seleccion}
        onSelectAll={() => setSelected(new Set(marcables))}
        onClear={() => setSelected(new Set())}
        assignees={assignees}
        currentUser={currentUser}
        maxPorLote={maxPorLote}
        onDone={(mensaje) => {
          setAviso(mensaje);
          setSelected(new Set());
        }}
        onError={setError}
      />

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive p-2 text-[12px] text-destructive">
          {error}
        </p>
      )}
      {aviso && (
        <p role="status" className="mb-4 rounded-md border p-2 text-[12px]">
          {aviso}
        </p>
      )}

      <Section
        title="Sin dueño"
        hint="Contactos sin asesor asignado, del más nuevo al más viejo."
        total={data.unowned.total}
        shown={data.unowned.rows.length}
        seleccion={{ ids: marcablesDe(data.unowned.rows, (r) => r.id), selected: seleccion, onToggle }}
      >
        {data.unowned.rows.map((r) => (
          <ContactRow key={r.id} row={r} currentUser={currentUser} onError={setError} showOwner={false} marca={marca} />
        ))}
      </Section>

      <Section
        title="Con dueño técnico"
        hint="Asignados a una cuenta interna o de pruebas (correo .local). El reparto ya no les da leads, pero estos se quedaron ahí sin seguimiento."
        total={data.technical.total}
        shown={data.technical.rows.length}
        seleccion={{ ids: marcablesDe(data.technical.rows, (r) => r.id), selected: seleccion, onToggle }}
      >
        {data.technical.rows.map((r) => (
          <ContactRow key={r.id} row={r} currentUser={currentUser} onError={setError} showOwner marca={marca} />
        ))}
      </Section>

      <Section
        title="Llegaron a una cuenta sin registrar"
        hint="Conversaciones abiertas cuya última nota dice que el mensaje entró por un número o una cuenta que no está dada de alta en Conexiones. El agente no les contestó. Al cerrar la conversación o dejarle otra nota sale de aquí."
        total={data.unregistered.total}
        shown={data.unregistered.rows.length}
        seleccion={{ ids: marcablesDe(data.unregistered.rows, (r) => r.contactId), selected: seleccion, onToggle }}
      >
        {data.unregistered.rows.map((r) => (
          <ConversationRow key={r.conversationId} row={r} currentUser={currentUser} onError={setError} marca={marca} />
        ))}
      </Section>
    </div>
  );
}
