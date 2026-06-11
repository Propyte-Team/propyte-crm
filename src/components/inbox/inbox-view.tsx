// Inbox estilo WhatsApp Web — 3 paneles (Anexo B §I.6), minimalista B/N.
// Polling 5s (MVP); color solo en badges con significado (estado/temperatura).
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bot, User, Search, Send, StickyNote, Power, RotateCcw, X, DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/constants";

interface ConversationListItem {
  id: string;
  status: "BOT" | "HUMAN" | "SNOOZED" | "CLOSED";
  botEnabled: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  aiSummary: string | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    temperature: string;
    score: number;
    assignedTo: { id: string; name: string } | null;
  };
  controlledBy: { id: string; name: string } | null;
  messages: Array<{ body: string; createdAt: string; sender: string }>;
}

interface ThreadMessage {
  id: string;
  body: string;
  direction: "INBOUND" | "OUTBOUND";
  sender: "CONTACT" | "ADVISOR" | "BOT" | "SYSTEM";
  internalNote: boolean;
  aiGenerated: boolean;
  createdAt: string;
}

interface ThreadDetail extends Omit<ConversationListItem, "messages"> {
  messages: ThreadMessage[];
  contact: ConversationListItem["contact"] & {
    email: string | null;
    preferredLanguage: string;
    budgetMin: string | null;
    budgetMax: string | null;
    preferredZone: string | null;
    whatsappOptOut: boolean;
    deals: Array<{ id: string; stage: string; estimatedValue: string; dealType: string }>;
  };
}

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "mine", label: "Mías" },
  { key: "bot", label: "Bot" },
  { key: "human", label: "Humanas" },
  { key: "unread", label: "No leídas" },
] as const;

const TEMP_CLASS: Record<string, string> = {
  HOT: "badge-hot",
  WARM: "badge-warm",
  COLD: "badge-cold",
  DEAD: "badge-neutral",
};

