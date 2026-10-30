// «Detalle de la fuente» del contacto (#937): campaña o evento elegido de un catálogo.
// «Crear +» da de alta una nueva (pide si es campaña o evento) y la elige; si ya existía con otra
// escritura, elige la existente y lo avisa.
"use client";

import React from "react";
import { CalendarDays, Loader2, Megaphone, Plus, Search, X } from "lucide-react";
import {
  CAMPANA_MAX,
  TIPOS_CAMPANA,
  buscarPorNombre,
  etiquetaTipoCampana,
  filtrarCatalogo,
  limpiarNombre,
} from "@/lib/catalogos/clave";

export interface CampanaOpcion {
  id: string;
  name: string;
  kind: string;
}

interface Props {
  value: CampanaOpcion | null;
  onChange: (c: CampanaOpcion | null) => void;
  disabled?: boolean;
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

function Icono({ kind, className }: { kind: string; className?: string }) {
  const Comp = kind === "EVENTO" ? CalendarDays : Megaphone;
  return <Comp className={className} style={{ color: "var(--text-tertiary)" }} />;
}

export function CampanaSelect({ value, onChange, disabled }: Props) {
  const [opciones, setOpciones] = React.useState<CampanaOpcion[] | null>(null);
  const [puedeCrear, setPuedeCrear] = React.useState(false);
  const [errorCarga, setErrorCarga] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [nueva, setNueva] = React.useState<string | null>(null);
  const [tipoNuevo, setTipoNuevo] = React.useState("");
  const [guardando, setGuardando] = React.useState(false);
  const [aviso, setAviso] = React.useState("");
  const [errorAlta, setErrorAlta] = React.useState("");

  React.useEffect(() => {
    let cancel = false;
    fetch("/api/catalogos/campanas")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body) => {
        if (cancel) return;
        setOpciones((body.data ?? []) as CampanaOpcion[]);
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

  const resultados = filtrarCatalogo(opciones ?? [], query);
  const textoLimpio = limpiarNombre(query);
  const ofrecerCrear = puedeCrear && !!textoLimpio && !buscarPorNombre(opciones ?? [], textoLimpio);

  const abrirAlta = (nombre: string) => {
    setNueva(nombre);
    setTipoNuevo("");
    setErrorAlta("");
    setAviso("");
    setOpen(false);
  };

  const crear = async () => {
    const name = limpiarNombre(nueva ?? "");
    if (!name) {
      setErrorAlta("Escribe el nombre de la campaña o evento");
      return;
    }
    if (!tipoNuevo) {
      setErrorAlta("Elige si es campaña o evento");
      return;
    }
    setGuardando(true);
    setErrorAlta("");
    try {
      const res = await fetch("/api/catalogos/campanas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: tipoNuevo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorAlta(typeof json.error === "string" ? json.error : "No se pudo crear");
        return;
      }
      const c = json.data as CampanaOpcion;
      setOpciones((prev) => {
        const lista = prev ?? [];
        return lista.some((o) => o.id === c.id) ? lista : [...lista, c].sort((a, b) => a.name.localeCompare(b.name, "es"));
      });
      if (!json.creada) setAviso(`Ya existía «${c.name}»: se eligió esa.`);
      setNueva(null);
      setQuery("");
      onChange(c);
    } catch {
      setErrorAlta("Error de red al crear la campaña o evento");
    } finally {
      setGuardando(false);
    }
  };

  if (nueva !== null) {
    return (
      <div className="space-y-2 rounded-md p-3 text-[13px]" style={inputStyle}>
        <input
          type="text"
          autoFocus
          value={nueva}
          maxLength={CAMPANA_MAX}
          onChange={(e) => setNueva(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void crear();
            }
            if (e.key === "Escape") setNueva(null);
          }}
          disabled={guardando}
          placeholder="Nombre: p. ej. «Preventa Tulum noviembre» o «Expo Mérida 2026»"
          aria-label="Nombre de la campaña o evento"
          className="w-full rounded-md bg-transparent px-2 py-1.5 text-[13px] outline-none"
          style={inputStyle}
        />
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo">
          {TIPOS_CAMPANA.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={tipoNuevo === t.value}
              onClick={() => {
                setTipoNuevo(t.value);
                setErrorAlta("");
              }}
              disabled={guardando}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium"
              style={
                tipoNuevo === t.value
                  ? { background: "var(--color-teal, #0D9488)", color: "#fff", border: "1px solid transparent" }
                  : { border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }
              }
            >
              <Icono kind={t.value} className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        {errorAlta && <p className="text-[12px] text-destructive">{errorAlta}</p>}
        <div className="flex justify-end gap-2">
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
            onClick={() => void crear()}
            disabled={guardando}
            className="rounded-md px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-60"
            style={{ background: "var(--color-teal, #0D9488)" }}
          >
            {guardando ? "Creando…" : "Crear y elegir"}
          </button>
        </div>
      </div>
    );
  }

  if (value) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px]" style={inputStyle}>
          <Icono kind={value.kind} className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {value.name}
            {value.kind && (
              <span className="ml-1.5 text-[12px] text-[color:var(--text-tertiary)]">· {etiquetaTipoCampana(value.kind)}</span>
            )}
          </span>
          {!disabled && (
            <button type="button" onClick={() => onChange(null)} aria-label="Quitar campaña o evento" className="shrink-0">
              <X className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
            </button>
          )}
        </div>
        {aviso && <p className="text-[12px] text-[color:var(--text-tertiary)]">{aviso}</p>}
      </div>
    );
  }

  return (
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
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (resultados[0]) {
                  onChange(resultados[0]);
                  setQuery("");
                  setOpen(false);
                }
              }
            }}
            disabled={disabled}
            placeholder="Buscar campaña o evento (opcional)"
            aria-label="Buscar campaña o evento"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
          {opciones === null && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
        </div>
        {open && opciones !== null && (
          <ul
            role="listbox"
            tabIndex={-1}
            className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md py-1 shadow-md outline-none"
            style={listaStyle}
          >
            {errorCarga && <li className="px-3 py-2 text-[12px] text-destructive">No se pudieron cargar las campañas</li>}
            {resultados.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    onChange(c);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[color:var(--text-primary)] hover:bg-black/5"
                >
                  <Icono kind={c.kind} className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-[11px] text-[color:var(--text-tertiary)]">{etiquetaTipoCampana(c.kind)}</span>
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
                    abrirAlta(textoLimpio);
                  }}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] font-medium hover:bg-black/5"
                  style={{ color: "var(--color-teal, #0D9488)" }}
                >
                  <Plus className="h-3.5 w-3.5" /> Crear «{textoLimpio.slice(0, CAMPANA_MAX)}»
                </button>
              </li>
            )}
            {!errorCarga && resultados.length === 0 && !ofrecerCrear && (
              <li className="px-3 py-2 text-[12px] text-[color:var(--text-tertiary)]">
                {query ? "Sin coincidencias" : "Todavía no hay campañas ni eventos"}
              </li>
            )}
          </ul>
        )}
      </div>
      {puedeCrear && (
        <button
          type="button"
          onClick={() => abrirAlta(textoLimpio)}
          disabled={disabled}
          className="flex shrink-0 items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium disabled:opacity-50"
          style={{ border: "1px solid var(--border-subtle)", color: "var(--color-teal, #0D9488)" }}
        >
          Crear <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
