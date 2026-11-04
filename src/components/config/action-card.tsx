// Tarjeta de acción (E3, 964): una acción de regla o paso de cadencia como frase + formulario de
// campos alimentado por action-catalog y las listas de `useFuentes`. Compartida por el
// constructor de reglas y el editor de cadencias. La lógica vive en action-card-model.ts.
"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MessageCircle, Mail, Bell, ClipboardList, Phone, UserPlus, Shuffle, TriangleAlert, Pencil, Tag,
  Flag, RefreshCw, Repeat, Bot, Sparkles, PhoneCall, Link as LinkIcon, Circle,
  ChevronUp, ChevronDown, Trash2, Plus, GripVertical,
} from "lucide-react";
import {
  accionPorTipo, camposVisibles, describeAction, describirRetraso, validarAccion,
  type CampoDeAccion, type FuentesDeAccion,
} from "@/lib/workflows/action-catalog";
import { DelayInput } from "./cadence-editor";
import {
  PRESETS_DE_RETRASO, VALOR_OTRO, accionDesdeRaw, accionNueva, accionesAgrupadas, cambiarRaw, inputDeCampo,
  opcionesDeInput, rawDesdeConfig, retrasoATexto, retrasoDesdeTexto, valorCheckbox, valorDeSelect, valorTexto,
  type AccionEditable, type ListasDeFuentes,
} from "./action-card-model";

type Icono = ComponentType<{ className?: string }>;
const ICONOS: Record<string, Icono> = {
  MessageCircle, Mail, Bell, ClipboardList, Phone, UserPlus, Shuffle, TriangleAlert, Pencil, Tag,
  Flag, RefreshCw, Repeat, Bot, Sparkles, PhoneCall, Link: LinkIcon, Circle,
};

export function IconoDeAccion({ type, className = "h-4 w-4" }: { type: string; className?: string }) {
  const Ico = ICONOS[accionPorTipo(type)?.icono ?? "Circle"] ?? Circle;
  return <Ico className={className} />;
}

