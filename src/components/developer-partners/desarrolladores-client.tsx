"use client";

// ============================================================
// Desarrolladores (#872) — tabla + alta/edición
// ============================================================
// Todos consultan; ADMIN y DIRECTOR agregan y corrigen (el API lo vuelve a validar).
// Una celda sin dato muestra «-».

import { useState } from "react";
import { Plus, Pencil, ExternalLink } from "lucide-react";
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
import { celda, hrefSitio, type DesarrolladorFila } from "@/lib/developer-partners/shared";

interface Props {
  initial: DesarrolladorFila[];
  canEdit: boolean;
}

const COLUMNAS = ["Desarrollador", "Sitio web", "Email", "Teléfono"] as const;

export function DesarrolladoresClient({ initial, canEdit }: Props) {
  const [filas, setFilas] = useState<DesarrolladorFila[]>(initial);
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<DesarrolladorFila | null>(null);

  const abrirNuevo = () => {
    setEditando(null);
    setAbierto(true);
  };
  const abrirEdicion = (f: DesarrolladorFila) => {
    setEditando(f);
    setAbierto(true);
  };

  const guardado = (fila: DesarrolladorFila) => {
    setFilas((prev) => {
      const sin = prev.filter((p) => p.id !== fila.id);
      return [...sin, fila].sort((a, b) => a.name.localeCompare(b.name, "es"));
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ventas"
        title="Desarrolladores"
        meta={`${filas.length} ${filas.length === 1 ? "registro" : "registros"} · empresas inmobiliarias y aliados`}
        actions={
          canEdit ? (
            <Button size="sm" onClick={abrirNuevo}>
              <Plus className="mr-1 h-4 w-4" /> Agregar desarrollador
            </Button>
          ) : undefined
        }
      />

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-subtle)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground" style={{ borderColor: "var(--border-subtle)" }}>
              {COLUMNAS.map((c) => (
                <th key={c} className="whitespace-nowrap px-4 py-3 text-left font-medium">
                  {c}
                </th>
              ))}
              {canEdit && <th className="w-12 px-4 py-3" aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={COLUMNAS.length + (canEdit ? 1 : 0)} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no hay desarrolladores registrados.
                  {canEdit && " Usa «Agregar desarrollador» para dar de alta el primero."}
                </td>
              </tr>
            ) : (
              filas.map((f) => {
                const href = hrefSitio(f.website);
                return (
                  <tr key={f.id} className="border-b last:border-0" style={{ borderColor: "var(--border-subtle)" }}>
                    <td className="px-4 py-3 font-medium">{celda(f.name)}</td>
                    <td className="px-4 py-3">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:underline"
                          style={{ color: "var(--color-teal)" }}
                        >
                          {celda(f.website)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{celda(f.website)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {f.email ? (
                        <a href={`mailto:${f.email}`} className="hover:underline">
                          {celda(f.email)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{celda(f.email)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={f.phone ? undefined : "text-muted-foreground"}>{celda(f.phone)}</span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          title="Editar"
                          onClick={() => abrirEdicion(f)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <DesarrolladorDialog
          open={abierto}
          onOpenChange={setAbierto}
          editando={editando}
          onGuardado={guardado}
        />
      )}
    </div>
  );
}

// --------------- formulario ---------------

function DesarrolladorDialog({
  open,
  onOpenChange,
  editando,
  onGuardado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editando: DesarrolladorFila | null;
  onGuardado: (f: DesarrolladorFila) => void;
}) {
  const { toast } = useToast();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get("name") ?? ""),
      website: String(fd.get("website") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
    };
    setGuardando(true);
    setError("");
    try {
      const res = await fetch(editando ? `/api/desarrolladores/${editando.id}` : "/api/desarrolladores", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(mensajeDeError(json, "No se pudo guardar"));
        return;
      }
      onGuardado(json.data);
      toast({ title: editando ? "Desarrollador actualizado" : "Desarrollador agregado" });
      onOpenChange(false);
    } catch {
      setError("Error de red al guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setError(""); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar desarrollador" : "Agregar desarrollador"}</DialogTitle>
          <DialogDescription>Solo el nombre es obligatorio. Lo que dejes vacío se muestra como «-».</DialogDescription>
        </DialogHeader>
        {/* key: al cambiar de fila el formulario se monta de nuevo con sus valores */}
        <form key={editando?.id ?? "nuevo"} onSubmit={submit} className="space-y-4">
          <Campo id="name" label="Desarrollador (nombre)" defaultValue={editando?.name} required maxLength={200} />
          <Campo id="website" label="Sitio web" defaultValue={editando?.website} placeholder="ejemplo.com" maxLength={300} />
          <Campo id="email" label="Email" type="email" defaultValue={editando?.email} maxLength={254} />
          <Campo id="phone" label="Teléfono" type="tel" defaultValue={editando?.phone} maxLength={40} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
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
  ...rest
}: { id: string; label: string; defaultValue?: string | null } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "id" | "name">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`dp-${id}`}>{label}</Label>
      <Input id={`dp-${id}`} name={id} defaultValue={defaultValue ?? ""} {...rest} />
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
