"use client";

// #914 — Dos tarjetas de la ficha del contacto:
//   · «Información adicional»: empresa/inmobiliaria, Email 2, Facebook, mensaje inicial…
//     (la lista vive en lib/contacts/campos-adicionales.ts; aquí no se repite ningún campo).
//   · «Anuncio de origen»: campaña, conjunto, anuncio y formulario de donde llegó (solo lectura).
//
// Por defecto se ven solo los campos CON dato: casi todos vienen de la migración de Zoho y en un
// contacto nuevo estarían todos vacíos (once filas de «—»). «Mostrar vacíos» los abre para
// capturarlos. El acceso por rol es el mismo de los demás campos: HIDDEN no se pinta, READ se
// ve sin editar, EDIT se edita en línea.

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { CAMPOS_ADICIONALES, type CampoAdicional } from "@/lib/contacts/campos-adicionales";

type FieldAccess = "HIDDEN" | "READ" | "EDIT";

interface Props {
  contact: Record<string, any>;
  acc: (key: string) => FieldAccess;
  save: (patch: Record<string, unknown>) => Promise<boolean>;
}

/** ¿Tiene dato? `false` sí es dato en los booleanos; "" y null no lo son. */
export function tieneDato(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

/** Campos que la tarjeta pinta, en orden: visibles para el rol y, salvo `todos`, con dato. */
export function camposAPintar(
  contact: Record<string, unknown>,
  acc: (key: string) => FieldAccess,
  todos: boolean,
): CampoAdicional[] {
  return CAMPOS_ADICIONALES.filter((c) => acc(c.key) !== "HIDDEN" && (todos || tieneDato(contact[c.key])));
}

export function InfoAdicionalSection({ contact, acc, save }: Props) {
  const [todos, setTodos] = useState(false);
  const visibles = CAMPOS_ADICIONALES.filter((c) => acc(c.key) !== "HIDDEN");
  if (visibles.length === 0) return null; // el rol no ve ninguno: ni la tarjeta

  const campos = camposAPintar(contact, acc, todos);
  const hayVacios = visibles.some((c) => !tieneDato(contact[c.key]));

  return (
    <div className="crm-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
          Información adicional
        </h2>
        {hayVacios && (
          <button
            type="button"
            className="text-[12px] text-[color:var(--text-tertiary)] underline-offset-2 hover:underline"
            onClick={() => setTodos((t) => !t)}
          >
            {todos ? "Ocultar vacíos" : "Mostrar vacíos"}
          </button>
        )}
      </div>
      {campos.length === 0 ? (
        <p className="py-1.5 text-[13px] text-[color:var(--text-tertiary)]">Sin datos adicionales</p>
      ) : (
        campos.map((c) => (
          <Campo key={c.key} campo={c} value={contact[c.key]} editable={acc(c.key) === "EDIT"} save={save} />
        ))
      )}
    </div>
  );
}

function Campo({
  campo,
  value,
  editable,
  save,
}: {
  campo: CampoAdicional;
  value: unknown;
  editable: boolean;
  save: Props["save"];
}) {
  const onSave = (v: unknown) => save({ [campo.key]: v });
  if (campo.tipo === "booleano") {
    const actual = value === true ? "si" : value === false ? "no" : "";
    const texto = value === true ? "Sí" : value === false ? "No" : "—";
    if (!editable) return <Fila label={campo.label}>{texto}</Fila>;
    return (
      <Fila label={campo.label}>
        <select
          className="form-input max-w-[120px] text-[13px]"
          value={actual}
          onChange={(e) => onSave(e.target.value === "si" ? true : e.target.value === "no" ? false : null)}
        >
          <option value="">—</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </select>
      </Fila>
    );
  }
  const texto = typeof value === "string" ? value : "";
  return (
    <TextoEditable
      label={campo.label}
      value={texto}
      largo={campo.tipo === "largo"}
      tipo={campo.tipo === "email" ? "email" : "text"}
      editable={editable}
      onSave={onSave}
    />
  );
}

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-[color:var(--text-tertiary)]">{label}</span>
      <span className="text-right font-medium text-[color:var(--text-primary)]">{children}</span>
    </div>
  );
}

