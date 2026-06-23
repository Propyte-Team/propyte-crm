"use client";
import { LIFECYCLE_ORDER, LIFECYCLE_LABELS, LIFECYCLE_COLORS } from "@/lib/constants";

interface Props {
  value: string | null;
  onChange: (stage: string) => void;
  loading?: boolean;
  readOnly?: boolean;
}

export function LifecycleStepper({ value, onChange, loading, readOnly }: Props) {
  const activeIdx = value ? LIFECYCLE_ORDER.indexOf(value as never) : -1;
  return (
    <div className="flex items-stretch gap-1" role="group" aria-label="Etapa del ciclo de vida">
      {LIFECYCLE_ORDER.map((stage, i) => {
        const done = i <= activeIdx;
        const isActive = i === activeIdx;
        const color = LIFECYCLE_COLORS[stage];
        return (
          <button
            key={stage}
            type="button"
            disabled={readOnly || loading}
            onClick={() => onChange(stage)}
            title={LIFECYCLE_LABELS[stage]}
            className={[
              "relative flex-1 px-2 py-1.5 text-[11px] font-medium tracking-tight",
              "border transition-colors first:rounded-l-md last:rounded-r-md",
              isActive ? "text-white" : done ? "text-neutral-700 dark:text-neutral-200" : "text-neutral-400",
              readOnly ? "cursor-default" : "hover:border-neutral-400",
            ].join(" ")}
            style={isActive ? { background: color, borderColor: color } : { borderColor: done ? color : undefined }}
          >
            {LIFECYCLE_LABELS[stage]}
          </button>
        );
      })}
    </div>
  );
}
