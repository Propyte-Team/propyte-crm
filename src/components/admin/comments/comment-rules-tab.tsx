// Pestaña Admin → Comentarios: reglas de palabra clave → respuesta pública + DM.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Pause, Play, Pencil, Trash2 } from "lucide-react";
import { CommentRuleDialog, type CommentRuleRow, type ConnectorOption } from "./comment-rule-dialog";
import { CommentRuleTester } from "./comment-rule-tester";
import { CommentRuleLogs } from "./comment-rule-logs";
import { CommentAccountsHealth } from "./comment-accounts-health";

export function CommentRulesTab() {
  const [rules, setRules] = useState<CommentRuleRow[]>([]);
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CommentRuleRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [rulesRes, connRes] = await Promise.all([
        fetch("/api/admin/comment-rules"),
        fetch("/api/admin/connectors"),
      ]);
      if (rulesRes.ok) {
        setRules((await rulesRes.json()).data ?? []);
      } else {
        setLoadError("No se pudieron cargar las reglas");
      }
      if (connRes.ok) {
        const all = (await connRes.json()).data ?? [];
        setConnectors(
          all
            .filter((c: { provider: string; status: string }) =>
              (c.provider === "INSTAGRAM" || c.provider === "MESSENGER") && c.status === "ACTIVE")
            .map((c: { id: string; name: string; provider: ConnectorOption["provider"] }) => ({
              id: c.id, name: c.name, provider: c.provider,
            }))
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(rule: CommentRuleRow) {
    const res = await fetch(`/api/admin/comment-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(typeof data.error === "string" ? data.error : "No se pudo cambiar el estado");
    }
    load();
  }

  async function remove(rule: CommentRuleRow) {
    if (!confirm(`¿Eliminar la regla "${rule.name}"? El historial se conserva.`)) return;
    await fetch(`/api/admin/comment-rules/${rule.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Reglas de comentarios</CardTitle>
            <CardDescription>
              Cuando alguien comenta la palabra clave: respuesta pública + DM privado.
              Después del DM, el bot sigue la conversación en el Inbox.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Nueva regla
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && (
            <p className="py-4 text-center text-sm text-muted-foreground">Cargando…</p>
          )}
          {!loading && loadError && (
            <p className="py-4 text-center text-sm text-destructive">{loadError}</p>
          )}
          {!loading && !loadError && rules.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Sin reglas configuradas
            </p>
          )}
          {!loading && rules.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border p-3"
              style={{ borderColor: "var(--border-default)" }}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold">{r.name}</span>
                  <span className="badge badge-neutral">
                    {r.connector.provider === "INSTAGRAM" ? "Instagram" : "Facebook"} · {r.connector.name}
                  </span>
                  <span className={`badge ${r.isActive ? "badge-success" : "badge-neutral"}`}>
                    {r.isActive ? "ACTIVA" : "EN PAUSA"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {r.phrases.map((p) => (
                    <span key={p} className="badge badge-neutral">{p}</span>
                  ))}
                  {(r.excludePhrases ?? []).length > 0 && (
                    <span className="text-[11px] text-muted-foreground">salvo</span>
                  )}
                  {(r.excludePhrases ?? []).map((p) => (
                    <span key={`x-${p}`} className="badge badge-warning">{p}</span>
                  ))}
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {r._count.logs} disparos · prioridad {r.priority} ·{" "}
                  {r.postFilter.length ? `${r.postFilter.length} publicaciones` : "toda la cuenta"} ·{" "}
                  {r.publicReplies.length} variante(s) ·{" "}
                  {r.dailyCap > 0 ? `tope ${r.dailyCap}/día` : "sin tope diario"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => toggle(r)}
                  title={r.isActive ? "Pausar" : "Activar"}>
                  {r.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="sm"
                  onClick={() => { setEditing(r); setDialogOpen(true); }} title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => remove(r)} title="Eliminar">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <CommentAccountsHealth />

      <CommentRuleTester connectors={connectors} />
      <CommentRuleLogs reloadKey={reloadKey} />

      <CommentRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connectors={connectors}
        rules={rules}
        editing={editing}
        onSaved={() => { load(); setReloadKey((k) => k + 1); }}
      />
    </div>
  );
}