// Texto editable en línea. Los largos (mensaje inicial, interés del broker) van con la etiqueta
// arriba y el texto debajo respetando saltos de línea, y se editan en un textarea.
function TextoEditable({
  label,
  value,
  largo,
  tipo,
  editable,
  onSave,
}: {
  label: string;
  value: string;
  largo: boolean;
  tipo: string;
  editable: boolean;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(value);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(false);

  async function confirmar() {
    if (borrador === value) {
      setEditando(false);
      return;
    }
    setGuardando(true);
    setError(false);
    const ok = await onSave(borrador.trim());
    setGuardando(false);
    if (ok) setEditando(false);
    else setError(true);
  }
  const cancelar = () => {
    setBorrador(value);
    setEditando(false);
  };

  if (editando) {
    return (
      <div className="py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">{label}</span>
        <div className="mt-1 flex items-start gap-1.5">
          {largo ? (
            <textarea
              autoFocus
              rows={4}
              className="form-input text-[13px]"
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && cancelar()}
            />
          ) : (
            <input
              autoFocus
              type={tipo}
              className="form-input text-[13px]"
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmar();
                if (e.key === "Escape") cancelar();
              }}
            />
          )}
          <button className="btn-primary !px-2 !py-2" onClick={confirmar} disabled={guardando} aria-label="Guardar">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button className="btn-secondary !px-2 !py-2" onClick={cancelar} aria-label="Cancelar">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && (
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-error, #DC2626)" }}>
            No se pudo guardar (revisa el formato)
          </p>
        )}
      </div>
    );
  }

  const abrir = editable
    ? () => {
        setBorrador(value);
        setEditando(true);
      }
    : undefined;
  const vacio = <span className="text-[color:var(--text-tertiary)]">—</span>;

  if (largo) {
    return (
      <div className={`group py-1.5 text-[13px] ${editable ? "cursor-text" : ""}`} onClick={abrir}>
        <span className="flex items-center gap-1.5 text-[color:var(--text-tertiary)]">
          {label}
          {editable && <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" />}
        </span>
        <p className="mt-0.5 whitespace-pre-wrap break-words font-medium text-[color:var(--text-primary)]">
          {value || vacio}
        </p>
      </div>
    );
  }
  return (
    <div
      className={`group flex items-center justify-between gap-3 py-1.5 text-[13px] ${editable ? "cursor-text" : ""}`}
      onClick={abrir}
    >
      <span className="text-[color:var(--text-tertiary)]">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-right font-medium text-[color:var(--text-primary)]">
        <span className="break-all">{value || vacio}</span>
        {editable && <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />}
      </span>
    </div>
  );
}

/** Filas del anuncio de origen con dato, en orden. Vacío = la tarjeta no se pinta. */
export function filasAnuncio(a: Record<string, unknown> | null | undefined): { label: string; valor: string }[] {
  if (!a) return [];
  const filas: [string, unknown][] = [
    ["Campaña", a.campaignName],
    ["Conjunto", a.adsetName],
    ["Anuncio", a.adName],
    ["Formulario", a.formName],
    ["Red", a.network],
  ];
  return filas
    .filter(([, v]) => tieneDato(v))
    .map(([label, v]) => ({ label, valor: String(v) }));
}

export function AnuncioOrigenSection({ adAttribution }: { adAttribution: Record<string, unknown> | null | undefined }) {
  const filas = filasAnuncio(adAttribution);
  if (filas.length === 0) return null;
  return (
    <div className="crm-card">
      <div className="mb-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
          Anuncio de origen
        </h2>
      </div>
      {filas.map((f) => (
        <Fila key={f.label} label={f.label}>
          <span className="break-words">{f.valor}</span>
        </Fila>
      ))}
    </div>
  );
}
