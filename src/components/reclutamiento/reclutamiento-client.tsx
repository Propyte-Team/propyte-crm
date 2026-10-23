"use client";

// ============================================================
// Reclutamiento (#926) — tabla de candidatos + alta/edición + CV
// ============================================================
// Solo llegan aquí ADMIN, DIRECTOR y GERENTE (la página y la API lo vuelven a validar).
// Una celda sin dato muestra «-». La etapa se cambia directo en la tabla.
// El CV va DIRECTO del navegador al bucket privado (URL firmada); la API solo lo registra.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, ExternalLink, FileText, Trash2, Loader2, Search, Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  AREAS_SUGERIDAS,
  CV_ACCEPT,
  ETAPAS,
  ETAPAS_CERRADAS,
  UBICACIONES,
  celda,
  etapa,
  filtrarCandidatos,
  hrefSitio,
  motivoRechazo,
  tamanoLegible,
  ubicacionLabel,
  type CandidatoFila,
  type EtapaCode,
} from "@/lib/reclutamiento/shared";

interface Props {
  initial: CandidatoFila[];
  sinMigracion?: boolean;
  puedeEliminar: boolean;
}

// Etapa va justo después del nombre (como en la base de Notion): es lo que más se consulta y así
// no queda escondida al final de una tabla que en laptop necesita scroll horizontal.
export const COLUMNAS = [
  "Nombre completo",
  "Etapa",
  "Edad",
  "Correo",
  "Teléfono",
  "Área/Puesto",
  "CV",
  "Portafolio",
  "Ubicación",
  "Notas",
] as const;

const urlCv = (candidatoId: string, fileId: string, descargar = false) =>
  `/api/reclutamiento/${candidatoId}/files/${fileId}${descargar ? "?descargar=1" : ""}`;

