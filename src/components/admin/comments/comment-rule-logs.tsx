// Log de comentarios que dispararon regla, con reintento y copiar ID de post.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format-date";
import { RefreshCw, Copy } from "lucide-react";

interface LogRow {
  id: string;
  createdAt: string;
  platform: "INSTAGRAM" | "FACEBOOK";
  postId: string;
  authorHandle: string | null;
  commentText: string;
  matchedPhrase: string;
  publicReplyStatus: string;
  publicReplyError: string | null;
  dmStatus: string;
  dmError: string | null;
  rule: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  SENT: "badge-success",
  FAILED: "badge-error",
  SKIPPED: "badge-neutral",
  PENDING: "badge-neutral",
};

export function CommentRuleLogs({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (onlyFailed) params.set("failed", "1");
    const res = await fetch(`/api/admin/comment-rules/logs?${params}`);
    setLoading(false);
    if (!res.ok) {
      setError("No se pudo cargar el historial");
      return;
    }
    const data = await res.json();
    setRows(data.data ?? []);
    setTotal(data.total ?? 0);
  }, [page, onlyFailed]);

  useEffect(() => { load(); }, [load, reloadKey]);

  async function retry(id: string) {
    setRetryingId(id);
    await fetch(`/api/admin/comment-rules/logs/${id}/retry`, { method: "POST" });
    setRetryingId(null);
    load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Historial</CardTitle>
          <CardDescription>{total} comentarios dispararon una regla</CardDescription>
        </div>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={onlyFailed}
            onChange={(e) => { setOnlyFailed(e.target.checked); setPage(1); }} />
          Solo fallidos
        </label>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando…</p>
        )}
        {!loading && error && (
          <p className="py-4 text-center text-sm text-destructive">{error}</p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Sin registros todavía</p>
        )}
        {!loading && !error && rows.map((r) => (
          <div key={r.id} className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--border-default)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-neutral">{r.platform === "INSTAGRAM" ? "IG" : "FB"}</span>
              <span className="font-semibold">{r.authorHandle ?? "sin nombre"}</span>
              <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span>
              <span className="badge badge-neutral">{r.rule?.name ?? "regla borrada"}</span>
              <span className={`badge ${STATUS_BADGE[r.publicReplyStatus]}`}>público: {r.publicReplyStatus}</span>
              <span className={`badge ${STATUS_BADGE[r.dmStatus]}`}>DM: {r.dmStatus}</span>
              {r.contact && (
                <a className="underline" href={`/contacts/${r.contact.id}`}>
                  {r.contact.firstName} {r.contact.lastName}
                </a>
              )}
            </div>
            <p className="mt-1">
              &quot;{r.commentText}&quot; <span className="text-muted-foreground">(coincidió: {r.matchedPhrase})</span>
            </p>
            {(r.publicReplyError || r.dmError) && (
              <p className="mt-1 text-destructive">{r.publicReplyError ?? r.dmError}</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button variant="outline" size="sm"
                onClick={() => navigator.clipboard.writeText(r.postId)} title="Copiar ID de la publicación">
                <Copy className="mr-1 h-3 w-3" /> ID del post
              </Button>
              {/* Solo Facebook: la URL de un post de IG usa shortcode, no el media_id
                  que manda el webhook, así que no hay link construible. */}
              {r.platform === "FACEBOOK" && (
                <a className="text-[12px] underline" target="_blank" rel="noreferrer"
                  href={`https://www.facebook.com/${r.postId}`}>
                  Ver publicación
                </a>
              )}
              {(r.publicReplyStatus === "FAILED" || r.dmStatus === "FAILED") && (
                <Button variant="outline" size="sm" onClick={() => retry(r.id)} disabled={retryingId === r.id}>
                  <RefreshCw className="mr-1 h-3 w-3" /> {retryingId === r.id ? "Reintentando…" : "Reintentar"}
                </Button>
              )}
            </div>
          </div>
        ))}
        {total > 25 && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
