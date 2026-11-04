"use client";
import { paletaDeAcciones } from "./rule-inspector-model";

// Paleta de nodos: solo acciones activas del catálogo, agrupadas, sin emoji.
export function NodePalette({ onPick, onClose, onAddDecision }: { onPick: (type: string) => void; onClose: () => void; onAddDecision?: () => void }) {
  return (
    <div className="absolute z-20 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      role="menu" onMouseLeave={onClose}>
      {onAddDecision && (
        <div className="mb-2">
          <button type="button" role="menuitem"
            onClick={() => { onAddDecision(); onClose(); }}
            className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800">
            Decisión (bifurca según condiciones)
          </button>
        </div>
      )}
      {paletaDeAcciones().map((g) => (
        <div key={g.grupo} className="mb-2 last:mb-0">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{g.grupo}</p>
          <div className="grid grid-cols-1 gap-0.5">
            {g.items.map((m) => (
              <button key={m.type} type="button" role="menuitem"
                onClick={() => { onPick(m.type); onClose(); }}
                className="rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
