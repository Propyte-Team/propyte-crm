"use client";
import { paletteGroups } from "@/lib/journey/node-catalog";

export function NodePalette({ onPick, onClose, onAddDecision }: { onPick: (type: string) => void; onClose: () => void; onAddDecision?: () => void }) {
  return (
    <div className="absolute z-20 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      role="menu" onMouseLeave={onClose}>
      {onAddDecision && (
        <div className="mb-2">
          <button type="button" role="menuitem"
            onClick={() => { onAddDecision(); onClose(); }}
            className="rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
            ◆ Decisión (bifurca)
          </button>
        </div>
      )}
      {paletteGroups().map((g) => (
        <div key={g.category} className="mb-2 last:mb-0">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{g.category}</p>
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
