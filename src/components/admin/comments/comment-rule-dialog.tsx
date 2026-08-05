// Alta y edición de una regla de comentarios. El aviso de colisión de frases
// se calcula contra las reglas hermanas ya cargadas: es el error que en
// producción no da síntoma (gana la de mayor prioridad y la otra calla).
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { normalize } from "@/lib/comments/match";

export interface ConnectorOption {
  id: string;
  name: string;
  provider: "INSTAGRAM" | "MESSENGER";
}

export interface CommentRuleRow {
  id: string;
  name: string;
  connectorId: string;
  isActive: boolean;
  priority: number;
  phrases: string[];
  publicReplies: string[];
  dmTemplate: string;
  postFilter: string[];
  connector: { id: string; name: string; provider: string };
  _count: { logs: number };
}

const MAX_VARIANTS = 5;

// Este repo no tiene componente Textarea: se usa <textarea> nativo con la clase
// form-input, igual que bot-agents-tab.tsx y playbook-tab.tsx.
const TEXTAREA_CLASS = "form-input w-full resize-none text-[13px]";

export function CommentRuleDialog({
  open, onOpenChange, connectors, rules, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectors: ConnectorOption[];
  rules: CommentRuleRow[];
  editing: CommentRuleRow | null;
  onSaved: () => void;
}) {
  const [connectorId, setConnectorId] = useState("");
  const [name, setName] = useState("");
  const [phrases, setPhrases] = useState<string[]>([]);
  const [phraseDraft, setPhraseDraft] = useState("");
  const [publicReplies, setPublicReplies] = useState<string[]>([""]);
  const [dmTemplate, setDmTemplate] = useState("");
  const [postFilter, setPostFilter] = useState("");
  const [priority, setPriority] = useState(100);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    if (editing) {
      setConnectorId(editing.connectorId);
      setName(editing.name);
      setPhrases(editing.phrases);
      setPublicReplies(editing.publicReplies.length ? editing.publicReplies : [""]);
      setDmTemplate(editing.dmTemplate);
      setPostFilter(editing.postFilter.join("\n"));
      setPriority(editing.priority);
    } else {
      setConnectorId(connectors[0]?.id ?? "");
      setName("");
      setPhrases([]);
      setPublicReplies([""]);
      setDmTemplate("");
      setPostFilter("");
      setPriority(100);
    }
    setPhraseDraft("");
  }, [open, editing, connectors]);

  const normalized = phrases.map(normalize);
  const clashes = rules
    .filter((r) => r.connectorId === connectorId && r.isActive && r.id !== editing?.id)
    .flatMap((r) => r.phrases.filter((p) => normalized.includes(p)).map((p) => ({ rule: r.name, phrase: p })));

  function addPhrase() {
    const value = phraseDraft.trim();
    if (!value) return;
    if (!phrases.some((p) => normalize(p) === normalize(value))) {
      setPhrases([...phrases, value]);
    }
    setPhraseDraft("");
  }

  async function save() {
    setError("");
    const cleanReplies = publicReplies.map((r) => r.trim()).filter(Boolean);
    if (!name.trim() || !connectorId || phrases.length === 0 || cleanReplies.length === 0 || !dmTemplate.trim()) {
      setError("Faltan nombre, cuenta, frases, al menos una respuesta pública y el mensaje privado");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      connectorId,
      phrases,
      publicReplies: cleanReplies,
      dmTemplate: dmTemplate.trim(),
      postFilter: postFilter.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
      priority,
    };
    const res = await fetch(
      editing ? `/api/admin/comment-rules/${editing.id}` : "/api/admin/comment-rules",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...payload, connectorId: undefined } : payload),
      }
    );
    setSaving(false);
    if (res.ok) {
      onOpenChange(false);
      onSaved();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(typeof data.error === "string" ? data.error : "No se pudo guardar la regla");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar regla" : "Nueva regla de comentarios"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Cuenta</Label>
            <Select value={connectorId} onValueChange={setConnectorId} disabled={!!editing}>
              <SelectTrigger><SelectValue placeholder="Elige una cuenta" /></SelectTrigger>
              <SelectContent>
                {connectors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.provider === "INSTAGRAM" ? "Instagram" : "Facebook"} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {connectors.length === 0 && (
              <p className="text-[11px] text-destructive">
                No hay conectores de Instagram o Messenger activos. Créalos en Admin → Integraciones.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Info — campaña Tulum" />
          </div>

          <div className="space-y-1.5">
            <Label>Palabras o frases que disparan</Label>
            <div className="flex gap-2">
              <Input
                value={phraseDraft}
                onChange={(e) => setPhraseDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhrase(); } }}
                placeholder="info"
              />
              <Button type="button" variant="outline" size="sm" onClick={addPhrase}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {phrases.map((p) => (
                <span key={p} className="badge badge-neutral inline-flex items-center gap-1">
                  {p}
                  <button type="button" onClick={() => setPhrases(phrases.filter((x) => x !== p))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            {phrases.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Se compara como: {normalized.map((n) => `"${n}"`).join(", ")} — palabra completa,
                sin acentos ni mayúsculas. &quot;info&quot; no dispara con &quot;informal&quot;.
              </p>
            )}
            {clashes.length > 0 && (
              <p className="text-[11px] text-destructive">
                Choque: {clashes.map((c) => `"${c.phrase}" ya la usa la regla activa "${c.rule}"`).join(" · ")}.
                Solo dispararía una de las dos.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Respuestas públicas (rotan)</Label>
            {publicReplies.map((r, i) => (
              <div key={i} className="flex gap-2">
                <textarea
                  className={TEXTAREA_CLASS}
                  rows={2}
                  value={r}
                  maxLength={500}
                  onChange={(e) => {
                    const next = [...publicReplies];
                    next[i] = e.target.value;
                    setPublicReplies(next);
                  }}
                  placeholder="¡Listo {{usuario}}! Te escribo al privado 📩"
                />
                {publicReplies.length > 1 && (
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setPublicReplies(publicReplies.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {publicReplies.length < MAX_VARIANTS && (
              <Button type="button" variant="outline" size="sm" onClick={() => setPublicReplies([...publicReplies, ""])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Otra variante
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">
              Varias variantes evitan publicar el mismo texto en cadena, que es lo que Meta
              interpreta como spam.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Mensaje privado (DM)</Label>
            <textarea
              className={TEXTAREA_CLASS}
              rows={4}
              maxLength={900}
              value={dmTemplate}
              onChange={(e) => setDmTemplate(e.target.value)}
              placeholder="Hola {{usuario}}, gracias por comentar. Te comparto la info de..."
            />
            <p className="text-[11px] text-muted-foreground">
              Después de este mensaje el bot sigue la conversación en el Inbox.
              Variable disponible: <code>{"{{usuario}}"}</code>.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Publicaciones (opcional)</Label>
            <textarea
              className={TEXTAREA_CLASS}
              rows={2}
              value={postFilter}
              onChange={(e) => setPostFilter(e.target.value)}
              placeholder="MEDIA-1&#10;MEDIA-2"
            />
            <p className="text-[11px] text-muted-foreground">
              Vacío = todos los posts de la cuenta. Solo IDs, no URLs: el ID aparece en el
              log en cuanto llega el primer comentario, y ahí puedes copiarlo.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Prioridad</Label>
            <Input type="number" min={1} max={999} value={priority}
              onChange={(e) => setPriority(Number(e.target.value))} />
            <p className="text-[11px] text-muted-foreground">Menor número gana si dos reglas coinciden.</p>
          </div>

          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <Button className="w-full" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear (queda en pausa)"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
