// Selector de empresa (#949): ficha del contacto y formulario de alta/edición.
// Busca entre las empresas del módulo «Empresas» (son pocas: se cargan una vez y se filtran aquí).
// Si la empresa no existe y el rol puede crear empresas (ADMIN, DIRECTOR, GERENTE), ofrece
// «Crear empresa “…”» ahí mismo, pidiendo el tipo. Un asesor elige, pero no crea.
"use client";

import React from "react";
import { Building2, Loader2, Plus, Search, X } from "lucide-react";
import {
  TIPOS_EMPRESA,
  etiquetaTipoEmpresa,
  filtrarEmpresas,
  ofrecerCrearEmpresa,
  type EmpresaOpcion,
} from "@/lib/developer-partners/shared";

interface Props {
  value: EmpresaOpcion | null;
  onChange: (empresa: EmpresaOpcion | null) => void;
  disabled?: boolean;
  placeholder?: string;
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

export function EmpresaSelect({ value, onChange, disabled, placeholder = "Buscar empresa" }: Props) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [empresas, setEmpresas] = React.useState<EmpresaOpcion[] | null>(null);
  const [puedeCrear, setPuedeCrear] = React.useState(false);
  const [errorCarga, setErrorCarga] = React.useState(false);
  // Alta rápida: nombre escrito + tipo elegido.
  const [nueva, setNueva] = React.useState<string | null>(null);
  const [tipoNuevo, setTipoNuevo] = React.useState("");
  const [guardando, setGuardando] = React.useState(false);
  const [errorAlta, setErrorAlta] = React.useState("");

  const cargar = React.useCallback(async () => {
    if (empresas !== null) return;
    try {
      const res = await fetch("/api/desarrolladores");
      if (!res.ok) throw new Error();
      const body = await res.json();
      setEmpresas(((body.data ?? []) as EmpresaOpcion[]).map(({ id, name, type }) => ({ id, name, type })));
      setPuedeCrear(Boolean(body.puedeEditar));
    } catch {
      setErrorCarga(true);
      setEmpresas([]);
    }
  }, [empresas]);

  const crear = async () => {
    if (!nueva || !tipoNuevo) {
      setErrorAlta("Elige el tipo de empresa");
      return;
    }
    setGuardando(true);
    setErrorAlta("");
    try {
      const res = await fetch("/api/desarrolladores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nueva, type: tipoNuevo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorAlta(typeof json.error === "string" ? json.error : "No se pudo crear la empresa");
        return;
      }
      const creada: EmpresaOpcion = { id: json.data.id, name: json.data.name, type: json.data.type ?? null };
      setEmpresas((prev) => [...(prev ?? []), creada].sort((a, b) => a.name.localeCompare(b.name, "es")));
      setNueva(null);
      setTipoNuevo("");
      setQuery("");
      onChange(creada);
    } catch {
      setErrorAlta("Error de red al crear la empresa");
    } finally {
      setGuardando(false);
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px]" style={inputStyle}>
        <Building2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
        <span className="min-w-0 flex-1 truncate">
          {value.name}
          {value.type && (
            <span className="ml-1.5 text-[12px] text-[color:var(--text-tertiary)]">· {etiquetaTipoEmpresa(value.type)}</span>
          )}
        </span>
        {!disabled && (
          <button type="button" onClick={() => onChange(null)} aria-label="Quitar empresa" className="shrink-0">
            <X className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
          </button>
        )}
      </div>
    );
  }

  if (nueva !== null) {
    return (
      <div className="space-y-2 rounded-md p-3 text-[13px]" style={inputStyle}>
        <p>
          Nueva empresa: <span className="font-medium">{nueva}</span>
        </p>
        <select
          aria-label="Tipo de empresa"
          value={tipoNuevo}
          onChange={(e) => setTipoNuevo(e.target.value)}
          disabled={guardando}
          className="w-full rounded-md bg-transparent px-2 py-1.5 text-[13px]"
          style={inputStyle}
        >
          <option value="">Tipo de empresa…</option>
          {TIPOS_EMPRESA.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {errorAlta && <p className="text-[12px] text-destructive">{errorAlta}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setNueva(null);
              setErrorAlta("");
            }}
            disabled={guardando}
            className="rounded-md px-2.5 py-1 text-[12px] text-[color:var(--text-secondary)] hover:bg-black/5"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={crear}
            disabled={guardando}
            className="rounded-md px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-60"
            style={{ background: "var(--color-teal, #0D9488)" }}
          >
            {guardando ? "Creando…" : "Crear y asignar"}
          </button>
        </div>
      </div>
    );
  }

  const lista = empresas ?? [];
  const resultados = filtrarEmpresas(lista, query);
  const conCrear = ofrecerCrearEmpresa(lista, query, puedeCrear);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md px-3 py-2" style={inputStyle}>
        <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            void cargar();
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Buscar empresa"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        {open && empresas === null && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
      </div>

      {open && empresas !== null && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md py-1 shadow-md" style={listaStyle}>
          {errorCarga && (
            <li className="px-3 py-2 text-[12px] text-destructive">No se pudieron cargar las empresas</li>
          )}
          {resultados.map((e) => (
            <li key={e.id} role="option" aria-selected={false}>
              {/* onMouseDown (no onClick): se dispara antes del blur del input, que cierra la lista. */}
              <button
                type="button"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  onChange(e);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-[color:var(--text-primary)] hover:bg-black/5"
              >
                <span className="truncate">{e.name}</span>
                <span className="shrink-0 text-[12px] text-[color:var(--text-tertiary)]">{etiquetaTipoEmpresa(e.type)}</span>
              </button>
            </li>
          ))}
          {conCrear && (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  setNueva(query.trim());
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] font-medium hover:bg-black/5"
                style={{ color: "var(--color-teal, #0D9488)" }}
              >
                <Plus className="h-3.5 w-3.5" /> Crear empresa «{query.trim()}»
              </button>
            </li>
          )}
          {!errorCarga && resultados.length === 0 && !conCrear && (
            <li className="px-3 py-2 text-[12px] text-[color:var(--text-tertiary)]">
              {puedeCrear
                ? "Escribe el nombre de la empresa"
                : "Sin resultados. Las empresas las dan de alta admin, dirección o gerencia."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
