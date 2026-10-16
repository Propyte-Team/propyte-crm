// Botón «Descargar usuarios» de la lista de Contactos (#901). Abre una ventana para elegir qué
// datos del contacto incluir y descarga un CSV (abre en Excel) con todos los contactos que el
// usuario ve. El botón solo se muestra a ADMIN y DIRECTOR; la ruta vuelve a exigirlo.
"use client";

import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CAMPOS_EXPORTACION, nombreArchivoExport } from "@/lib/contacts/exportar";

/** La última selección se recuerda en el navegador (es una comodidad: si falla, da igual). */
const STORAGE_KEY = "contacts.exportar.campos.v1";

function seleccionInicial(): Set<string> {
  const porDefecto = CAMPOS_EXPORTACION.filter((c) => c.porDefecto).map((c) => c.key);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const guardadas = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(guardadas)) {
      const validas = guardadas.filter((k) => typeof k === "string" && CAMPOS_EXPORTACION.some((c) => c.key === k));
      if (validas.length > 0) return new Set(validas as string[]);
    }
  } catch {
    // sin storage o JSON corrupto: los de por defecto
  }
  return new Set(porDefecto);
}

export function ExportarContactos() {
  const [abierto, setAbierto] = useState(false);
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set());
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState("");

  const grupos = useMemo(() => {
    const m = new Map<string, typeof CAMPOS_EXPORTACION>();
    for (const c of CAMPOS_EXPORTACION) m.set(c.grupo, [...(m.get(c.grupo) ?? []), c]);
    return Array.from(m.entries());
  }, []);

  function onOpenChange(open: boolean) {
    setAbierto(open);
    if (open) {
      setElegidos(seleccionInicial());
      setError("");
    }
  }

  function toggle(key: string) {
    setElegidos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGrupo(keys: string[], marcar: boolean) {
    setElegidos((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (marcar) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  async function descargar() {
    // En el orden del catálogo, que es el orden de las columnas del archivo.
    const keys = CAMPOS_EXPORTACION.filter((c) => elegidos.has(c.key)).map((c) => c.key);
    if (keys.length === 0) return;
    setDescargando(true);
    setError("");
    try {
      const res = await fetch(`/api/contacts/export?campos=${encodeURIComponent(keys.join(","))}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "No se pudo generar el archivo");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreArchivoExport();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
      } catch {
        // la preferencia no se guarda; la descarga ya salió
      }
      setAbierto(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el archivo");
    } finally {
      setDescargando(false);
    }
  }

  const total = CAMPOS_EXPORTACION.length;

  return (
    <Dialog open={abierto} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Descargar usuarios
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Descargar contactos</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Elige qué datos incluir. Se descargan todos los contactos que puedes ver en el CRM, en un
          archivo CSV que abre en Excel. La descarga queda registrada.
        </p>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {elegidos.size} de {total} datos elegidos
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              className="font-medium hover:underline"
              onClick={() => setElegidos(new Set(CAMPOS_EXPORTACION.map((c) => c.key)))}
            >
              Elegir todos
            </button>
            <button type="button" className="font-medium hover:underline" onClick={() => setElegidos(new Set())}>
              Quitar todos
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {grupos.map(([grupo, campos]) => {
            const keys = campos.map((c) => c.key);
            const todos = keys.every((k) => elegidos.has(k));
            return (
              <fieldset key={grupo} className="space-y-1.5">
                <legend className="mb-1 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>{grupo}</span>
                  <button
                    type="button"
                    className="text-[11px] font-medium normal-case tracking-normal hover:underline"
                    onClick={() => toggleGrupo(keys, !todos)}
                  >
                    {todos ? "Quitar" : "Todos"}
                  </button>
                </legend>
                {campos.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={elegidos.has(c.key)} onChange={() => toggle(c.key)} />
                    {c.label}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setAbierto(false)} disabled={descargando}>
            Cancelar
          </Button>
          <Button onClick={descargar} disabled={descargando || elegidos.size === 0}>
            {descargando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Descargar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
