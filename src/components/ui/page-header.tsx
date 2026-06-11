// Encabezado editorial de página — eyebrow (contexto) + h1 fuerte + meta en mono.
// Patrón único para que TODAS las pantallas compartan la misma jerarquía dramática.
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  /** Métricas de contexto, renderizadas en mono tabular (ej. "12 deals · $4.2M") */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, meta, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight" style={{ color: "var(--text-primary)" }}>
          {title}
        </h1>
        {meta && (
          <p className="num mt-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {meta}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