/** «https://www.behance.net/ana/» → «behance.net/ana»: lo que se lee en la celda. */
export function textoPortafolio(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

export function ReclutamientoClient({ initial, sinMigracion = false, puedeEliminar }: Props) {
  const { toast } = useToast();
  const [filas, setFilas] = useState<CandidatoFila[]>(initial);
  const [texto, setTexto] = useState("");
  const [filtroEtapa, setFiltroEtapa] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<CandidatoFila | null>(null);

  const visibles = useMemo(
    () => filtrarCandidatos(filas, { texto, etapa: filtroEtapa, ubicacion: filtroUbicacion }),
    [filas, texto, filtroEtapa, filtroUbicacion]
  );
  const enProceso = filas.filter((f) => !ETAPAS_CERRADAS.includes(f.stage as EtapaCode)).length;

  const recargar = async () => {
    const res = await fetch("/api/reclutamiento").catch(() => null);
    const json = res?.ok ? await res.json().catch(() => null) : null;
    if (json?.data) setFilas(json.data);
  };

  const reemplazar = (fila: CandidatoFila) =>
    setFilas((prev) => (prev.some((p) => p.id === fila.id) ? prev.map((p) => (p.id === fila.id ? fila : p)) : [fila, ...prev]));

  const cambiarEtapa = async (fila: CandidatoFila, stage: string) => {
    if (stage === fila.stage) return;
    reemplazar({ ...fila, stage }); // optimista
    const res = await fetch(`/api/reclutamiento/${fila.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    }).catch(() => null);
    if (!res?.ok) {
      reemplazar(fila);
      toast({ title: "No se pudo cambiar la etapa", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Desempeño"
        title="Reclutamiento"
        meta={`${filas.length} ${filas.length === 1 ? "candidato" : "candidatos"} · ${enProceso} en proceso`}
        actions={
          !sinMigracion ? (
            <Button size="sm" onClick={() => { setEditando(null); setAbierto(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Agregar candidato
            </Button>
          ) : undefined
        }
      />

      {sinMigracion && (
        <p role="alert" className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--border-default)" }}>
          Falta aplicar la migración de Reclutamiento en la base de datos. Avisa a sistemas.
        </p>
      )}

      {/* Filtros: etapa como chips con conteo (como las vistas de Notion), texto y ubicación */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar nombre, correo, teléfono…"
            className="h-9 pl-8"
            aria-label="Buscar candidatos"
          />
        </div>
        <select
          value={filtroUbicacion}
          onChange={(e) => setFiltroUbicacion(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Filtrar por ubicación"
        >
          <option value="">Todas las ubicaciones</option>
          {UBICACIONES.map((u) => (
            <option key={u.code} value={u.code}>{u.label}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por etapa">
        <ChipEtapa activo={filtroEtapa === ""} onClick={() => setFiltroEtapa("")} label="Todas" n={filas.length} />
        {ETAPAS.map((e) => {
          const n = filas.filter((f) => f.stage === e.code).length;
          return (
            <ChipEtapa
              key={e.code}
              activo={filtroEtapa === e.code}
              onClick={() => setFiltroEtapa(filtroEtapa === e.code ? "" : e.code)}
              label={e.label}
              n={n}
              color={e.color}
            />
          );
        })}
      </div>

      <TablaCandidatos
        filas={visibles}
        hayFiltro={visibles.length !== filas.length}
        sinMigracion={sinMigracion}
        onEditar={(f) => { setEditando(f); setAbierto(true); }}
        onEtapa={(f, s) => void cambiarEtapa(f, s)}
      />

      <CandidatoDialog
        open={abierto}
        onOpenChange={setAbierto}
        editando={editando}
        puedeEliminar={puedeEliminar}
        onGuardado={async (fila, { recargarTodo }) => {
          reemplazar(fila);
          if (recargarTodo) await recargar();
        }}
        onEliminado={(id) => setFilas((prev) => prev.filter((p) => p.id !== id))}
      />
    </div>
  );
}

function ChipEtapa({ activo, onClick, label, n, color }: { activo: boolean; onClick: () => void; label: string; n: number; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors"
      style={{
        borderColor: activo ? (color ?? "var(--text-primary)") : "var(--border-subtle)",
        background: activo ? `${color ?? "#64748B"}1F` : "transparent",
      }}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      <span>{label}</span>
      <span className="num text-muted-foreground">{n}</span>
    </button>
  );
}

// --------------- tabla (solo pinta: se prueba con render estático) ---------------

export function TablaCandidatos({
  filas,
  hayFiltro = false,
  sinMigracion = false,
  onEditar,
  onEtapa,
}: {
  filas: CandidatoFila[];
  hayFiltro?: boolean;
  sinMigracion?: boolean;
  onEditar: (f: CandidatoFila) => void;
  onEtapa: (f: CandidatoFila, stage: string) => void;
}) {
  const fondo = { background: "var(--bg-card)" };
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-subtle)", ...fondo }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground" style={{ borderColor: "var(--border-subtle)" }}>
            {COLUMNAS.map((c, i) => (
              <th
                key={c}
                className={`whitespace-nowrap px-3 py-3 text-left font-medium${i === 0 ? " sticky left-0 z-10" : ""}`}
                style={i === 0 ? fondo : undefined}
              >
                {c}
              </th>
            ))}
            <th className="w-10 px-2 py-3" aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr>
              <td colSpan={COLUMNAS.length + 1} className="px-4 py-10 text-center text-muted-foreground">
                {sinMigracion
                  ? "Sin datos: el módulo aún no está listo en la base de datos."
                  : hayFiltro
                  ? "Ningún candidato coincide con el filtro."
                  : "Todavía no hay candidatos. Usa «Agregar candidato» para registrar el primero."}
              </td>
            </tr>
          ) : (
            filas.map((f) => <FilaCandidato key={f.id} f={f} fondo={fondo} onEditar={onEditar} onEtapa={onEtapa} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

function Vacio() {
  return <span className="text-muted-foreground">-</span>;
}

function FilaCandidato({
  f,
  fondo,
  onEditar,
  onEtapa,
}: {
  f: CandidatoFila;
  fondo: React.CSSProperties;
  onEditar: (f: CandidatoFila) => void;
  onEtapa: (f: CandidatoFila, stage: string) => void;
}) {
  const portafolio = hrefSitio(f.portfolioUrl);
  const ubicacion = ubicacionLabel(f.plaza);
  const e = etapa(f.stage);
  return (
    <tr className="border-b align-top last:border-0" style={{ borderColor: "var(--border-subtle)" }}>
      <td className="sticky left-0 z-10 min-w-[180px] max-w-[240px] px-3 py-2.5 font-medium" style={fondo}>
        <button type="button" className="text-left hover:underline" onClick={() => onEditar(f)}>
          {celda(f.fullName)}
        </button>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <select
          value={f.stage}
          onChange={(ev) => onEtapa(f, ev.target.value)}
          aria-label={`Etapa de ${f.fullName}`}
          className="cursor-pointer rounded-md border-0 px-2 py-1 text-xs font-medium text-white"
          style={{ background: e?.color ?? "#6B7280" }}
        >
          {!e && <option value={f.stage}>{f.stage}</option>}
          {ETAPAS.map((x) => (
            <option key={x.code} value={x.code} style={{ background: "var(--bg-card)", color: "var(--text-primary)" }}>
              {x.label}
            </option>
          ))}
        </select>
      </td>
      <td className="num whitespace-nowrap px-3 py-2.5">{f.age != null ? f.age : <Vacio />}</td>
      <td className="px-3 py-2.5">
        {f.email ? (
          <a href={`mailto:${f.email}`} className="hover:underline">{f.email}</a>
        ) : (
          <Vacio />
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {f.phone ? <a href={`tel:${f.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{f.phone}</a> : <Vacio />}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">{f.area ? f.area : <Vacio />}</td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {f.cvs.length > 0 ? (
          <a
            href={urlCv(f.id, f.cvs[0].id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: "var(--color-teal)" }}
            title={f.cvs[0].fileName}
          >
            <FileText className="h-3.5 w-3.5" /> Ver CV{f.cvs.length > 1 ? ` (${f.cvs.length})` : ""}
          </a>
        ) : (
          <Vacio />
        )}
      </td>
      <td className="max-w-[200px] px-3 py-2.5">
        {portafolio ? (
          <a
            href={portafolio}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 hover:underline"
            style={{ color: "var(--color-teal)" }}
            title={f.portfolioUrl ?? undefined}
          >
            <span className="truncate">{textoPortafolio(f.portfolioUrl ?? "")}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          <Vacio />
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">{ubicacion ?? <Vacio />}</td>
      <td className="min-w-[160px] max-w-[240px] px-3 py-2.5">
        {f.notes ? (
          <span className="line-clamp-2 whitespace-pre-line" title={f.notes}>{f.notes}</span>
        ) : (
          <Vacio />
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Editar" aria-label={`Editar ${f.fullName}`} onClick={() => onEditar(f)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

// --------------- subida de CV (3 pasos, igual que la ficha de contacto #917) ---------------

/** null si salió bien; si no, el motivo en palabras para la persona. */
export async function subirCv(candidatoId: string, file: File): Promise<string | null> {
  const mimeType = file.type || "application/octet-stream";
  const meta = { fileName: file.name, mimeType, sizeBytes: file.size };
  const motivo = motivoRechazo(meta);
  if (motivo) return motivo;
  try {
    const firma = await fetch(`/api/reclutamiento/${candidatoId}/files/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    const datos = await firma.json().catch(() => ({}));
    if (!firma.ok) return typeof datos.error === "string" ? datos.error : "No se pudo preparar la subida";
    // Subida DIRECTA a Supabase Storage (no pasa por el servidor del CRM).
    const put = await fetch(datos.data.signedUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: file });
    if (!put.ok) return "Falló la subida del CV. Revisa tu conexión e intenta de nuevo.";
    const confirma = await fetch(`/api/reclutamiento/${candidatoId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...meta, path: datos.data.path }),
    });
    if (!confirma.ok) {
      const c = await confirma.json().catch(() => ({}));
      return typeof c.error === "string" ? c.error : "No se pudo registrar el CV";
    }
    return null;
  } catch {
    return "Error de red al subir el CV";
  }
}

// --------------- formulario ---------------

type CvDetalle = {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  source: string;
  uploadedByName: string | null;
  puedeBorrar: boolean;
};

function CandidatoDialog({
  open,
  onOpenChange,
  editando,
  puedeEliminar,
  onGuardado,
  onEliminado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editando: CandidatoFila | null;
  puedeEliminar: boolean;
  onGuardado: (f: CandidatoFila, o: { recargarTodo: boolean }) => Promise<void>;
  onEliminado: (id: string) => void;
}) {
  const { toast } = useToast();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [cvs, setCvs] = useState<CvDetalle[] | null>(null);
  const [borrandoCv, setBorrandoCv] = useState<string | null>(null);
  const archivo = useRef<HTMLInputElement>(null);

  const cargarCvs = async (id: string) => {
    const res = await fetch(`/api/reclutamiento/${id}/files`).catch(() => null);
    const json = res?.ok ? await res.json().catch(() => null) : null;
    setCvs(json?.data ?? []);
  };

  const alAbrir = (v: boolean) => {
    if (!v) { setError(""); setCvs(null); }
    onOpenChange(v);
  };

  // Al abrir una edición, se piden los CV con quién los subió y si se pueden borrar.
  const editId = editando?.id ?? null;
  useEffect(() => {
    if (!open || !editId) return;
    setCvs(null);
    void cargarCvs(editId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cargarCvs solo usa setCvs (estable)
  }, [open, editId]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      fullName: String(fd.get("fullName") ?? ""),
      age: String(fd.get("age") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      area: String(fd.get("area") ?? ""),
      plaza: String(fd.get("plaza") ?? ""),
      portfolioUrl: String(fd.get("portfolioUrl") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      stage: String(fd.get("stage") ?? "RECIBIDO"),
    };
    const file = archivo.current?.files?.[0] ?? null;
    if (file) {
      const motivo = motivoRechazo({ fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size });
      if (motivo) { setError(motivo); return; }
    }
    setGuardando(true);
    setError("");
    try {
      const res = await fetch(editando ? `/api/reclutamiento/${editando.id}` : "/api/reclutamiento", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(mensajeDeError(json, "No se pudo guardar")); return; }
      const fila: CandidatoFila = json.data;
      let errorCv: string | null = null;
      if (file) errorCv = await subirCv(fila.id, file);
      await onGuardado(fila, { recargarTodo: !!file && !errorCv });
      if (errorCv) {
        // El candidato ya quedó guardado: se avisa que el CV no subió (se puede reintentar al editar).
        toast({ title: "Candidato guardado, pero el CV no se subió", description: errorCv, variant: "destructive" });
        alAbrir(false);
        return;
      }
      toast({ title: editando ? "Candidato actualizado" : "Candidato agregado" });
      alAbrir(false);
    } catch {
      setError("Error de red al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const borrarCv = async (cv: CvDetalle) => {
    if (!editando || !window.confirm(`¿Borrar «${cv.fileName}»? No se puede deshacer.`)) return;
    setBorrandoCv(cv.id);
    try {
      const res = await fetch(`/api/reclutamiento/${editando.id}/files?fileId=${encodeURIComponent(cv.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(typeof b.error === "string" ? b.error : "No se pudo borrar el CV");
        return;
      }
      await cargarCvs(editando.id);
      await onGuardado({ ...editando, cvs: editando.cvs.filter((c) => c.id !== cv.id) }, { recargarTodo: false });
    } finally {
      setBorrandoCv(null);
    }
  };

  const eliminar = async () => {
    if (!editando || !window.confirm(`¿Eliminar a «${editando.fullName}» de Reclutamiento? También se borran sus CV.`)) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/reclutamiento/${editando.id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(typeof b.error === "string" ? b.error : "No se pudo eliminar");
        return;
      }
      onEliminado(editando.id);
      toast({ title: "Candidato eliminado" });
      alAbrir(false);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={alAbrir}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar candidato" : "Agregar candidato"}</DialogTitle>
          <DialogDescription>Solo el nombre es obligatorio. Lo que dejes vacío se muestra como «-».</DialogDescription>
        </DialogHeader>
        {/* key: al cambiar de candidato el formulario se monta de nuevo con sus valores */}
        <form key={editando?.id ?? "nuevo"} onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="fullName" label="Nombre completo" defaultValue={editando?.fullName} required maxLength={200} className="sm:col-span-2" />
            <Campo id="age" label="Edad" type="number" min={14} max={99} inputMode="numeric" defaultValue={editando?.age != null ? String(editando.age) : ""} />
            <Campo id="email" label="Correo" type="email" defaultValue={editando?.email} maxLength={254} />
            <Campo id="phone" label="Número telefónico" type="tel" defaultValue={editando?.phone} maxLength={40} />
            <Campo id="area" label="Área/Puesto" defaultValue={editando?.area} maxLength={120} list="reclutamiento-areas" placeholder="Marketing, Asesor / Ventas, Sistemas…" />
            <datalist id="reclutamiento-areas">
              {AREAS_SUGERIDAS.map((a) => <option key={a} value={a} />)}
            </datalist>
            <div className="space-y-1.5">
              <Label htmlFor="rc-plaza">Ubicación</Label>
              <select id="rc-plaza" name="plaza" defaultValue={editando?.plaza ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">-</option>
                {UBICACIONES.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-stage">Etapa</Label>
              <select id="rc-stage" name="stage" defaultValue={editando?.stage ?? "RECIBIDO"} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {ETAPAS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </select>
            </div>
            <Campo id="portfolioUrl" label="Portafolio (página oficial o personal)" defaultValue={editando?.portfolioUrl} maxLength={500} placeholder="behance.net/usuario" className="sm:col-span-2" />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rc-notes">Notas</Label>
              <textarea
                id="rc-notes"
                name="notes"
                rows={3}
                maxLength={5000}
                defaultValue={editando?.notes ?? ""}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* CV */}
          <div className="space-y-2 rounded-md border p-3" style={{ borderColor: "var(--border-subtle)" }}>
            <Label htmlFor="rc-cv">{editando ? "Agregar otro CV" : "CV"} <span className="font-normal text-muted-foreground">(PDF o Word, hasta 10 MB)</span></Label>
            <input ref={archivo} id="rc-cv" type="file" accept={CV_ACCEPT} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm" />
            {editando && cvs === null && <p className="text-xs text-muted-foreground">Cargando CV…</p>}
            {editando && cvs && cvs.length > 0 && (
              <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {cvs.map((cv) => (
                  <li key={cv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium" title={cv.fileName}>{cv.fileName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {tamanoLegible(cv.sizeBytes)} · {new Date(cv.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                        {cv.source === "CHAT" ? " · llegó por chat" : cv.uploadedByName ? ` · ${cv.uploadedByName}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <a className="btn-secondary text-[12px]" href={urlCv(editando.id, cv.id)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" /> Ver
                      </a>
                      <a className="btn-secondary text-[12px]" href={urlCv(editando.id, cv.id, true)}>
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      {cv.puedeBorrar && (
                        <button type="button" className="btn-secondary text-[12px]" onClick={() => void borrarCv(cv)} disabled={borrandoCv === cv.id} aria-label={`Borrar ${cv.fileName}`}>
                          {borrandoCv === cv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-between sm:gap-0">
            <div>
              {editando && puedeEliminar && (
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => void eliminar()} disabled={guardando}>
                  <Trash2 className="mr-1 h-4 w-4" /> Eliminar candidato
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => alAbrir(false)} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  id,
  label,
  defaultValue,
  className,
  ...rest
}: { id: string; label: string; defaultValue?: string | null; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "id" | "name" | "className">) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={`rc-${id}`}>{label}</Label>
      <Input id={`rc-${id}`} name={id} defaultValue={defaultValue ?? ""} {...rest} />
    </div>
  );
}

function mensajeDeError(data: unknown, fallback: string): string {
  const error = (data as { error?: unknown } | null)?.error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const { formErrors, fieldErrors } = error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    const partes = [...(formErrors ?? []), ...Object.values(fieldErrors ?? {}).flat()];
    if (partes.length) return partes.join(" · ");
  }
  return fallback;
}
