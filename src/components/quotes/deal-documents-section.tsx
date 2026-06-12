"use client";

// ============================================================
// DealDocumentsSection — lista y gestión de documentos de un deal
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Trash2, Plus, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type DocType =
  | "KYC"
  | "CONTRATO_ENVIADO"
  | "CONTRATO_FIRMADO"
  | "COMPROBANTE_ENGANCHE"
  | "RECIBO"
  | "COMPROBANTE_DOMICILIO"
  | "OTRO";

const DOC_TYPE_LABEL: Record<DocType, string> = {
  KYC: "KYC / Identificación",
  CONTRATO_ENVIADO: "Contrato enviado",
  CONTRATO_FIRMADO: "Contrato firmado",
  COMPROBANTE_ENGANCHE: "Comprobante de enganche",
  RECIBO: "Recibo",
  COMPROBANTE_DOMICILIO: "Comprobante de domicilio",
  OTRO: "Otro",
};

interface Doc {
  id: string;
  type: DocType;
  name: string;
  url: string;
  createdAt: string;
  uploadedBy?: { id: string; name: string };
}

interface DealDocumentsSectionProps {
  dealId: string;
}

export function DealDocumentsSection({ dealId }: DealDocumentsSectionProps) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  // Form state
  const [docType, setDocType] = useState<DocType>("OTRO");
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/documents`);
      const json = await res.json();
      if (res.ok) setDocs(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!docName.trim() || !docUrl.trim()) {
      setFormError("Nombre y URL son requeridos");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: docType, name: docName.trim(), url: docUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? "Error al guardar");
        return;
      }
      setDocs((prev) => [json.data, ...prev]);
      setAddOpen(false);
      setDocName("");
      setDocUrl("");
      setDocType("OTRO");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este documento?")) return;
    const res = await fetch(`/api/deals/${dealId}/documents/${id}`, { method: "DELETE" });
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
  };

  // Agrupar por tipo
  const grouped = Object.entries(DOC_TYPE_LABEL).reduce(
    (acc, [type]) => {
      acc[type] = docs.filter((d) => d.type === type);
      return acc;
    },
    {} as Record<string, Doc[]>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-400">Documentos</p>
          <h2 className="text-lg font-semibold text-zinc-900">{docs.length} documento{docs.length !== 1 ? "s" : ""}</h2>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Agregar documento
        </Button>
      </div>

      {/* Listado por tipo */}
      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-400">Cargando…</div>
      ) : docs.length === 0 ? (
        <div className="border border-dashed border-zinc-200 py-10 text-center text-sm text-zinc-400">
          No hay documentos registrados para este deal.
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([type, typeDocs]) => {
            if (typeDocs.length === 0) return null;
            return (
              <div key={type}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  {DOC_TYPE_LABEL[type as DocType]}
                  <span className="ml-1.5 font-mono normal-case font-normal">
                    ({typeDocs.length})
                  </span>
                </p>
                <div className="border border-border">
                  {typeDocs.map((doc, i) => (
                    <div
                      key={doc.id}
                      className={`flex items-center justify-between px-4 py-3 hover:bg-zinc-50/50 transition-colors ${
                        i < typeDocs.length - 1 ? "border-b border-border" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 shrink-0 text-zinc-300" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-800 truncate">{doc.name}</p>
                          <p className="text-xs text-zinc-400">
                            {doc.uploadedBy?.name ?? "Desconocido"} ·{" "}
                            {format(new Date(doc.createdAt), "dd MMM yyyy", { locale: es })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-4">
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 transition-colors"
                          title="Abrir documento"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-red-600 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog: agregar documento */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) { setFormError(null); setDocName(""); setDocUrl(""); setDocType("OTRO"); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar documento</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-zinc-400">Tipo</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                <SelectTrigger className="rounded-none border-border focus:ring-1 focus:ring-zinc-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-zinc-400">Nombre</Label>
              <Input
                className="rounded-none border-border focus:ring-1 focus:ring-zinc-900"
                placeholder="Ej. INE frente"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-zinc-400">URL del archivo</Label>
              <Input
                className="rounded-none border-border focus:ring-1 focus:ring-zinc-900"
                placeholder="https://…"
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                type="url"
                required
              />
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Agregar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
