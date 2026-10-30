// Buscador de contacto para la captura de la Agenda (HUB #841). Reusa GET /api/contacts?search=,
// que ya aplica el alcance por rol, así que el asesor solo encuentra contactos que puede ver.
// #907: lo usa también «Referido por» en el formulario de contacto, acotado a tipo Broker.
// #935: con `catalogo="brokers"` lee GET /api/contacts/brokers (todos los brokers, no solo los
// del alcance de quien edita) de 30 en 30, y carga más al bajar por la lista.
"use client";

import React from "react";
import { Loader2, Search, User, X } from "lucide-react";

export interface PickedContact {
  id: string;
  name: string;
}

interface ContactRow {
  id: string;
  firstName: string;
  lastName: string;
}

/** Una opción ya lista para pintar: la API de contactos da nombre y apellido; la de brokers, `name`. */
interface Opcion {
  id: string;
  name: string;
}

interface ContactPickerProps {
  value: PickedContact | null;
  onChange: (contact: PickedContact | null) => void;
  disabled?: boolean;
  /** Solo contactos de este tipo (`?type=` de la API), p. ej. "BROKER_EXTERNO". */
  tipo?: string;
  /** No ofrecer este contacto (el propio, al ligar un referido a su broker). */
  excluirId?: string;
  /** Con `tipo`, mostrar los primeros resultados al enfocar, sin escribir nada. */
  listarSinTexto?: boolean;
  /**
   * #935: «brokers» = catálogo de «Registrado por» (GET /api/contacts/brokers). Lista al enfocar,
   * pagina al bajar y no depende del alcance por rol. Ignora `tipo` y `listarSinTexto`.
   */
  catalogo?: "brokers";
  placeholder?: string;
}

/** Distancia al fondo de la lista (px) a la que se pide la siguiente página. */
const CARGAR_MAS_PX = 48;

const inputStyle: React.CSSProperties = {
  background: "var(--bg-input, transparent)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};

export function ContactPicker({
  value,
  onChange,
  disabled,
  tipo,
  excluirId,
  listarSinTexto = false,
  catalogo,
  placeholder = "Ligar a un contacto (opcional)",
}: ContactPickerProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Opcion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  // #935: paginación del catálogo de brokers.
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const [total, setTotal] = React.useState<number | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  // La consulta vigente: una página que llega de una búsqueda ya superada se descarta.
  const consultaRef = React.useRef(0);

  const esCatalogo = catalogo === "brokers";
  // Búsqueda con debounce; `cancelled` descarta respuestas de una consulta ya superada.
  // Con `listarSinTexto` (o el catálogo) se busca desde 0 letras (al enfocar); si no, desde 2.
  const minimo = listarSinTexto || esCatalogo ? 0 : 2;
  // Sin texto solo se busca con la lista abierta; en el modo de siempre, `open` no cuenta
  // (así la Agenda no vuelve a pedir resultados cada vez que el campo pierde el foco).
  const activo = listarSinTexto || esCatalogo ? open : true;

  const pedir = React.useCallback(
    async (term: string, pagina: number): Promise<{ filas: Opcion[]; hasMore: boolean; total: number | null }> => {
      if (esCatalogo) {
        const params = new URLSearchParams({ page: String(pagina) });
        if (term) params.set("search", term);
        if (excluirId) params.set("excluir", excluirId);
        const res = await fetch(`/api/contacts/brokers?${params.toString()}`);
        if (!res.ok) throw new Error("search failed");
        const body = await res.json();
        return { filas: (body.data ?? []) as Opcion[], hasMore: Boolean(body.hasMore), total: body.total ?? null };
      }
      const params = new URLSearchParams({ pageSize: "8" });
      if (term) params.set("search", term);
      if (tipo) params.set("type", tipo);
      const res = await fetch(`/api/contacts?${params.toString()}`);
      if (!res.ok) throw new Error("search failed");
      const body = await res.json();
      const filas = ((body.data ?? []) as ContactRow[])
        .filter((c) => c.id !== excluirId)
        .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() }));
      return { filas, hasMore: false, total: null };
    },
    [esCatalogo, excluirId, tipo],
  );

  React.useEffect(() => {
    const term = query.trim();
    const consulta = ++consultaRef.current;
    if (term.length < minimo || !activo) {
      setResults([]);
      setHasMore(false);
      setTotal(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await pedir(term, 1);
        if (!cancelled && consulta === consultaRef.current) {
          setResults(r.filas);
          setPage(1);
          setHasMore(r.hasMore);
          setTotal(r.total);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activo, minimo, pedir]);

  // #935: siguiente página al acercarse al fondo de la lista. Se agrega sin repetir ids.
  async function cargarMas() {
    if (!esCatalogo || !hasMore || loadingMore || loading) return;
    const consulta = consultaRef.current;
    setLoadingMore(true);
    try {
      const r = await pedir(query.trim(), page + 1);
      if (consulta !== consultaRef.current) return;
      setResults((prev) => {
        const vistos = new Set(prev.map((o) => o.id));
        return [...prev, ...r.filas.filter((o) => !vistos.has(o.id))];
      });
      setPage((p) => p + 1);
      setHasMore(r.hasMore);
      setTotal(r.total);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  function onScrollLista(e: React.UIEvent<HTMLUListElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < CARGAR_MAS_PX) void cargarMas();
  }

  if (value) {
    return (
      <div
        className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px]"
        style={inputStyle}
      >
        <User className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
        <span className="min-w-0 flex-1 truncate">{value.name}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Quitar contacto"
          className="shrink-0 disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative"
      // La lista se cierra cuando el foco sale del componente, no del input: así arrastrar la
      // barra de scroll de la lista (#935, ahora es larga) no la cierra a medio camino.
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
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Buscar contacto para ligar"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
      </div>

      {open && query.trim().length >= minimo && !loading && (
        <ul
          role="listbox"
          // tabIndex -1: al tocar la barra de scroll el foco pasa a la lista (no se pierde).
          tabIndex={-1}
          onScroll={esCatalogo ? onScrollLista : undefined}
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md py-1 shadow-md outline-none"
          style={{ background: "var(--bg-card, #fff)", border: "1px solid var(--border-subtle)" }}
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-[color:var(--text-tertiary)]">
              Sin resultados
            </li>
          ) : (
            results.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                {/* onMouseDown (no onClick): se dispara antes del blur del input, que cierra la lista. */}
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ id: c.id, name: c.name });
                    setQuery("");
                    setResults([]);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-[13px] text-[color:var(--text-primary)] hover:bg-black/5"
                >
                  {c.name}
                </button>
              </li>
            ))
          )}
          {esCatalogo && results.length > 0 && (
            <li
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-[color:var(--text-tertiary)]"
              aria-live="polite"
            >
              {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
              {total !== null && `${results.length} de ${total}`}
              {hasMore && !loadingMore && " · baja para ver más"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
