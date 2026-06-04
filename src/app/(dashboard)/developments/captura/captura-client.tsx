"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Link = { id: string; token: string; label: string; targetDevId: string | null; expiresAt: string | null; revokedAt: string | null; _count: { submissions: number } };

export default function CapturaClient() {
  const [view, setView] = useState<"links" | "bandeja">("links");
  const [links, setLinks] = useState<Link[]>([]);
  const [label, setLabel] = useState("");
  const [targetDevId, setTargetDevId] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const r = await fetch("/api/captura/links");
    const j = await r.json();
    setLinks(j.data ?? []);
  }
  useEffect(() => { load(); }, []);

  async function createLink() {
    if (!label.trim()) return;
    setCreating(true);
    await fetch("/api/captura/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, targetDevId: targetDevId || undefined }),
    });
    setLabel(""); setTargetDevId(""); setCreating(false); load();
  }
  async function revoke(id: string) {
    await fetch(`/api/captura/links/${id}`, { method: "PATCH" });
    load();
  }
  function copyUrl(token: string) {
    const url = `${window.location.origin}/captura/${token}`;
    navigator.clipboard.writeText(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button variant={view === "links" ? "default" : "outline"} onClick={() => setView("links")}>Links</Button>
        <Button variant={view === "bandeja" ? "default" : "outline"} onClick={() => setView("bandeja")}>Bandeja</Button>
      </div>

      {view === "links" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
            <div className="flex-1 min-w-[200px]">
              <Label>Etiqueta</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Gobernador 28 – Grupo 28" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label>Actualizar desarrollo (UUID, opcional)</Label>
              <Input value={targetDevId} onChange={(e) => setTargetDevId(e.target.value)} placeholder="dejar vacío = nuevo" />
            </div>
            <Button onClick={createLink} disabled={creating || !label.trim()}>Generar link</Button>
          </div>

          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground">
              <th className="p-2">Etiqueta</th><th className="p-2">Envíos</th><th className="p-2">Caduca</th><th className="p-2">Estado</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2">{l.label}</td>
                  <td className="p-2">{l._count.submissions}</td>
                  <td className="p-2">{l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : "—"}</td>
                  <td className="p-2">{l.revokedAt ? "Revocado" : "Activo"}</td>
                  <td className="p-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyUrl(l.token)}>Copiar URL</Button>
                    {!l.revokedAt && <Button size="sm" variant="outline" onClick={() => revoke(l.id)}>Revocar</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "bandeja" && <Bandeja />}
    </div>
  );
}

function Bandeja() {
  const [subs, setSubs] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/captura/submissions?status=PENDING");
    const j = await r.json();
    setSubs(j.data ?? []);
  }
  useEffect(() => { load(); }, []);

  async function approve(id: string) {
    setBusy(id);
    const r = await fetch(`/api/captura/submissions/${id}/approve`, { method: "POST" });
    setBusy(null);
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error ?? "Error al aprobar"); return; }
    load();
  }
  async function reject(id: string) {
    const note = prompt("Motivo del rechazo (opcional):") ?? "";
    setBusy(id);
    await fetch(`/api/captura/submissions/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", reviewNotes: note }),
    });
    setBusy(null); load();
  }

  if (!subs.length) return <div className="text-sm text-muted-foreground">No hay envíos pendientes.</div>;

  return (
    <div className="space-y-4">
      {subs.map((s) => (
        <div key={s.id} className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{s.payload?.generales?.nombre ?? "(sin nombre)"}</p>
              <p className="text-xs text-muted-foreground">
                {s.link?.label} · {s.payload?.tipologias?.length ?? 0} tipologías · {s.imageUrls?.length ?? 0} imágenes
                {s.link?.targetDevId ? " · actualización" : " · nuevo"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy === s.id} onClick={() => approve(s.id)}>Aprobar</Button>
              <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => reject(s.id)}>Rechazar</Button>
            </div>
          </div>
          <pre className="mt-3 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(s.payload, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
