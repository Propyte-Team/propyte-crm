// Panel «Leads huérfanos» (2026-10-12, entrega 3 de marcas, decisión 3). Lista lo que se puede
// estar perdiendo y deja asignarlo ahí mismo con el selector de asesor y la misma ruta de guardado
// que la ficha del contacto (PUT /api/contacts). Mismo lenguaje visual que Conexiones.
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdvisorSelect } from "@/components/shared/advisor-select";
import { BrandBadges } from "@/components/brands/brand-view";
import { formatDate } from "@/lib/format-date";
import { LEAD_SOURCE_LABELS } from "@/lib/constants";
import type { OrphanContactRow, OrphanConversationRow, OrphanLeads } from "@/server/orphan-leads";

const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", MESSENGER: "Messenger" };

function fecha(iso: string | null): string {
  return iso ? formatDate(iso, { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

function Section({
  title,
  hint,
  total,
  shown,
  children,
}: {
  title: string;
  hint: string;
  total: number;
  shown: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="flex items-baseline justify-between border-t border-foreground pt-2 text-[12px] font-semibold uppercase tracking-wide">
        <span>{title}</span>
        <span className="font-mono text-[11px] font-normal normal-case text-muted-foreground">{total}</span>
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

function ContactRow({
  row,
  currentUser,
  onError,
  showOwner,
}: {
  row: OrphanContactRow;
  currentUser: { id: string; name: string | null };
  onError: (msg: string | null) => void;
  showOwner: boolean;
}) {
  return (
    <div className="mt-1.5 rounded-md border p-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
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
}: {
  row: OrphanConversationRow;
  currentUser: { id: string; name: string | null };
  onError: (msg: string | null) => void;
}) {
  const cuenta = row.account
    ? `${CHANNEL_LABEL[row.account.channel] ?? row.account.channel} ${row.account.account}` +
      (row.account.account !== row.account.accountId ? ` (id ${row.account.accountId})` : "")
    : "cuenta sin registrar";
  return (
    <div className="mt-1.5 rounded-md border p-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
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

export function OrphanLeadsView({
  data,
  currentUser,
}: {
  data: OrphanLeads;
  currentUser: { id: string; name: string | null };
}) {
  const [error, setError] = useState<string | null>(null);

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

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive p-2 text-[12px] text-destructive">
          {error}
        </p>
      )}

      <Section
        title="Sin dueño"
        hint="Contactos sin asesor asignado, del más nuevo al más viejo."
        total={data.unowned.total}
        shown={data.unowned.rows.length}
      >
        {data.unowned.rows.map((r) => (
          <ContactRow key={r.id} row={r} currentUser={currentUser} onError={setError} showOwner={false} />
        ))}
      </Section>

      <Section
        title="Con dueño técnico"
        hint="Asignados a una cuenta interna o de pruebas (correo .local). El reparto ya no les da leads, pero estos se quedaron ahí sin seguimiento."
        total={data.technical.total}
        shown={data.technical.rows.length}
      >
        {data.technical.rows.map((r) => (
          <ContactRow key={r.id} row={r} currentUser={currentUser} onError={setError} showOwner />
        ))}
      </Section>

      <Section
        title="Llegaron a una cuenta sin registrar"
        hint="Conversaciones abiertas cuya última nota dice que el mensaje entró por un número o una cuenta que no está dada de alta en Conexiones. El agente no les contestó. Al cerrar la conversación o dejarle otra nota sale de aquí."
        total={data.unregistered.total}
        shown={data.unregistered.rows.length}
      >
        {data.unregistered.rows.map((r) => (
          <ConversationRow key={r.conversationId} row={r} currentUser={currentUser} onError={setError} />
        ))}
      </Section>
    </div>
  );
}