// ── Campo individual ─────────────────────────────────────────────────────────────────
function CampoDeAccionInput({
  campo, raw, listas, onSet,
}: {
  campo: CampoDeAccion;
  raw: Record<string, unknown>;
  listas: ListasDeFuentes;
  onSet: (key: string, valor: unknown) => void;
}) {
  const [modoOtro, setModoOtro] = useState(false);
  const tipo = inputDeCampo(campo);
  const id = `campo-${campo.key}`;

  let control: React.ReactNode;
  if (tipo === "text") {
    control = <input id={id} className="form-input text-[13px]" placeholder={campo.placeholder} value={valorTexto(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.value)} />;
  } else if (tipo === "textarea") {
    control = <textarea id={id} rows={3} className="form-input text-[13px]" placeholder={campo.placeholder} value={valorTexto(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.value)} />;
  } else if (tipo === "number") {
    control = <input id={id} type="number" className="form-input !w-32 text-[13px] num" placeholder={campo.placeholder} value={valorTexto(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.value)} />;
  } else if (tipo === "minutos") {
    control = <DelayInput value={valorTexto(raw, campo.key)} onChange={(m) => onSet(campo.key, m)} emptyText={campo.ayuda ?? "Sin valor"} />;
  } else if (tipo === "checkbox") {
    control = (
      <label className="flex items-center gap-2 text-[13px]">
        <input id={id} type="checkbox" checked={valorCheckbox(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.checked)} />
        {campo.label}
      </label>
    );
  } else {
    const { opciones, valorFueraDeLista } = opcionesDeInput(campo, raw, listas);
    const valor = valorDeSelect(campo, raw, listas, modoOtro);
    const otro = valor === VALOR_OTRO;
    control = (
      <div className="space-y-1.5">
        <select
          id={id}
          className="form-input text-[13px]"
          value={valor}
          onChange={(e) => {
            if (e.target.value === VALOR_OTRO) { setModoOtro(true); return; }
            setModoOtro(false);
            onSet(campo.key, e.target.value);
          }}
        >
          <option value="">Elige…</option>
          {opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {valorFueraDeLista !== null && !campo.permiteOtro && (
            <option value={valorFueraDeLista}>{valorFueraDeLista} (valor guardado)</option>
          )}
          {campo.permiteOtro && <option value={VALOR_OTRO}>Otro…</option>}
        </select>
        {otro && (
          <input className="form-input text-[13px]" placeholder="Escribe el valor" aria-label={`${campo.label} (otro)`}
            value={valorTexto(raw, campo.key)} onChange={(e) => onSet(campo.key, e.target.value)} />
        )}
        {campo.kind === "fuente" && opciones.length === 0 && valorFueraDeLista === null && (
          <p className="text-[11px] text-[color:var(--text-tertiary)]">No hay opciones disponibles todavía.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {tipo !== "checkbox" && (
        <label htmlFor={id} className="block text-[12px] font-medium text-[color:var(--text-secondary)]">
          {campo.label}{campo.requerido && <span className="text-red-600"> *</span>}
        </label>
      )}
      {control}
      {campo.ayuda && tipo !== "minutos" && <p className="text-[11px] text-[color:var(--text-tertiary)]">{campo.ayuda}</p>}
    </div>
  );
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────────────
export interface ActionCardProps {
  action: AccionEditable;
  index: number;
  total: number;
  fuentes: FuentesDeAccion;
  listas: ListasDeFuentes;
  abierta: boolean;
  onToggle: () => void;
  onChange: (next: AccionEditable) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  /** false en pasos de cadencia, donde el retraso se edita aparte. Por defecto true. */
  mostrarRetraso?: boolean;
  /** Asa para arrastrar (la pone ActionCardOrdenable). */
  asa?: ReactNode;
}

export function ActionCard({
  action, index, total, fuentes, listas, abierta, onToggle, onChange, onMove, onRemove, mostrarRetraso = true, asa,
}: ActionCardProps) {
  const def = accionPorTipo(action.type);
  const raw = rawDesdeConfig(action.config);
  const problemas = validarAccion(action, fuentes).problemas;
  const frase = describeAction(action, fuentes);
  const retraso = typeof action.delayMinutes === "number" && action.delayMinutes > 0 ? describirRetraso(action.delayMinutes) : null;

  const emit = (nextRaw: Record<string, unknown>, delay: number | null | undefined = action.delayMinutes) =>
    onChange(accionDesdeRaw(action.type, nextRaw, delay));

  return (
    <div className="space-y-1">
      <div className="crm-card !p-3">
        <div className="flex flex-wrap items-center gap-2">
          {asa}
          <span className="badge shrink-0" title={def?.label}><IconoDeAccion type={action.type} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[color:var(--text-tertiary)]">{index + 1}. {def?.label ?? action.type}</p>
            <p className="text-[13px] font-medium text-[color:var(--text-primary)] break-words">{frase}</p>
            {mostrarRetraso && retraso && <p className="text-[11px] text-[color:var(--text-secondary)]">{retraso}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className="btn-secondary !px-1.5 !py-1" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Subir acción"><ChevronUp className="h-4 w-4" /></button>
            <button type="button" className="btn-secondary !px-1.5 !py-1" disabled={index >= total - 1} onClick={() => onMove(1)} aria-label="Bajar acción"><ChevronDown className="h-4 w-4" /></button>
            <button type="button" className="btn-secondary !py-1 text-[12px]" onClick={onToggle} aria-expanded={abierta}>{abierta ? "Cerrar" : "Editar"}</button>
            <button type="button" onClick={onRemove} aria-label="Quitar acción" className="px-1 text-[color:var(--text-tertiary)] hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>

        {abierta && (
          <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
            {def?.ayuda && <p className="text-[12px] text-[color:var(--text-secondary)]">{def.ayuda}</p>}
            {camposVisibles(action.type, raw).map((campo) => (
              <CampoDeAccionInput key={campo.key} campo={campo} raw={raw} listas={listas}
                onSet={(key, valor) => emit(cambiarRaw(action.type, raw, key, valor))} />
            ))}
            {mostrarRetraso && (
              <div className="space-y-1">
                <p className="text-[12px] font-medium text-[color:var(--text-secondary)]">Cuándo se ejecuta</p>
                <DelayInput
                  value={retrasoATexto(action.delayMinutes)}
                  onChange={(m) => emit(raw, retrasoDesdeTexto(m) ?? null)}
                  presets={PRESETS_DE_RETRASO}
                  emptyText="Inmediata"
                />
              </div>
            )}
          </div>
        )}
      </div>
      {problemas.length > 0 && (
        <ul className="space-y-0.5 px-1" role="alert">
          {problemas.map((p) => <li key={p} className="text-[12px] text-red-600">{p}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Tarjeta que se puede arrastrar para reordenar (dentro de un SortableContext) ─────
// El teclado sigue funcionando con los botones Subir/Bajar; el asa solo agrega el arrastre.
export function ActionCardOrdenable({ sortableId, ...props }: ActionCardProps & { sortableId: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId });
  const asa = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="shrink-0 cursor-grab touch-none px-0.5 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] active:cursor-grabbing"
      aria-label="Arrastrar para cambiar el orden de la acción"
      title="Arrastra para cambiar el orden"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, position: "relative", zIndex: isDragging ? 10 : undefined }}
    >
      <ActionCard {...props} asa={asa} />
    </div>
  );
}

// ── Selector para agregar ────────────────────────────────────────────────────────────
export function ActionPicker({ onPick, label = "Agregar acción" }: { onPick: (action: AccionEditable) => void; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Plus className="h-4 w-4 text-[color:var(--text-tertiary)]" />
      <select
        className="form-input !w-auto text-[13px]"
        aria-label={label}
        value=""
        onChange={(e) => { if (e.target.value) onPick(accionNueva(e.target.value)); }}
      >
        <option value="">{label}…</option>
        {accionesAgrupadas().map((g) => (
          <optgroup key={g.grupo} label={g.grupo}>
            {g.acciones.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