export function InboxView({ userId }: { userId: string; userRole: string }) {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("c"));
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [composer, setComposer] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations?filter=${filter}&q=${encodeURIComponent(search)}`);
      if (res.ok) setList((await res.json()).data ?? []);
    } catch { /* polling: silencioso */ }
  }, [filter, search]);

  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (res.ok) {
        setThread((await res.json()).data);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 50);
      }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selectedId) loadThread(selectedId); }, [selectedId, loadThread]);

  // Polling 5s — lista + hilo abierto
  useEffect(() => {
    const t = setInterval(() => {
      loadList();
      if (selectedId) loadThread(selectedId);
    }, 5000);
    return () => clearInterval(t);
  }, [loadList, loadThread, selectedId]);

  async function doAction(action: string) {
    if (!selectedId) return;
    const res = await fetch(`/api/conversations/${selectedId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      await loadThread(selectedId);
      await loadList();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Error");
    }
  }

  async function sendMessage() {
    if (!selectedId || !composer.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: composer.trim(), internalNote: asNote }),
      });
      if (res.ok) {
        setComposer("");
        setAsNote(false);
        await loadThread(selectedId);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Error al enviar");
      }
    } finally {
      setSending(false);
    }
  }

  const isHuman = thread?.status === "HUMAN";
  const iControl = thread?.controlledBy?.id === userId;

  return (
    <div className="flex h-[calc(100vh-3rem)] -m-6 overflow-hidden" style={{ background: "var(--bg-base)" }}>
      {/* ── Panel 1: lista ── */}
      <div className="flex w-[320px] shrink-0 flex-col" style={{ borderRight: "1px solid var(--border-subtle)", background: "var(--bg-sidebar)" }}>
        <div className="p-3 space-y-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <h1 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Inbox</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
            <input
              className="form-input pl-8 py-1.5 text-[13px]"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={{
                  background: filter === f.key ? "var(--color-teal)" : "var(--bg-badge-neutral)",
                  color: filter === f.key ? "var(--text-inverse)" : "var(--text-secondary)",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.length === 0 && (
            <p className="p-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              Sin conversaciones
            </p>
          )}
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="w-full px-3 py-2.5 text-left transition-colors"
              style={{
                background: selectedId === c.id ? "var(--color-teal-light)" : "transparent",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {c.contact.firstName} {c.contact.lastName}
                </span>
                <span className="flex items-center gap-1">
                  {c.status === "BOT" ? (
                    <Bot className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
                  ) : (
                    <User className="h-3.5 w-3.5" style={{ color: "var(--text-primary)" }} />
                  )}
                  {c.unreadCount > 0 && (
                    <span
                      className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                      style={{ background: "var(--color-teal)", color: "var(--text-inverse)" }}
                    >
                      {c.unreadCount}
                    </span>
                  )}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                {c.messages[0]?.body ?? "—"}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Panel 2: hilo ── */}
      <div className="flex flex-1 flex-col min-w-0">
        {!thread ? (
          <div className="flex flex-1 items-center justify-center text-sm" style={{ color: "var(--text-tertiary)" }}>
            Selecciona una conversación
          </div>
        ) : (
          <>
            {/* Banda de estado */}
            <div
              className="flex items-center justify-between gap-2 px-4 py-2"
              style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {thread.contact.firstName} {thread.contact.lastName}
                </span>
                <span className={cn("badge", thread.status === "BOT" ? "badge-neutral" : "badge-teal")}>
                  {thread.status === "BOT" ? "🤖 Bot activo" : isHuman && iControl ? "Controlas tú" : `Controla ${thread.controlledBy?.name ?? "—"}`}
                </span>
                {thread.contact.whatsappOptOut && <span className="badge badge-error">Opt-out</span>}
              </div>
              <div className="flex items-center gap-1.5">
                {thread.status === "BOT" ? (
                  <button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => doAction("takeover")}>
                    <User className="h-3.5 w-3.5" /> Tomar control
                  </button>
                ) : (
                  <button className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={() => doAction("release")}>
                    <RotateCcw className="h-3.5 w-3.5" /> Devolver al bot
                  </button>
                )}
                <button
                  className="btn-secondary !py-1.5 !px-2 text-[12px]"
                  title={thread.botEnabled ? "Apagar bot en este hilo" : "Encender bot"}
                  onClick={() => doAction("toggle_bot")}
                >
                  <Power className="h-3.5 w-3.5" style={{ color: thread.botEnabled ? "var(--color-success)" : "var(--text-tertiary)" }} />
                </button>
                <button className="btn-secondary !py-1.5 !px-2 text-[12px]" title="Cerrar conversación" onClick={() => doAction("close")}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Resumen IA tras takeover */}
            {thread.aiSummary && isHuman && (
              <div className="px-4 py-2 text-[12px]" style={{ background: "var(--color-teal-light)", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" }}>
                <strong>Resumen del bot:</strong> {thread.aiSummary}
              </div>
            )}

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {thread.messages.map((m) => {
                const inbound = m.direction === "INBOUND";
                return (
                  <div key={m.id} className={cn("flex", inbound ? "justify-start" : "justify-end")}>
                    <div
                      className="max-w-[70%] rounded-xl px-3 py-2 text-[13px] leading-relaxed"
                      style={
                        m.internalNote
                          ? { background: "var(--color-warning-bg)", color: "var(--text-primary)", border: "1px dashed var(--color-warning)" }
                          : inbound
                          ? { background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }
                          : { background: "var(--color-teal)", color: "var(--text-inverse)" }
                      }
                    >
                      {m.internalNote && (
                        <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-warning)" }}>
                          <StickyNote className="h-3 w-3" /> Nota interna
                        </span>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className="mt-1 text-[10px] opacity-60">
                        {m.sender === "BOT" ? "🤖 Bot · " : ""}
                        {new Date(m.createdAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div className="flex items-end gap-2 p-3" style={{ background: "var(--bg-sidebar)", borderTop: "1px solid var(--border-subtle)" }}>
              <button
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors"
                title={asNote ? "Modo nota interna (no se envía)" : "Cambiar a nota interna"}
                onClick={() => setAsNote(!asNote)}
                style={{
                  background: asNote ? "var(--color-warning-bg)" : "var(--bg-badge-neutral)",
                  color: asNote ? "var(--color-warning)" : "var(--text-tertiary)",
                }}
              >
                <StickyNote className="h-4 w-4" />
              </button>
              <textarea
                className="form-input flex-1 resize-none !py-2 text-[13px]"
                rows={1}
                placeholder={asNote ? "Nota interna (solo el equipo la ve)..." : "Escribe un mensaje..."}
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <button
                className="btn-primary !py-2 !px-3"
                disabled={sending || !composer.trim()}
                onClick={sendMessage}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Panel 3: contexto ── */}
      {thread && (
        <div className="hidden w-[260px] shrink-0 flex-col gap-3 overflow-y-auto p-3 xl:flex" style={{ borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-sidebar)" }}>
          <div className="crm-card !p-3 space-y-1.5">
            <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {thread.contact.firstName} {thread.contact.lastName}
            </p>
            <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{thread.contact.phone}</p>
            {thread.contact.email && (
              <p className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>{thread.contact.email}</p>
            )}
            <div className="flex gap-1.5 pt-1">
              <span className={cn("badge", TEMP_CLASS[thread.contact.temperature] ?? "badge-neutral")}>
                {thread.contact.temperature}
              </span>
              <span className="badge badge-neutral">Score {thread.contact.score}</span>
            </div>
            {(thread.contact.budgetMin || thread.contact.budgetMax) && (
              <p className="text-[12px] pt-1" style={{ color: "var(--text-secondary)" }}>
                Presupuesto: {thread.contact.budgetMin ? formatCurrency(Number(thread.contact.budgetMin)) : "?"} – {thread.contact.budgetMax ? formatCurrency(Number(thread.contact.budgetMax)) : "?"}
              </p>
            )}
            {thread.contact.preferredZone && (
              <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Zona: {thread.contact.preferredZone}</p>
            )}
            <a
              href={`/contacts/${thread.contact.id}`}
              className="block pt-1 text-[12px] font-medium hover:underline"
              style={{ color: "var(--color-teal)" }}
            >
              Ver contacto →
            </a>
          </div>

          {thread.contact.deals.length > 0 && (
            <div className="crm-card !p-3 space-y-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
                Deals activos
              </p>
              {thread.contact.deals.map((d) => (
                <a key={d.id} href={`/pipeline/${d.id}`} className="flex items-center justify-between gap-2 text-[12px] hover:underline" style={{ color: "var(--text-primary)" }}>
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
                    {formatCurrency(Number(d.estimatedValue))}
                  </span>
                  <span className="badge badge-neutral">{d.stage}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
