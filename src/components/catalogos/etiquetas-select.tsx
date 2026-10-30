// Etiquetas del contacto (#936): se eligen del catálogo, ya no se escriben separadas por coma.
// «Crear +» agrega una nueva al catálogo (y la elige); si ya existía con otra escritura
// («lead frio» → «LEAD FRIO»), se elige la existente y se avisa. Las etiquetas que el contacto ya
// tenía y no están en el catálogo (las ponen procesos automáticos) se muestran y se pueden quitar.
"use client";

import React from "react";
import { Loader2, Plus, Search, Tag, X } from "lucide-react";
import {
  ETIQUETA_MAX,
  buscarPorNombre,
  claveCatalogo,
  filtrarCatalogo,
  limpiarNombre,
  type OpcionCatalogo,
} from "@/lib/catalogos/clave";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  /** Tope de etiquetas por contacto (el de la API). */
  max?: number;
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-input, transparent)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};
const listaStyle: React.CSSProperties = {
  background: "var(--bg-card, #fff)",
  border: "1px solid var(--border-subtle)",
};

export function EtiquetasSelect({ value, onChange, disabled, max = 20 }: Props) {
  const [opciones, setOpciones] = React.useState<OpcionCatalogo[] | null>(null);
  const [puedeCrear, setPuedeCrear] = React.useState(false);
  const [errorCarga, setErrorCarga] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  // «Crear +»: nombre en captura (null = cerrado).
  const [nueva, setNueva] = React.useState<string | null>(null);
  const [guardando, setGuardando] = React.useState(false);
  const [aviso, setAviso] = React.useState("");
  const [errorAlta, setErrorAlta] = React.useState("");

  React.useEffect(() => {
    let cancel = false;
    fetch("/api/catalogos/etiquetas")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body) => {
        if (cancel) return;
        setOpciones((body.data ?? []) as OpcionCatalogo[]);
        setPuedeCrear(Boolean(body.puedeCrear));
      })
      .catch(() => {
        if (cancel) return;
        setErrorCarga(true);
        setOpciones([]);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const elegidas = new Set(value.map(claveCatalogo));
  const lleno = value.length >= max;
  const disponibles = filtrarCatalogo(opciones ?? [], query).filter((o) => !elegidas.has(claveCatalogo(o.name)));
  const textoLimpio = limpiarNombre(query);
  const ofrecerCrear =
    puedeCrear && !!textoLimpio && !buscarPorNombre(opciones ?? [], textoLimpio) && !elegidas.has(claveCatalogo(textoLimpio));

  const elegir = (nombre: string) => {
    if (lleno || elegidas.has(claveCatalogo(nombre))) return;
    onChange([...value, nombre]);
    setQuery("");
  };
  const quitar = (nombre: string) => onChange(value.filter((t) => t !== nombre));

  const crear = async (nombre: string) => {
    const name = limpiarNombre(nombre);
    if (!name) {
      setErrorAlta("Escribe el nombre de la etiqueta");
      return;
    }
    setGuardando(true);
    setErrorAlta("");
    setAviso("");
    try {
      const res = await fetch("/api/catalogos/etiquetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorAlta(typeof json.error === "string" ? json.error : "No se pudo crear la etiqueta");
        return;
      }
      const et = json.data as OpcionCatalogo;
      setOpciones((prev) => {
        const lista = prev ?? [];
        return lista.some((o) => o.id === et.id)
          ? lista
          : [...lista, et].sort((a, b) => a.name.localeCompare(b.name, "es"));
      });
      if (!json.creada) setAviso(`Ya existía «${et.name}»: se eligió esa.`);
      elegir(et.name);
      setNueva(null);
      setQuery("");
    } catch {
      setErrorAlta("Error de red al crear la etiqueta");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Etiquetas elegidas">
          {value.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px]"
              style={{ border: "1px solid var(--border-default, var(--border-subtle))", color: "var(--text-primary)" }}
            >
              <Tag className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
              {t}
              {!disabled && (
                <button type="button" onClick={() => quitar(t)} aria-label={`Quitar etiqueta ${t}`} className="ml-0.5">
                  <X className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2">
        <div
          className="relative min-w-0 flex-1"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
          }}
        >
          <div className="flex items-center gap-2 rounded-md px-3 py-2" style={inputStyle}>
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setAviso("");
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                // Enter elige la primera coincidencia (sin enviar el formulario).
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (disponibles[0]) elegir(disponibles[0].name);
                }
              }}
              disabled={disabled || lleno}
              placeholder={lleno ? `Máximo ${max} etiquetas` : "Buscar etiqueta"}
              aria-label="Buscar etiqueta"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
            {opciones === null && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
          </div>

          {open && opciones !== null && !lleno && (
            <ul
              role="listbox"
              tabIndex={-1}
              className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md py-1 shadow-md outline-none"
              style={listaStyle}
            >
              {errorCarga && <li className="px-3 py-2 text-[12px] text-destructive">No se pudieron cargar las etiquetas</li>}
              {disponibles.map((o) => (
                <li key={o.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      elegir(o.name);
                    }}
                    className="w-full px-3 py-2 text-left text-[13px] text-[color:var(--text-primary)] hover:bg-black/5"
                  >
                    {o.name}
                  </button>
                </li>
              ))}
              {ofrecerCrear && (
                <li>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      void crear(textoLimpio);
                    }}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] font-medium hover:bg-black/5"
                    style={{ color: "var(--color-teal, #0D9488)" }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Crear «{textoLimpio.slice(0, ETIQUETA_MAX)}»
                  </button>
                </li>
              )}
              {!errorCarga && disponibles.length === 0 && !ofrecerCrear && (
                <li className="px-3 py-2 text-[12px] text-[color:var(--text-tertiary)]">
                  {query ? "Sin coincidencias" : "No hay más etiquetas"}
                </li>
              )}
            </ul>
          )}
        </div>
        {puedeCrear && nueva === null && (
          <button
            type="button"
            onClick={() => {
              setNueva(textoLimpio);
              setErrorAlta("");
              setOpen(false);
            }}
            disabled={disabled}
            className="flex shrink-0 items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium disabled:opacity-50"
            style={{ border: "1px solid var(--border-subtle)", color: "var(--color-teal, #0D9488)" }}
          >
            Crear <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {nueva !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-md p-2" style={inputStyle}>
          <input
            type="text"
            autoFocus
            value={nueva}
            maxLength={ETIQUETA_MAX}
            onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void crear(nueva);
              }
              if (e.key === "Escape") setNueva(null);
            }}
            disabled={guardando}
            placeholder="Nombre de la etiqueta nueva"
            aria-label="Nombre de la etiqueta nueva"
            className="min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none"
          />
          <button
            type="button"
            onClick={() => setNueva(null)}
            disabled={guardando}
            className="rounded-md px-2.5 py-1 text-[12px] text-[color:var(--text-secondary)] hover:bg-black/5"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void crear(nueva)}
            disabled={guardando || !limpiarNombre(nueva)}
            className="rounded-md px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-60"
            style={{ background: "var(--color-teal, #0D9488)" }}
          >
            {guardando ? "Creando…" : "Crear y agregar"}
          </button>
        </div>
      )}
      {errorAlta && <p className="text-[12px] text-destructive">{errorAlta}</p>}
      {aviso && <p className="text-[12px] text-[color:var(--text-tertiary)]">{aviso}</p>}
    </div>
  );
}
