// Alta y edición de una marca del agente (2026-10-09, spec marcas-agente).
// Tres modos: crear (el agente nace APAGADO; se enciende al editar, tras revisar el conocimiento),
// editar, y editar la predeterminada (solo el nombre: usa la configuración global del bot).
// La lógica sin React (slug, cuerpo del POST/PATCH, validación) vive en brand-helpers.ts.
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { PLAZA_LABELS } from "@/lib/constants";
import { TONE_PRESETS } from "@/lib/bot/tone-presets";
import {
  NONE, BRAND_CHANNEL_OPTIONS, BRAND_LIMITS, apiErrorMessage, brandToForm, buildBrandPayload,
  emptyBrandForm, suggestSlug, validateBrandForm,
  type BrandFormMode, type BrandFormState, type BrandRow,
} from "./brand-helpers";

// Este repo no tiene componente Textarea: <textarea> nativo con la clase form-input, igual que
// bot-agents-tab.tsx y comment-rule-dialog.tsx.
const TEXTAREA_CLASS = "form-input w-full resize-y text-[13px]";

const DEFAULT_BRAND_NOTE =
  "La marca predeterminada usa la configuración global del bot (pestaña Bot). Sus cuentas son todas las que no tienen marca asignada.";
const EMPTY_KNOWLEDGE_CONFIRM = "Esta marca no tiene conocimiento cargado. ¿Encender de todos modos?";

interface DevelopmentHit {
  id: string;
  name: string;
  city: string | null;
}

export interface BrandFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = marca nueva. */
  brand: BrandRow | null;
  playbooks: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
  onSaved: () => void;
}

