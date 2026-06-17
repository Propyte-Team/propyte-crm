// Sección Conectores de Leads (Anexo B §H.7) — dentro de Admin → Integraciones.
// Alta/edición con credenciales por proveedor (se cifran server-side, nunca se releen).
"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pause, Play, Trash2 } from "lucide-react";

interface Connector {
  id: string;
  name: string;
  provider: "META" | "TIKTOK" | "WEBSITE" | "ZAPIER" | "MANUAL" | "INSTAGRAM" | "MESSENGER";
  status: "ACTIVE" | "PAUSED" | "ERROR";
  lastLeadAt: string | null;
  errorCount: number;
  lastError: string | null;
  hasCredentials: boolean;
  _count: { leadLogs: number };
}

const META_CRED_FIELDS = [
  { key: "pageId", label: "Page ID" },
  { key: "pageAccessToken", label: "Page Access Token (long-lived)" },
  { key: "appSecret", label: "App Secret" },
  { key: "verifyToken", label: "Verify Token (lo inventas tú)" },
];

const CRED_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  META: META_CRED_FIELDS,
  INSTAGRAM: META_CRED_FIELDS,
  MESSENGER: META_CRED_FIELDS,
  TIKTOK: [
    { key: "advertiserId", label: "Advertiser ID" },
    { key: "accessToken", label: "Access Token" },
  ],
  WEBSITE: [{ key: "webhookSecret", label: "Webhook Secret (mín. 16 caracteres)" }],
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "badge-success",
  PAUSED: "badge-neutral",
  ERROR: "badge-error",
};

export function ConnectorsSection() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<string>("META");
  const [name, setName] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/connectors");
    if (res.ok) setConnectors((await res.json()).data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setError("");
    const fields = CRED_FIELDS[provider] ?? [];
    const missing = fields.filter((f) => !creds[f.key]?.trim());
    if (!name.trim() || missing.length > 0) {
      setError("Completa nombre y credenciales");
      return;
    }
    const res = await fetch("/api/admin/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), provider, credentials: creds }),
    });
    if (res.ok) {
      setOpen(false);
      setName("");
      setCreds({});
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Credenciales inválidas para el proveedor");
    }
  }

  async function toggle(c: Connector) {
    await fetch(`/api/admin/connectors/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: c.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }),
    });
    load();
  }

  async function remove(c: Connector) {
    if (!confirm(`¿Eliminar conector "${c.name}"?`)) return;
    await fetch(`/api/admin/connectors/${c.id}`, { method: "DELETE" });
    load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Conectores de Leads</CardTitle>
          <CardDescription>
            Meta Lead Ads (tiempo real) · TikTok Lead Gen (pull 5 min) · Webhook del sitio
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Nuevo conector</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Nuevo conector</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Proveedor</Label>
                <Select value={provider} onValueChange={(v) => { setProvider(v); setCreds({}); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="META">Meta Lead Ads</SelectItem>
                    <SelectItem value="INSTAGRAM">Instagram DM</SelectItem>
                    <SelectItem value="MESSENGER">Messenger</SelectItem>
                    <SelectItem value="TIKTOK">TikTok Lead Gen</SelectItem>
                    <SelectItem value="WEBSITE">Sitio web (webhook)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meta — Página Propyte" />
              </div>
              {(CRED_FIELDS[provider] ?? []).map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label>{f.label}</Label>
                  <Input
                    type="password"
                    value={creds[f.key] ?? ""}
                    onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                  />
                </div>
              ))}
              {(provider === "META" || provider === "INSTAGRAM" || provider === "MESSENGER") && (
                <p className="text-[11px] text-muted-foreground">
                  Webhook callback: <code>https://crm.propyte.com/api/connectors/meta/webhook</code> (objeto page, campo leadgen / mensajes)
                </p>
              )}
              {error && <p className="text-[12px] text-destructive">{error}</p>}
              <Button className="w-full" onClick={create}>Crear (queda en pausa hasta activar)</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-2">
        {connectors.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Sin conectores configurados</p>
        )}
        {connectors.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border p-3" style={{ borderColor: "var(--border-default)" }}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">{c.name}</span>
                <span className="badge badge-neutral">{c.provider}</span>
                <span className={`badge ${STATUS_BADGE[c.status]}`}>{c.status}</span>
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {c._count.leadLogs} leads · último: {c.lastLeadAt ? new Date(c.lastLeadAt).toLocaleString("es-MX") : "—"}
                {c.errorCount > 0 && ` · ${c.errorCount} errores`}
              </p>
              {c.lastError && <p className="truncate text-[11px] text-destructive">{c.lastError}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => toggle(c)} title={c.status === "ACTIVE" ? "Pausar" : "Activar"}>
                {c.status === "ACTIVE" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="outline" size="sm" onClick={() => remove(c)} title="Eliminar">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
