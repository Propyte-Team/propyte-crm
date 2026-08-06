// Inbox estilo WhatsApp Web — 3 paneles (Anexo B §I.6), minimalista B/N.
// Polling 5s (MVP); color solo en badges con significado (estado/temperatura).
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bot, User, Search, Send, StickyNote, Power, RotateCcw, X, DollarSign, Paperclip, FileText, Zap, ShieldBan,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/constants";
import { isMediaAllowed, mediaTypeFromMime, type ChatMediaType } from "@/lib/messaging/media";
import { fillTemplate, contactTemplateVars } from "@/lib/templates/fill";
import { canMarkSpam } from "@/lib/moderation/roles";
import { AssignControl } from "./assign-control";

interface ConversationListItem {
  id: string;
  status: "BOT" | "HUMAN" | "SNOOZED" | "CLOSED";
  botEnabled: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  aiSummary: string | null;
  channel: string;
  connector: { name: string; brand: string | null } | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    temperature: string;
    score: number;
    avatarUrl: string | null;
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
  mediaUrl: string | null;
  mediaType: string | null;
  mediaFilename: string | null;
}

interface PendingMedia {
  path: string;
  type: ChatMediaType;
  filename: string;
  mimeType: string;
  previewUrl: string | null;
}

interface InboxTemplate {
  id: string;
  name: string;
  shortcut: string | null;
  body: string;
  channel: string;
  isActive: boolean;
  isGlobal: boolean;
}

/** Normaliza para búsqueda acento-insensible. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Token "/algo" inmediatamente antes del caret (para autocomplete de plantillas). */
function slashTokenBefore(text: string): { query: string; start: number } | null {
  const m = text.match(/(^|\s)\/([^\s/]*)$/);
  if (!m) return null;
  return { query: m[2], start: text.length - m[2].length - 1 };
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

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  WEB: "Web",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
};

/** "Messenger · Nativa tulum" — canal + cuenta/marca del conector si existe. */
function channelAccountLabel(channel: string, connector: { name: string; brand: string | null } | null): string {
  const base = CHANNEL_LABEL[channel] ?? channel;
  return connector ? `${base} · ${connector.brand ?? connector.name}` : base;
}

/** Adjunto dentro de la burbuja del mensaje, según su tipo. */
function MessageMedia({ url, type, filename }: { url: string; type: string | null; filename: string | null }) {
  if (type === "image" || type === "gif" || type === "sticker") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed URL de Supabase / CDN Meta
      <img
        src={url}
        alt={filename ?? type ?? "imagen"}
        className={cn("mb-1 cursor-pointer rounded-lg object-contain", type === "sticker" ? "max-h-28" : "max-h-60 max-w-full")}
        onClick={() => window.open(url, "_blank", "noopener")}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }
  if (type === "audio") return <audio controls src={url} className="mb-1 max-w-full" preload="metadata" />;
  if (type === "video") return <video controls src={url} className="mb-1 max-h-60 max-w-full rounded-lg" preload="metadata" />;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex items-center gap-1.5 text-[13px] font-medium underline underline-offset-2"
    >
      <FileText className="h-4 w-4 shrink-0" /> {filename ?? "Documento"}
    </a>
  );
}

/** true si el body es solo el placeholder del adjunto ("[Imagen]", "[Documento: x]"...) */
function isMediaPlaceholder(body: string): boolean {
  return /^\[(Imagen|GIF|Audio|Video|Sticker|Documento[^\]]*|Adjunto)\]$/.test(body.trim());
}

const ACCEPT_BY_CHANNEL: Record<string, string> = {
  WHATSAPP: "image/jpeg,image/png,image/webp,audio/*,application/pdf",
  MESSENGER: "image/*,audio/*,video/mp4,application/pdf",
  INSTAGRAM: "image/*,audio/*,video/mp4",
};