export function BrandFormDialog({ open, onOpenChange, brand, playbooks, users, onSaved }: BrandFormDialogProps) {
  const { toast } = useToast();
  const mode: BrandFormMode = !brand ? "create" : brand.isDefault ? "edit-default" : "edit";

  const [form, setForm] = useState<BrandFormState>(emptyBrandForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Buscador de desarrollos del Hub. `devNames` recuerda el nombre de todo lo que se ha visto en
  // resultados: los ids ya guardados solo muestran nombre si aparecen en alguna búsqueda.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DevelopmentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [devNames, setDevNames] = useState<Record<string, string>>({});

  // true cuando ya se aceptó encender el agente sin conocimiento (o ya estaba así guardado):
  // evita preguntar dos veces lo mismo.
  const emptyKnowledgeAck = useRef(false);

  useEffect(() => {
    if (!open) return;
    setForm(brand ? brandToForm(brand) : emptyBrandForm());
    setError("");
    setSaving(false);
    setQuery("");
    setResults([]);
    setSearchError("");
    emptyKnowledgeAck.current = !!brand && brand.botEnabled && !(brand.knowledge ?? "").trim();
  }, [open, brand]);

  // Búsqueda con debounce de 300 ms. Con el cuadro vacío trae los primeros publicados.
  useEffect(() => {
    if (!open || mode === "edit-default") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const res = await fetch(`/api/admin/brands/developments?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setResults([]);
          setSearchError(apiErrorMessage(data, "No se pudo consultar el catálogo del Hub"));
          return;
        }
        const rows: DevelopmentHit[] = Array.isArray(data.data) ? data.data : [];
        setResults(rows);
        setDevNames((prev) => {
          const next = { ...prev };
          for (const r of rows) next[r.id] = r.name;
          return next;
        });
      } catch {
        if (!cancelled) setSearchError("Error de red al consultar el catálogo del Hub");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, mode, query]);

  function set<K extends keyof BrandFormState>(key: K, value: BrandFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (error) setError("");
  }

  function changeName(name: string) {
    setForm((prev) => ({
      ...prev,
      name,
      // El slug sigue al nombre solo al crear y mientras nadie lo haya escrito a mano.
      slug: mode === "create" && !prev.slugTouched ? suggestSlug(name) : prev.slug,
    }));
    if (error) setError("");
  }

  function toggleChannel(channel: string, checked: boolean) {
    set(
      "channels",
      checked ? [...form.channels, channel] : form.channels.filter((c) => c !== channel)
    );
  }

  function addDevelopment(id: string) {
    if (form.developmentIds.includes(id) || form.developmentIds.length >= BRAND_LIMITS.developments) return;
    set("developmentIds", [...form.developmentIds, id]);
  }

  function toggleBot(checked: boolean) {
    if (checked && !form.knowledge.trim() && !emptyKnowledgeAck.current) {
      if (!window.confirm(EMPTY_KNOWLEDGE_CONFIRM)) return;
      emptyKnowledgeAck.current = true;
    }
    set("botEnabled", checked);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateBrandForm(form, mode);
    if (problem) {
      setError(problem);
      return;
    }
    // Segunda red: el conocimiento pudo vaciarse DESPUÉS de prender el agente.
    if (mode === "edit" && form.botEnabled && !form.knowledge.trim() && !emptyKnowledgeAck.current) {
      if (!window.confirm(EMPTY_KNOWLEDGE_CONFIRM)) return;
      emptyKnowledgeAck.current = true;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(brand ? `/api/admin/brands/${brand.id}` : "/api/admin/brands", {
        method: brand ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBrandPayload(form, mode)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se pudo guardar la marca",
          description: apiErrorMessage(data, "Error al guardar la marca"),
          variant: "destructive",
        });
        return;
      }
      toast({ title: brand ? "Marca actualizada" : "Marca creada" });
      onOpenChange(false);
      onSaved();
    } catch {
      toast({ title: "No se pudo guardar la marca", description: "Error de red", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const devLimitReached = form.developmentIds.length >= BRAND_LIMITS.developments;
  // Si lo guardado ya no existe en la lista (usuario dado de baja, playbook borrado) el Select
  // quedaría en blanco y parecería "sin valor": se muestra con una opción aparte.
  const playbookMissing = !!form.playbookId && !playbooks.some((p) => p.id === form.playbookId);
  const ownerMissing = !!form.marketingOwnerUserId && !users.some((u) => u.id === form.marketingOwnerUserId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Nueva marca" : mode === "edit-default" ? "Renombrar la marca predeterminada" : "Editar marca"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit-default"
              ? DEFAULT_BRAND_NOTE
              : "Cada marca responde con su propia presentación, conocimiento, catálogo y canales."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Nombre</Label>
            <Input
              id="brand-name"
              value={form.name}
              maxLength={80}
              onChange={(e) => changeName(e.target.value)}
              placeholder="Nativa Tulum"
            />
          </div>

          {mode !== "edit-default" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="brand-slug">Identificador (slug)</Label>
                <Input
                  id="brand-slug"
                  value={form.slug}
                  maxLength={40}
                  disabled={mode !== "create"}
                  onChange={(e) => {
                    set("slug", e.target.value);
                    set("slugTouched", true);
                  }}
                  placeholder="nativa-tulum"
                />
                <p className="text-[11px] text-muted-foreground">
                  {mode === "create"
                    ? "Minúsculas, números y guiones. Se sugiere a partir del nombre y no se puede cambiar después."
                    : "No se puede cambiar después de crear la marca."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="brand-persona">Presentación</Label>
                <textarea
                  id="brand-persona"
                  className={TEXTAREA_CLASS}
                  rows={4}
                  maxLength={BRAND_LIMITS.persona}
                  value={form.persona}
                  onChange={(e) => set("persona", e.target.value)}
                  placeholder="Eres el asistente comercial de {Marca}, …"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="brand-knowledge">Conocimiento</Label>
                <textarea
                  id="brand-knowledge"
                  className={TEXTAREA_CLASS}
                  rows={14}
                  maxLength={BRAND_LIMITS.knowledge}
                  value={form.knowledge}
                  onChange={(e) => set("knowledge", e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Precios y promociones vigentes, crédito, horario, contacto oficial y QUÉ NO SE PUEDE DECIR. El agente
                  solo cita lo que está aquí o en el catálogo.
                </p>
                <p className="text-right text-[10px] font-mono text-muted-foreground">
                  {form.knowledge.length}/{BRAND_LIMITS.knowledge}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brand-dev-search">Desarrollos del Hub</Label>
                {form.developmentIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.developmentIds.map((id) => (
                      <Badge key={id} variant="secondary" className="gap-1.5">
                        <span className="max-w-[16rem] truncate">{devNames[id] ?? id}</span>
                        <button
                          type="button"
                          aria-label={`Quitar ${devNames[id] ?? id}`}
                          className="leading-none hover:text-destructive"
                          onClick={() => set("developmentIds", form.developmentIds.filter((d) => d !== id))}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <Input
                  id="brand-dev-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar desarrollo publicado…"
                />
                {devLimitReached && (
                  <p className="text-[11px] text-muted-foreground">
                    Máximo {BRAND_LIMITS.developments} desarrollos por marca.
                  </p>
                )}
                {searchError && <p className="text-[11px] text-destructive">{searchError}</p>}
                {!searchError && (
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    {searching && <p className="p-2 text-[12px] text-muted-foreground">Buscando…</p>}
                    {!searching && results.length === 0 && (
                      <p className="p-2 text-[12px] text-muted-foreground">Sin resultados</p>
                    )}
                    {!searching &&
                      results.map((r) => {
                        const added = form.developmentIds.includes(r.id);
                        return (
                          <div key={r.id} className="flex items-center justify-between gap-2 border-b p-2 text-[12px] last:border-b-0">
                            <span className="min-w-0 truncate">
                              {r.name}
                              {r.city ? <span className="text-muted-foreground"> · {r.city}</span> : null}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={added || devLimitReached}
                              onClick={() => addDevelopment(r.id)}
                            >
                              {added ? "Agregado" : "Agregar"}
                            </Button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Plaza predeterminada</Label>
                  <Select
                    value={form.defaultPlaza || NONE}
                    onValueChange={(v) => set("defaultPlaza", v === NONE ? "" : v)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PLAZA_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                      <SelectItem value={NONE}>Ninguna</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Tono</Label>
                  <Select
                    value={form.tonePreset || NONE}
                    onValueChange={(v) => set("tonePreset", v === NONE ? "" : v)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Usar el global</SelectItem>
                      {Object.values(TONE_PRESETS).map((t) => (
                        <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Playbook</Label>
                  <Select
                    value={form.playbookId || NONE}
                    onValueChange={(v) => set("playbookId", v === NONE ? "" : v)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Ninguno</SelectItem>
                      {playbooks.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                      {playbookMissing && <SelectItem value={form.playbookId}>Playbook no disponible</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Responsable de marketing</Label>
                  <Select
                    value={form.marketingOwnerUserId || NONE}
                    onValueChange={(v) => set("marketingOwnerUserId", v === NONE ? "" : v)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>El global</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                      {ownerMissing && <SelectItem value={form.marketingOwnerUserId}>Usuario no disponible</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium leading-none">Canales</legend>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={form.useGlobalChannels}
                    onChange={(e) => set("useGlobalChannels", e.target.checked)}
                  />
                  Usar los globales
                </label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {BRAND_CHANNEL_OPTIONS.map((c) => (
                    <label key={c.value} className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        disabled={form.useGlobalChannels}
                        checked={!form.useGlobalChannels && form.channels.includes(c.value)}
                        onChange={(e) => toggleChannel(c.value, e.target.checked)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-1">
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <input
                    type="checkbox"
                    disabled={mode === "create"}
                    checked={mode === "create" ? false : form.botEnabled}
                    onChange={(e) => toggleBot(e.target.checked)}
                  />
                  Agente encendido
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {mode === "create"
                    ? "La marca nace con el agente apagado. Enciéndelo al editarla, después de revisar el conocimiento."
                    : "Con el agente apagado, las cuentas de esta marca no contestan solas."}
                </p>
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando…" : mode === "create" ? "Crear marca" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
