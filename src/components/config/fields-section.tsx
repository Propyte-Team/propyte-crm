// Configuración → Campos de la ficha: lista de campos propios, alta, edición y archivados.
// E7 #968: nombre técnico autogenerado (bajo "Avanzado"), editar etiqueta/ayuda/orden/opciones,
// permisos por rol y restaurar archivados.
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Archive, Pencil, ArrowUp, ArrowDown, RotateCcw, X } from "lucide-react";
import { FIELD_TYPE_LABELS, ROLE_LABELS_COMPLETO, etiqueta } from "@/lib/labels";
import { erroresPorCampo, mensajeDeError } from "@/lib/api-errors";
import { generarApiName, construirOpciones, opcionesDeTexto } from "@/lib/metadata/api-name";
import { validarPasoCampo, resumenPaso1, type PasoCampo } from "@/lib/metadata/asistente-campo";
import { ROLES_CONFIGURABLES, type Access } from "@/lib/metadata/visibilidad-model";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface FieldDef {
  id: string;
  objectApiName: string;
  apiName: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  isSystem: boolean;
  isActive: boolean;
  helpText?: string | null;
  order?: number;
  options: Array<{ value: string; label: string }>;
  permissions?: Array<{ role: string; access: Access }>;
}

const FIELD_TYPES = ["TEXT", "TEXTAREA", "NUMBER", "CURRENCY", "DATE", "BOOLEAN", "EMAIL", "PHONE", "URL", "PICKLIST"];
const ES_LISTA = (t: string) => t === "PICKLIST" || t === "MULTI_PICKLIST";

// Sin fila de permiso: el administrador edita y los demás roles solo leen (igual que el servidor).
const ACCESO_POR_DEFECTO: Access = "READ";
const ACCESS_LABELS: Record<Access, string> = { EDIT: "Edita", READ: "Solo lectura", HIDDEN: "Oculto" };
const ROLES_PERMISOS = ROLES_CONFIGURABLES.filter((r) => r !== "ADMIN");

const BORRADOR_VACIO = { apiName: "", label: "", fieldType: "TEXT", isRequired: false, options: "" };

async function patch(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/metadata/fields", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: mensajeDeError(await res.json().catch(() => ({})), "Intenta de nuevo") };
}