/** Avatar del contacto (se oculta solo si la URL de CDN de Meta ya expiró). */
function ContactAvatar({ url, size }: { url: string | null; size: number }) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo de Meta, fuera de remotePatterns
    <img
      src={url}
      alt=""
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
    />
  );
}

export function InboxView({ userId, userRole }: { userId: string; userRole: string }) {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("c"));
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [composer, setComposer] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState<InboxTemplate[]>([]);
  const [tplQuery, setTplQuery] = useState<string | null>(null); // null = dropdown cerrado
  const [tplIndex, setTplIndex] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Último thread.id cargado con éxito. loadThread es un useCallback con deps [] (para
  // no reventar los efectos de polling que dependen de su identidad), así que no puede
  // leer `thread` del closure sin quedarse con el valor de la primera render — este ref
  // sí se mantiene al día vía el effect de abajo.
  const threadIdRef = useRef<string | null>(null);

  // Plantillas de chat (las WHATSAPP sirven igual en IG/Messenger; EMAIL fuera por subject)
  useEffect(() => {
    fetch("/api/profile/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data) setTemplates((j.data as InboxTemplate[]).filter((t) => t.isActive && t.channel === "WHATSAPP"));
      })
      .catch(() => {});
  }, []);

  const tplMatches =
    tplQuery === null
      ? []
      : templates.filter((t) => {
          if (!tplQuery) return true;
          const q = norm(tplQuery);
          const sc = norm(t.shortcut ?? "").replace(/^\//, "");
          return sc.startsWith(q) || norm(t.name).includes(q);
        });

  function insertTemplate(t: InboxTemplate) {
    const ta = composerRef.current;
    const caret = ta?.selectionStart ?? composer.length;
    const before = composer.slice(0, caret);
    const after = composer.slice(caret);
    const token = slashTokenBefore(before);
    const filled = fillTemplate(t.body, contactTemplateVars(thread?.contact ?? {}));
    const next = (token ? before.slice(0, token.start) : before) + filled + after;
    setComposer(next);
    setTplQuery(null);
    fetch("/api/profile/templates/use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id }),
    }).catch(() => {});
    setTimeout(() => ta?.focus(), 0);
  }

  function onComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setComposer(v);
    const token = slashTokenBefore(v.slice(0, e.target.selectionStart ?? v.length));
    setTplQuery(token ? token.query : null);
    setTplIndex(0);
  }

  function clearPendingMedia() {
    setPendingMedia((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function attachFile(file: File) {
    if (!thread) return;
    const channel = thread.channel;
    const type = mediaTypeFromMime(file.type || "application/octet-stream", channel);
    if (!isMediaAllowed(channel, type, file.size)) {
      alert(`Este canal (${CHANNEL_LABEL[channel] ?? channel}) no acepta ${type} de ${(file.size / 1024 / 1024).toFixed(1)}MB`);
      return;
    }
    setUploading(true);
    try {
      const signRes = await fetch("/api/inbox/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: file.type || "application/octet-stream", sizeBytes: file.size, channel, filename: file.name }),
      });
      if (!signRes.ok) {
        const data = await signRes.json().catch(() => ({}));
        alert(typeof data.error === "string" ? data.error : "No se pudo preparar la subida");
        return;
      }
      const { data } = await signRes.json();
      // subida DIRECTA a Supabase Storage (no pasa por el server del CRM)
      const putRes = await fetch(data.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) {
        alert("Falló la subida del archivo");
        return;
      }
      clearPendingMedia();
      const isVisual = data.type === "image" || data.type === "gif" || data.type === "sticker";
      setPendingMedia({
        path: data.path,
        type: data.type,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        previewUrl: isVisual ? URL.createObjectURL(file) : null,
      });
    } finally {
      setUploading(false);
    }
  }

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations?filter=${filter}&q=${encodeURIComponent(search)}`);
      if (res.ok) setList((await res.json()).data ?? []);
    } catch { /* polling: silencioso */ }
  }, [filter, search]);

  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      // 404 = perdimos el alcance sobre el hilo (lo asignaron a otro, lo cerraron, o nos
      // lo reasignaron por debajo). Sin esto el panel se quedaba con el hilo viejo — que
      // la lista ya no muestra — y el polling de 5s seguía 404eando para siempre.
      if (res.status === 404) {
        // Avisar solo si HABÍA un hilo cargado con este mismo id (threadIdRef, no el
        // `thread` de más arriba: closure de deps [] se congelaría en null). Así no se
        // dispara desde el polling de forma repetida: en cuanto se limpia el panel,
        // selectedId pasa a null y el siguiente tick ya no vuelve a llamar loadThread
        // para este id.
        if (threadIdRef.current === id) {
          alert("Ya no tienes acceso a esta conversación (se asignó a otra persona)");
        }
        setThread(null);
        setSelectedId(null);
        return;
      }
      if (res.ok) {
        setThread((await res.json()).data);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 50);
      }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { threadIdRef.current = thread?.id ?? null; }, [thread]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    clearPendingMedia(); // el adjunto pendiente pertenece al hilo anterior
    setTplQuery(null);
    if (selectedId) loadThread(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loadThread]);

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

  /**
   * assigneeId: string = asignar/reclamar · null = quitar asignación.
   * El try/catch no es decorativo: AssignControl deja su menú abierto para reintentar
   * cuando esto falla, así que un fetch rechazado (offline, DNS, abort) tiene que avisar
   * igual que un !res.ok — si no, el usuario ve el menú abierto y ningún error.
   */
  async function doAssign(assigneeId: string | null) {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/conversations/${selectedId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", assigneeId }),
      });
      if (res.ok) {
        await loadThread(selectedId);
        await loadList();
      } else if (res.status === 404) {
        // Mismo criterio que el envío: el 404 del server es opaco a propósito; loadThread
        // traduce "fuera de alcance" a un aviso humano y limpia el panel.
        await loadThread(selectedId);
        await loadList();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(typeof data.error === "string" ? data.error : "No se pudo cambiar la asignación");
      }
    } catch {
      alert("No se pudo asignar");
    }
  }

  async function markSpam() {
    if (!selectedId || !thread) return;
    const nombre = `${thread.contact.firstName} ${thread.contact.lastName}`.trim();
    const ok = confirm(
      `¿Marcar como spam la conversación con ${nombre}?\n\n` +
        `• Se bloquea a esta persona en Meta: no podrá escribirte ni ver tu perfil, publicaciones ni historias.\n` +
        `• La conversación se archiva y el bot deja de responderle.\n` +
        `• El contacto se da de baja y sus datos personales se borran.\n\n` +
        `Los datos personales NO se pueden recuperar. El bloqueo sí se puede deshacer.`
    );
    if (!ok) return;

    const res = await fetch(`/api/conversations/${selectedId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_spam" }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error ?? "No se pudo marcar como spam");
      return;
    }
    // El CRM ya está limpio aunque Meta haya fallado: se avisa sin dar marcha atrás.
    if (data.data?.meta?.blockStatus === "FAILED") {
      alert(
        `Limpiado en el CRM, pero Meta rechazó el bloqueo:\n\n${data.data.meta.error}\n\n` +
          `Esta persona ya no puede volver a entrar al CRM. Puedes reintentar el bloqueo desde Admin.`
      );
    }
    setSelectedId(null);
    await loadList();
  }

  async function sendMessage() {
    const media = asNote ? null : pendingMedia;
    if (!selectedId || (!composer.trim() && !media) || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: composer.trim(),
          internalNote: asNote,
          ...(media ? { media: { path: media.path, type: media.type, filename: media.filename, mimeType: media.mimeType } } : {}),
        }),
      });
      if (res.ok) {
        setComposer("");
        setAsNote(false);
        clearPendingMedia();
        await loadThread(selectedId);
        // El envío puede disparar auto-claim (POST .../messages en el server); sin
        // refrescar la lista, el badge "Sin asignar" del listado queda obsoleto hasta
        // el próximo poll de 5s.
        await loadList();
      } else if (res.status === 404) {
        // El server unificó en 404 todo lo que está fuera de alcance, así que su cuerpo
        // ("No existe") no dice nada útil a propósito. loadThread ya sabe reaccionar:
        // avisa con lenguaje humano y limpia el panel en vez de mostrar ese literal.
        await loadThread(selectedId);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(typeof data.error === "string" ? data.error : "Error al enviar");
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
          <select
            className="form-input !py-1 text-[11px]"
            aria-label="Filtrar por canal"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
          >
            <option value="all">Todos los canales</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="MESSENGER">Messenger</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.length === 0 && (
            <p className="p-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              Sin conversaciones
            </p>
          )}
          {list.filter((c) => channelFilter === "all" || c.channel === channelFilter).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="w-full px-3 py-2.5 text-left transition-colors"
              style={{
                background: selectedId === c.id ? "var(--color-teal-light)" : "transparent",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div className="flex items-center gap-2">
                <ContactAvatar url={c.contact.avatarUrl} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="truncate text-[13px] font-semibold"
                      style={{ color: "var(--text-primary)" }}
                      title={`${c.contact.firstName} ${c.contact.lastName}`}
                    >
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
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="badge badge-neutral !text-[10px] !py-0 whitespace-nowrap">
                      {channelAccountLabel(c.channel, c.connector)}
                    </span>
                    {!c.contact.assignedTo && (
                      <span className="badge badge-neutral !text-[10px] !py-0 shrink-0 whitespace-nowrap">
                        Sin asignar
                      </span>
                    )}
                    <p className="truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                      {c.messages[0]?.body ?? "—"}
                    </p>
                  </div>
                </div>
              </div>
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
                <ContactAvatar url={thread.contact.avatarUrl} size={24} />
                <span className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {thread.contact.firstName} {thread.contact.lastName}
                </span>
                <span className="badge badge-neutral whitespace-nowrap">
                  {channelAccountLabel(thread.channel, thread.connector)}
                </span>
                <span className={cn("badge", thread.status === "BOT" ? "badge-neutral" : "badge-teal")}>
                  {thread.status === "BOT" ? "🤖 Bot activo" : isHuman && iControl ? "Controlas tú" : `Controla ${thread.controlledBy?.name ?? "—"}`}
                </span>
                {thread.contact.whatsappOptOut && <span className="badge badge-error">Opt-out</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <AssignControl
                  assignedTo={thread.contact.assignedTo}
                  userId={userId}
                  userRole={userRole}
                  onAssign={doAssign}
                />
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
                {canMarkSpam(userRole) && (
                  <button
                    className="btn-secondary !py-1.5 !px-2 text-[12px]"
                    title="Marcar como spam: bloquea en Meta y da de baja el contacto"
                    onClick={markSpam}
                  >
                    <ShieldBan className="h-3.5 w-3.5" style={{ color: "var(--color-error)" }} />
                  </button>
                )}
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
                      {m.mediaUrl && <MessageMedia url={m.mediaUrl} type={m.mediaType} filename={m.mediaFilename} />}
                      {!(m.mediaUrl && isMediaPlaceholder(m.body)) && (
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      )}
                      <p className="mt-1 text-[10px] opacity-60">
                        {m.sender === "BOT"
                          ? "🤖 Bot · "
                          : m.sender === "ADVISOR"
                          ? "Asesor · "
                          : ""}
                        {new Date(m.createdAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Adjunto pendiente */}
            {pendingMedia && !asNote && (
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: "var(--bg-sidebar)", borderTop: "1px solid var(--border-subtle)" }}>
                {pendingMedia.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- object URL local
                  <img src={pendingMedia.previewUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                ) : (
                  <FileText className="h-6 w-6" style={{ color: "var(--text-tertiary)" }} />
                )}
                <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {pendingMedia.filename} <span style={{ color: "var(--text-tertiary)" }}>· {pendingMedia.type}</span>
                </span>
                <button className="btn-secondary !p-1.5" title="Quitar adjunto" onClick={clearPendingMedia}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Composer */}
            <div className="relative flex items-end gap-2 p-3" style={{ background: "var(--bg-sidebar)", borderTop: "1px solid var(--border-subtle)" }}>
              {/* Dropdown de plantillas (/atajo o botón ⚡) */}
              {tplQuery !== null && (
                <div
                  className="absolute bottom-full left-3 right-3 z-20 mb-1 max-h-52 overflow-y-auto rounded-lg shadow-lg"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
                >
                  {tplMatches.length === 0 ? (
                    <p className="px-3 py-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                      {templates.length === 0
                        ? "Sin plantillas — créalas en Configuración → Perfil"
                        : "Sin coincidencias"}
                    </p>
                  ) : (
                    tplMatches.map((t, i) => (
                      <button
                        key={t.id}
                        className="block w-full px-3 py-2 text-left"
                        style={{ background: i === tplIndex ? "var(--color-teal-light)" : "transparent" }}
                        onMouseEnter={() => setTplIndex(i)}
                        onMouseDown={(e) => { e.preventDefault(); insertTemplate(t); }}
                      >
                        <span className="flex items-center gap-2">
                          {t.shortcut && (
                            <span className="badge badge-neutral !text-[10px] !py-0 shrink-0">/{t.shortcut.replace(/^\//, "")}</span>
                          )}
                          <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{t.name}</span>
                          {t.isGlobal && <span className="text-[10px] shrink-0" style={{ color: "var(--text-tertiary)" }}>global</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                          {t.body}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
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
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={ACCEPT_BY_CHANNEL[thread.channel] ?? "image/*"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attachFile(f);
                  e.target.value = "";
                }}
              />
              {!asNote && ACCEPT_BY_CHANNEL[thread.channel] && (
                <button
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors"
                  title="Adjuntar imagen, documento o audio"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ background: "var(--bg-badge-neutral)", color: "var(--text-tertiary)", opacity: uploading ? 0.5 : 1 }}
                >
                  <Paperclip className={cn("h-4 w-4", uploading && "animate-pulse")} />
                </button>
              )}
              <button
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors"
                title="Respuestas rápidas (o escribe / en el mensaje)"
                onClick={() => { setTplQuery((q) => (q === null ? "" : null)); setTplIndex(0); composerRef.current?.focus(); }}
                style={{
                  background: tplQuery !== null ? "var(--color-teal-light)" : "var(--bg-badge-neutral)",
                  color: "var(--text-tertiary)",
                }}
              >
                <Zap className="h-4 w-4" />
              </button>
              <textarea
                ref={composerRef}
                className="form-input flex-1 resize-none !py-2 text-[13px]"
                rows={1}
                placeholder={asNote ? "Nota interna (solo el equipo la ve)..." : "Escribe un mensaje o / para plantillas..."}
                value={composer}
                onChange={onComposerChange}
                onKeyDown={(e) => {
                  if (tplQuery !== null) {
                    if (e.key === "ArrowDown" && tplMatches.length) { e.preventDefault(); setTplIndex((i) => (i + 1) % tplMatches.length); return; }
                    if (e.key === "ArrowUp" && tplMatches.length) { e.preventDefault(); setTplIndex((i) => (i - 1 + tplMatches.length) % tplMatches.length); return; }
                    if ((e.key === "Enter" || e.key === "Tab") && tplMatches[tplIndex]) { e.preventDefault(); insertTemplate(tplMatches[tplIndex]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setTplQuery(null); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <button
                className="btn-primary !py-2 !px-3"
                disabled={sending || uploading || (!composer.trim() && !(pendingMedia && !asNote))}
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
