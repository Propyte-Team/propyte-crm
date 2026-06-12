// Cifra-con-procedencia — firma secundaria del speckit de diseño (§0/§4).
// Encarna el data-gate visualmente: mono tabular + de dónde viene el dato.
// Regla: si no hay fuente verificable, el caller NO debe mostrar el número.
import { cn } from "@/lib/utils";

interface FigureStatProps {
  value: string | number;
  /** Fuente del dato (ej. "Hub", "Zoho", "CRM", "AirDNA") */
  source?: string;
  /** Fecha/corte del dato (ej. "al 2026-06") */
  asOf?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE: Record<string, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl font-bold tracking-tight",
};

export function FigureStat({ value, source, asOf, size = "md", className }: FigureStatProps) {
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className={cn("num", SIZE[size])} style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
      {(source || asOf) && (
        <span className="provenance">
          ↳ {[source, asOf].filter(Boolean).join(" · ")}
        </span>
      )}
    </span>
  );
}
