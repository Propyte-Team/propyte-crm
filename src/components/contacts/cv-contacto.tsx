"use client";

// ============================================================
// #917 — CV del contacto, hasta arriba de la ficha.
// Sin CV: un botón discreto «Subir CV» (opcional). Con CV: una tarjeta con cada archivo
// (el más nuevo primero) y «Ver», «Descargar» y, a quien le toca, «Borrar».
// El archivo va DIRECTO del navegador al bucket privado (URL firmada); la API solo registra.
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, ExternalLink, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { CV_ACCEPT, extension, motivoRechazo, tamanoLegible } from "@/lib/contacts/archivos";

export interface ArchivoCv {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedByName: string | null;
  verUrl: string | null;
  descargarUrl: string | null;
  puedeBorrar: boolean;
}

type Estado = { cargando: boolean; archivos: ArchivoCv[]; puedeSubir: boolean; aviso: string | null };

export function CvContacto({ contactId }: { contactId: string }) {
  const [estado, setEstado] = useState<Estado>({ cargando: true, archivos: [], puedeSubir: false, aviso: null });
  const [subiendo, setSubiendo] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/contacts/${contactId}/files`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      // Sin migración se avisa; cualquier otro fallo deja solo el botón (la ficha no se rompe).
      setEstado({ cargando: false, archivos: [], puedeSubir: false, aviso: body.sinMigracion ? body.error : null });
      return;
    }
    setEstado({ cargando: false, archivos: body.data ?? [], puedeSubir: !!body.puedeSubir, aviso: null });
  }, [contactId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir(file: File) {
    setError(null);
    const mimeType = file.type || "application/octet-stream";
    const motivo = motivoRechazo({ fileName: file.name, mimeType, sizeBytes: file.size });
    if (motivo) {
      setError(motivo);
      return;
    }
    setSubiendo(true);
    try {
      const meta = { fileName: file.name, mimeType, sizeBytes: file.size };
      const firma = await fetch(`/api/contacts/${contactId}/files/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      const datos = await firma.json().catch(() => ({}));
      if (!firma.ok) {
        setError(typeof datos.error === "string" ? datos.error : "No se pudo preparar la subida");
        return;
      }
      // Subida DIRECTA a Supabase Storage (no pasa por el servidor del CRM).
      const put = await fetch(datos.data.signedUrl, { method: "PUT", headers: { "Content-Type": mimeType }, body: file });
      if (!put.ok) {
        setError("Falló la subida del archivo. Revisa tu conexión e intenta de nuevo.");
        return;
      }
      const confirma = await fetch(`/api/contacts/${contactId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...meta, path: datos.data.path }),
      });
      if (!confirma.ok) {
        const c = await confirma.json().catch(() => ({}));
        setError(typeof c.error === "string" ? c.error : "No se pudo registrar el archivo");
        return;
      }
      await cargar();
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  }

  async function borrar(a: ArchivoCv) {
    if (!window.confirm(`¿Borrar «${a.fileName}»? No se puede deshacer.`)) return;
    setError(null);
    setBorrando(a.id);
    try {
      const res = await fetch(`/api/contacts/${contactId}/files?fileId=${encodeURIComponent(a.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(typeof b.error === "string" ? b.error : "No se pudo borrar");
        return;
      }
      await cargar();
    } finally {
      setBorrando(null);
    }
  }

  if (estado.cargando) return null;
  return (
    <CvVista
      archivos={estado.archivos}
      puedeSubir={estado.puedeSubir}
      aviso={estado.aviso}
      subiendo={subiendo}
      borrando={borrando}
      error={error}
      onSubir={() => input.current?.click()}
      onBorrar={(a) => void borrar(a)}
      selector={
        <input
          ref={input}
          type="file"
          accept={CV_ACCEPT}
          className="hidden"
          aria-label="Elegir CV"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void subir(f);
          }}
        />
      }
    />
  );
}

export interface CvVistaProps {
  archivos: ArchivoCv[];
  puedeSubir: boolean;
  aviso: string | null;
  subiendo: boolean;
  borrando: string | null;
  error: string | null;
  onSubir: () => void;
  onBorrar: (a: ArchivoCv) => void;
  selector?: ReactNode;
}

/** Solo pinta (sin estado ni red): así se prueba cada caso con un render estático. */
export function CvVista({ archivos, puedeSubir, aviso, subiendo, borrando, error, onSubir, onBorrar, selector }: CvVistaProps) {
  if (aviso) {
    return <p className="text-[12px] text-[color:var(--text-tertiary)]">{aviso}</p>;
  }

  const botonSubir = (texto: string) => (
    <button type="button" className="btn-secondary text-[12px]" onClick={onSubir} disabled={subiendo} title="PDF o Word, hasta 10 MB">
      {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
      {subiendo ? "Subiendo…" : texto}
    </button>
  );
  const mensajeError = error && (
    <p role="alert" className="mt-2 text-[12px]" style={{ color: "var(--color-danger, #DC2626)" }}>
      {error}
    </p>
  );

  // Sin CV: solo el botón (opcional). Si el rol no puede subir, no se muestra nada.
  if (archivos.length === 0) {
    if (!puedeSubir) return null;
    return (
      <div data-testid="cv-vacio">
        {selector}
        {botonSubir("Subir CV")}
        {mensajeError}
      </div>
    );
  }

  return (
    <div className="crm-card" data-testid="cv-lista">
      {selector}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
          {archivos.length > 1 ? `CV (${archivos.length})` : "CV"}
        </h2>
        {puedeSubir && botonSubir("Subir otro")}
      </div>
      <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {archivos.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-[color:var(--text-tertiary)]" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium" title={a.fileName}>{a.fileName}</p>
                <p className="text-[11px] text-[color:var(--text-tertiary)]">
                  {extension(a.fileName).toUpperCase()} · {tamanoLegible(a.sizeBytes)} ·{" "}
                  {new Date(a.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                  {a.uploadedByName ? ` · ${a.uploadedByName}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {a.verUrl && (
                <a className="btn-secondary text-[12px]" href={a.verUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /> Ver
                </a>
              )}
              {a.descargarUrl && (
                <a className="btn-secondary text-[12px]" href={a.descargarUrl}>
                  <Download className="h-3.5 w-3.5" /> Descargar
                </a>
              )}
              {a.puedeBorrar && (
                <button
                  type="button"
                  className="btn-secondary text-[12px]"
                  onClick={() => onBorrar(a)}
                  disabled={borrando === a.id}
                  aria-label={`Borrar ${a.fileName}`}
                >
                  {borrando === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {mensajeError}
    </div>
  );
}
