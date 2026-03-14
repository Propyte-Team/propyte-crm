// Tarjeta individual de deal para el tablero Kanban
// Muestra contacto, desarrollo, valor, días en etapa, asesor y temperatura
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatCurrency, TEMPERATURE_COLORS, DEAL_TYPE_LABELS } from "@/lib/constants";
import type { PipelineDeal } from "@/components/pipeline/pipeline-view";

interface DealCardProps {
  deal: PipelineDeal;
  isDragging?: boolean;
}

export function DealCard({ deal, isDragging = false }: DealCardProps) {
  const router = useRouter();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: deal.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Formatear valor monetario
  const formattedValue = formatCurrency(deal.value, deal.currency);

  // Obtener iniciales del asesor para avatar
  const initials = deal.advisorName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Color del indicador de temperatura
  const tempColor = TEMPERATURE_COLORS[deal.temperature] || "bg-gray-400";

  // Navegar al detalle al hacer clic (no durante drag)
  function handleClick(e: React.MouseEvent) {
    // Evitar navegación si se está arrastrando
    if (isSortableDragging || isDragging) return;
    router.push(`/pipeline/${deal.id}`);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={cn(
        "cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md",
        isSortableDragging && "opacity-50",
        isDragging && "rotate-2 shadow-lg",
        deal.isStagnant && "border-amber-400 border-2"
      )}
    >
      {/* Fila superior: nombre del contacto + indicador de temperatura */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold leading-tight truncate">
          {deal.contactName}
        </p>
        <div
          className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", tempColor)}
          title={deal.temperature}
        />
      </div>

      {/* Nombre del desarrollo */}
      {deal.development && (
        <p className="mt-1 text-xs text-muted-foreground truncate">
          {deal.development}
          {deal.unit && ` - ${deal.unit}`}
        </p>
      )}

      {/* Fila inferior: valor, días en etapa, avatar del asesor */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-medium text-primary">
          {formattedValue}
        </span>
        <div className="flex items-center gap-2">
          {/* Indicador de estancamiento */}
          {deal.isStagnant && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          )}

          {/* Días en la etapa actual */}
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {deal.daysInStage}d
          </span>

          {/* Avatar compacto del asesor */}
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
            title={deal.advisorName}
          >
            {initials}
          </div>
        </div>
      </div>
    </div>
  );
}
