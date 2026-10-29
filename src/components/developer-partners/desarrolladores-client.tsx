"use client";

// ============================================================
// Empresas (antes «Desarrolladores», #872 → #949) — tabla + alta/edición
// ============================================================
// Todos consultan; ADMIN, DIRECTOR y GERENTE agregan y corrigen (el API lo vuelve a validar).
// Una celda sin dato muestra «-». Clic en una empresa → cuadro con sus contactos.

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TIPOS_EMPRESA,
  TIPO_EMPRESA_SIN_TIPO,
  celda,
  etiquetaTipoEmpresa,
  hrefSitio,
  type DesarrolladorFila,
} from "@/lib/developer-partners/shared";
import { EmpresaContactosDialog } from "./empresa-contactos-dialog";

interface Props {
  initial: DesarrolladorFila[];
  canEdit: boolean;
  /** `?empresa=` de la URL (liga desde la ficha del contacto): abre su cuadro al entrar. */
  abrirId?: string | null;
}

const COLUMNAS = ["Empresa", "Tipo", "Sitio web", "Email", "Teléfono"] as const;

/** Valor del filtro «Tipo de empresa» que no filtra. */
const TODOS_LOS_TIPOS = "__TODOS__";

/** Filas que pasan el filtro «Tipo de empresa». */
export function filtrarPorTipo(filas: readonly DesarrolladorFila[], tipo: string): DesarrolladorFila[] {
  if (tipo === TODOS_LOS_TIPOS) return [...filas];
  if (tipo === TIPO_EMPRESA_SIN_TIPO) return filas.filter((f) => !f.type);
  return filas.filter((f) => f.type === tipo);
}

export function DesarrolladoresClient({ initial, canEdit, abrirId = null }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [filas, setFilas] = useState<DesarrolladorFila[]>(initial);
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<DesarrolladorFila | null>(null);
  const [tipo, setTipo] = useState<string>(TODOS_LOS_TIPOS);
  const [verContactos, setVerContactos] = useState<DesarrolladorFila | null>(
    () => initial.find((f) => f.id === abrirId) ?? null,
  );

  // Una liga nueva desde la ficha (misma página, otro ?empresa=) también abre su cuadro.
  useEffect(() => {
    if (abrirId) setVerContactos(filas.find((f) => f.id === abrirId) ?? null);
  }, [abrirId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrarContactos = () => {
    setVerContactos(null);
    // Quita el ?empresa= para que recargar no vuelva a abrir el cuadro.
    if (abrirId) router.replace(pathname ?? "/empresas", { scroll: false });
  };

  const visibles = useMemo(() => filtrarPorTipo(filas, tipo), [filas, tipo]);
  const haySinTipo = filas.some((f) => !f.type);

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
        title="Empresas"
        meta={`${filas.length} ${filas.length === 1 ? "empresa" : "empresas"} · desarrolladoras, inmobiliarias y proveedores`}
        actions={
          canEdit ? (
            <Button size="sm" onClick={abrirNuevo}>
              <Plus className="mr-1 h-4 w-4" /> Agregar empresa
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="w-[220px]" aria-label="Tipo de empresa">
            <SelectValue placeholder="Tipo de empresa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS_LOS_TIPOS}>Todos los tipos</SelectItem>
            {TIPOS_EMPRESA.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
            {haySinTipo && <SelectItem value={TIPO_EMPRESA_SIN_TIPO}>Sin tipo</SelectItem>}
          </SelectContent>
        </Select>
        {tipo !== TODOS_LOS_TIPOS && (
          <span className="text-sm text-muted-foreground">
            {visibles.length} de {filas.length}
          </span>
        )}
      </div>

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
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={COLUMNAS.length + (canEdit ? 1 : 0)} className="px-4 py-10 text-center text-muted-foreground">
                  {filas.length === 0 ? (
                    <>
                      Todavía no hay empresas registradas.
                      {canEdit && " Usa «Agregar empresa» para dar de alta la primera."}
                    </>
                  ) : (
                    "No hay empresas de este tipo."
                  )}
                </td>
              </tr>
            ) : (
              visibles.map((f) => {
                const href = hrefSitio(f.website);
                return (
                  <tr
                    key={f.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-black/[0.02]"
                    style={{ borderColor: "var(--border-subtle)" }}
                    onClick={() => setVerContactos(f)}
                  >
                    <td className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        title="Ver los contactos de la empresa"
                        onClick={(e) => {
                          e.stopPropagation();
                          setVerContactos(f);
                        }}
                      >
                        {celda(f.name)}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={f.type ? undefined : "text-muted-foreground"}>{etiquetaTipoEmpresa(f.type)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
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
                        <a href={`mailto:${f.email}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
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
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirEdicion(f);
                          }}
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

      <EmpresaContactosDialog
        empresa={verContactos}
        onOpenChange={(v) => {
          if (!v) cerrarContactos();
        }}
      />

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
      type: String(fd.get("type") ?? "") || undefined,
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
      toast({ title: editando ? "Empresa actualizada" : "Empresa agregada" });
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
          <DialogTitle>{editando ? "Editar empresa" : "Agregar empresa"}</DialogTitle>
          <DialogDescription>El nombre y el tipo son obligatorios. Lo que dejes vacío se muestra como «-».</DialogDescription>
        </DialogHeader>
        {/* key: al cambiar de fila el formulario se monta de nuevo con sus valores */}
        <form key={editando?.id ?? "nuevo"} onSubmit={submit} className="space-y-4">
          <Campo id="name" label="Empresa (nombre)" defaultValue={editando?.name} required maxLength={200} />
          <div className="space-y-1.5">
            <Label htmlFor="dp-type">Tipo de empresa</Label>
            <select
              id="dp-type"
              name="type"
              required
              defaultValue={editando?.type ?? ""}
              className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm"
              style={{ borderColor: "var(--border-default, var(--border-subtle))" }}
            >
              <option value="" disabled>
                Elige un tipo…
              </option>
              {TIPOS_EMPRESA.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
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