export function FieldsSection({ userRole }: { userRole: string }) {
  const isAdmin = userRole === "ADMIN";
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [archivados, setArchivados] = useState<FieldDef[]>([]);
  const [object, setObject] = useState("contact");
  const [draft, setDraft] = useState(BORRADOR_VACIO);
  const [paso, setPaso] = useState<PasoCampo>(1);
  const [apiTocado, setApiTocado] = useState(false); // el usuario editó el nombre técnico a mano
  const [msg, setMsg] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const confirmar = useConfirm();
  const [similar, setSimilar] = useState<Array<{ apiName: string; label: string }>>([]);
  const [editando, setEditando] = useState<FieldDef | null>(null);

  const load = useCallback(async () => {
    const [act, arc] = await Promise.all([
      fetch(`/api/admin/metadata/fields?object=${object}`),
      fetch(`/api/admin/metadata/fields?object=${object}&archived=1`),
    ]);
    if (act.ok) setFields((await act.json()).data ?? []);
    if (arc.ok) setArchivados((await arc.json()).data ?? []);
  }, [object]);
  useEffect(() => { load(); }, [load]);

  // apiNames ya usados (activos y archivados: la base los reserva)
  const usados = useMemo(() => [...fields, ...archivados].map((f) => f.apiName), [fields, archivados]);
  const apiSugerido = useMemo(() => generarApiName(object, draft.label, usados), [object, draft.label, usados]);
  const apiFinal = apiTocado && draft.apiName.trim() ? draft.apiName.trim() : apiSugerido;

  async function create(force = false) {
    setMsg("");
    setErrores({});
    setSimilar([]);
    const e1 = validarPasoCampo(1, draft);
    if (Object.keys(e1).length) {
      setErrores(e1);
      setPaso(1);
      return;
    }
    const e2 = validarPasoCampo(2, draft);
    if (Object.keys(e2).length) {
      setErrores(e2);
      return;
    }
    const body: Record<string, unknown> = {
      objectApiName: object,
      apiName: apiFinal,
      label: draft.label.trim(),
      fieldType: draft.fieldType,
      isRequired: draft.isRequired,
      force,
    };
    if (draft.fieldType === "PICKLIST") {
      body.options = construirOpciones(opcionesDeTexto(draft.options));
    }
    const res = await fetch("/api/admin/metadata/fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setSimilar(data.similar ?? []);
      setMsg("Ya hay campos parecidos — revisa antes de crear");
    } else if (res.ok) {
      setMsg("");
      toast({ title: "Campo creado", description: draft.label.trim() });
      setDraft(BORRADOR_VACIO);
      setApiTocado(false);
      setPaso(1);
      load();
    } else {
      setErrores(erroresPorCampo(data));
      setMsg(mensajeDeError(data, "No se pudo crear el campo"));
    }
  }

  function siguiente() {
    const e = validarPasoCampo(1, draft);
    setErrores(e);
    setMsg("");
    setSimilar([]);
    if (Object.keys(e).length === 0) setPaso(2);
  }

  async function archive(id: string) {
    const ok = await confirmar({
      titulo: "¿Archivar este campo?",
      descripcion: "Deja de mostrarse, pero los valores ya capturados se conservan (no se borran). Puedes restaurarlo después.",
      confirmar: "Archivar",
      peligroso: true,
    });
    if (!ok) return;
    const r = await patch({ id, archive: true });
    if (!r.ok) {
      toast({ title: "No se pudo archivar", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Campo archivado" });
    load();
  }

  async function restaurar(f: FieldDef) {
    const r = await patch({ id: f.id, archive: false });
    if (!r.ok) {
      toast({ title: "No se pudo restaurar", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Campo restaurado", description: f.label });
    load();
  }

  // Reordenar: se renumera toda la lista (10, 20, 30…) y se guardan solo los que cambian de posición.
  async function mover(idx: number, delta: -1 | 1) {
    const j = idx + delta;
    if (j < 0 || j >= fields.length) return;
    const nueva = [...fields];
    [nueva[idx], nueva[j]] = [nueva[j], nueva[idx]];
    const cambios = nueva
      .map((f, i) => ({ f, orden: (i + 1) * 10 }))
      .filter(({ f, orden }) => f.order !== orden);
    setFields(nueva.map((f, i) => ({ ...f, order: (i + 1) * 10 })));
    const rs = await Promise.all(cambios.map(({ f, orden }) => patch({ id: f.id, order: orden })));
    if (rs.some((r) => !r.ok)) {
      toast({ title: "No se pudo guardar el orden", variant: "destructive" });
      load();
    }
  }

  const nombreObjeto = object === "contact" ? "Contacto" : "Negocio";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campos de la ficha</h1>
          <p className="text-muted-foreground">Agrega datos propios a contactos y negocios. Al archivar un campo, lo ya capturado se conserva.</p>
        </div>
        <select className="form-input !w-40 !py-1.5" aria-label="Objeto" value={object} onChange={(e) => setObject(e.target.value)}>
          <option value="contact">Contacto</option>
          <option value="deal">Negocio</option>
        </select>
      </div>

      {isAdmin && (
        <form
          className="crm-card !p-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); create(false); }}
        >
          <p className="text-[13px] font-semibold">
            Nuevo campo en {nombreObjeto}{" "}
            <span className="font-normal" style={{ color: "var(--text-tertiary)" }}>· Paso {paso} de 2</span>
          </p>
          {paso === 1 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <input className="form-input" aria-label="Etiqueta visible" placeholder="¿Cómo se llama? (ej. Notaría asignada)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                {errores.label && <p className="mt-1 text-[11px]" style={{ color: "var(--color-warning)" }}>{errores.label}</p>}
              </div>
              <select className="form-input" aria-label="Tipo de campo" value={draft.fieldType} onChange={(e) => setDraft({ ...draft, fieldType: e.target.value })}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{etiqueta(FIELD_TYPE_LABELS, t)}</option>)}
              </select>
            </div>
          )}
          {paso === 2 && (
            <>
              <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {resumenPaso1(draft, etiqueta(FIELD_TYPE_LABELS, draft.fieldType))}
              </p>
              <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={draft.isRequired} onChange={(e) => setDraft({ ...draft, isRequired: e.target.checked })} />
                Obligatorio
              </label>
              {draft.fieldType === "PICKLIST" && (
                <div>
                  <input className="form-input" aria-label="Opciones de la lista" placeholder="Opciones separadas por coma: Notaría 1, Notaría 7" value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} />
                  {errores.options && <p className="mt-1 text-[11px]" style={{ color: "var(--color-warning)" }}>{errores.options}</p>}
                </div>
              )}
              <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                Quién ve y quién edita este campo se ajusta después con el lápiz de la lista (por defecto, solo lectura para los demás puestos).
              </p>
              <details className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                <summary className="cursor-pointer">Avanzado</summary>
                <div className="mt-2 space-y-1">
                  <label className="block text-[12px]" htmlFor="api-name-campo">Nombre técnico</label>
                  <input
                    id="api-name-campo"
                    className="form-input num !w-full sm:!w-96"
                    value={apiTocado ? draft.apiName : apiSugerido}
                    onChange={(e) => { setApiTocado(true); setDraft({ ...draft, apiName: e.target.value }); }}
                  />
                  <p className="text-[11px]" style={{ color: errores.apiName ? "var(--color-warning)" : "var(--text-tertiary)" }}>
                    {errores.apiName ?? "Se genera solo a partir de la etiqueta. Puedes ajustarlo ahora; una vez creado el campo no se puede cambiar."}
                  </p>
                </div>
              </details>
            </>
          )}
          {msg && <p className="text-[12px]" style={{ color: similar.length ? "var(--color-warning)" : "var(--text-secondary)" }}>{msg}</p>}
          {similar.length > 0 && (
            <div className="space-y-1">
              {similar.map((s) => (
                <p key={s.apiName} className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>· {s.label}</p>
              ))}
              <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={() => create(true)}>Crear de todos modos</button>
            </div>
          )}
          {paso === 1 ? (
            <button type="button" className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={siguiente}>
              Siguiente
            </button>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={() => { setPaso(1); setErrores({}); setMsg(""); setSimilar([]); }}>
                Atrás
              </button>
              <button type="submit" className="btn-primary !py-1.5 !px-3 text-[12px]">
                <Plus className="h-3.5 w-3.5" /> Crear campo
              </button>
            </div>
          )}
        </form>
      )}

      <div className="crm-card !p-0 overflow-hidden">
        <div className="px-4 py-3 hairline-b">
          <p className="text-[13px] font-semibold">Campos propios ({fields.length})</p>
        </div>
        {fields.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Aún no has agregado campos propios. Los campos estándar (nombre, teléfono…) se administran en Visibilidad de campos.
          </p>
        )}
        {fields.map((f, idx) => (
          <div key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 hairline-b">
            <div className="min-w-0">
              <p className="text-[13px]">
                <span className="font-medium" style={{ color: "var(--text-primary)" }}>{f.label}</span>
              </p>
              {f.helpText && <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{f.helpText}</p>}
              <div className="mt-0.5 flex gap-1.5">
                <span className="badge badge-neutral">{etiqueta(FIELD_TYPE_LABELS, f.fieldType)}</span>
                {f.isRequired && <span className="badge badge-warning">obligatorio</span>}
                {f.options.length > 0 && <span className="badge badge-neutral">{f.options.length} opciones</span>}
              </div>
            </div>
            {isAdmin && !f.isSystem && (
              <div className="flex items-center gap-2">
                <button title="Subir" aria-label="Subir" disabled={idx === 0} onClick={() => mover(idx, -1)} className="disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
                </button>
                <button title="Bajar" aria-label="Bajar" disabled={idx === fields.length - 1} onClick={() => mover(idx, 1)} className="disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
                </button>
                <button title="Editar" aria-label="Editar" onClick={() => setEditando(f)}>
                  <Pencil className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
                </button>
                <button title="Archivar (conserva valores)" aria-label="Archivar" onClick={() => archive(f.id)}>
                  <Archive className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {archivados.length > 0 && (
        <details className="crm-card !p-0 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">Archivados ({archivados.length})</summary>
          {archivados.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 hairline-b">
              <div className="min-w-0">
                <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{f.label}</p>
                <span className="badge badge-neutral">{etiqueta(FIELD_TYPE_LABELS, f.fieldType)}</span>
              </div>
              {isAdmin && (
                <button className="btn-secondary !py-1 !px-2.5 text-[12px]" onClick={() => restaurar(f)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                </button>
              )}
            </div>
          ))}
        </details>
      )}

      {editando && (
        <EditorCampo
          campo={editando}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); load(); }}
        />
      )}
    </div>
  );
}

// Modal de edición: etiqueta, ayuda, opciones de lista y permisos por rol.
// El tipo y el nombre técnico se muestran pero no cambian.
function EditorCampo({ campo, onClose, onSaved }: { campo: FieldDef; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(campo.label);
  const [helpText, setHelpText] = useState(campo.helpText ?? "");
  const [opciones, setOpciones] = useState<Array<{ value?: string; label: string }>>(
    campo.options.map((o) => ({ value: o.value, label: o.label }))
  );
  const original = useMemo(() => {
    const m: Record<string, Access> = {};
    for (const r of ROLES_PERMISOS) m[r] = campo.permissions?.find((p) => p.role === r)?.access ?? ACCESO_POR_DEFECTO;
    return m;
  }, [campo]);
  const [accesos, setAccesos] = useState<Record<string, Access>>(original);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const lista = ES_LISTA(campo.fieldType);

  function moverOpcion(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= opciones.length) return;
    const n = [...opciones];
    [n[i], n[j]] = [n[j], n[i]];
    setOpciones(n);
  }

  async function guardar() {
    setError("");
    if (!label.trim()) { setError("La etiqueta no puede quedar vacía"); return; }
    const body: Record<string, unknown> = { id: campo.id, label: label.trim(), helpText: helpText.trim() || null };
    if (lista) {
      const ops = construirOpciones(opciones);
      if (ops.length === 0) { setError("Agrega al menos una opción a la lista"); return; }
      body.options = ops;
    }
    const cambios = ROLES_PERMISOS.filter((r) => accesos[r] !== original[r]).map((role) => ({ role, access: accesos[role] }));
    if (cambios.length) body.permissions = cambios;
    setGuardando(true);
    const r = await patch(body);
    setGuardando(false);
    if (!r.ok) { setError(r.error ?? "No se pudo guardar"); return; }
    toast({ title: "Campo actualizado", description: label.trim() });
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar campo</DialogTitle>
          <DialogDescription>
            Tipo: {etiqueta(FIELD_TYPE_LABELS, campo.fieldType)}. El tipo y el nombre técnico no se pueden cambiar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[12px]" htmlFor="ed-label">Etiqueta</label>
            <input id="ed-label" className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <label className="text-[12px]" htmlFor="ed-ayuda">Texto de ayuda</label>
            <input id="ed-ayuda" className="form-input" placeholder="Opcional: aparece junto al campo" value={helpText} onChange={(e) => setHelpText(e.target.value)} />
          </div>

          {lista && (
            <div className="space-y-1.5">
              <p className="text-[12px]">Opciones de la lista</p>
              {opciones.map((o, i) => (
                <div key={o.value ?? `nueva-${i}`} className="flex items-center gap-1.5">
                  <input
                    className="form-input !py-1"
                    aria-label={`Opción ${i + 1}`}
                    value={o.label}
                    onChange={(e) => setOpciones(opciones.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                  />
                  <button type="button" aria-label="Subir opción" onClick={() => moverOpcion(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label="Bajar opción" onClick={() => moverOpcion(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" aria-label="Quitar opción" onClick={() => setOpciones(opciones.filter((_, k) => k !== i))}><X className="h-4 w-4" /></button>
                </div>
              ))}
              <button type="button" className="btn-secondary !py-1 !px-2.5 text-[12px]" onClick={() => setOpciones([...opciones, { label: "" }])}>
                <Plus className="h-3.5 w-3.5" /> Agregar opción
              </button>
              <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                Las opciones que quites dejan de ofrecerse, pero lo ya capturado se conserva.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-[12px]">Permisos por rol</p>
            <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              El administrador siempre edita. Por defecto los demás puestos solo leen este campo.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {ROLES_PERMISOS.map((r) => (
                <label key={r} className="flex items-center justify-between gap-2 text-[12px]">
                  <span>{etiqueta(ROLE_LABELS_COMPLETO, r)}</span>
                  <select
                    className="form-input !w-32 !py-1 text-[12px]"
                    value={accesos[r]}
                    onChange={(e) => setAccesos({ ...accesos, [r]: e.target.value as Access })}
                  >
                    {(Object.keys(ACCESS_LABELS) as Access[]).map((a) => <option key={a} value={a}>{ACCESS_LABELS[a]}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-[12px]" style={{ color: "var(--color-warning)" }}>{error}</p>}
        </div>
        <DialogFooter>
          <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary !py-1.5 !px-3 text-[12px] disabled:opacity-50" disabled={guardando} onClick={guardar}>
            Guardar cambios
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
