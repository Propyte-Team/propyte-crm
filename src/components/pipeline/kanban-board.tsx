// Tablero Kanban con columnas por etapa y drag & drop usando @dnd-kit
"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PIPELINE_STAGES, ACTIVE_PIPELINE_STAGES, formatCurrency, STAGE_LABELS, STAGE_COLORS } from "@/lib/constants";
import { DealCard } from "@/components/pipeline/deal-card";
import { StageTransitionDialog } from "@/components/pipeline/stage-transition-dialog";
import type { PipelineDeal } from "@/components/pipeline/pipeline-view";

interface KanbanBoardProps {
  dealsByStage: Record<string, PipelineDeal[]>;
  onStageTransition: (dealId: string, toStage: string) => Promise<boolean>;
  onDealUpdate: () => void;
}

// Columna individual del kanban con zona de drop
function KanbanColumn({
  stageCode,
  stageLabel,
  stageColor,
  deals,
}: {
  stageCode: string;
  stageLabel: string;
  stageColor: string;
  deals: PipelineDeal[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageCode });

  // Calcular valor total de deals en la columna
  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[280px] max-w-[300px] flex-shrink-0 flex-col rounded-lg border bg-muted/30 transition-all ${
        isOver ? "ring-2 ring-primary/50 bg-primary/5" : ""
      }`}
    >
      {/* Encabezado de la columna */}
      <div className="border-b p-3">
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: stageColor }}
          />
          <span className="text-sm font-semibold truncate">{stageLabel}</span>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium flex-shrink-0">
            {deals.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatCurrency(totalValue)}
        </p>
      </div>

      {/* Lista de tarjetas */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 320px)" }}>
        <SortableContext
          items={deals.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </SortableContext>

        {/* Placeholder cuando la columna está vacía */}
        {deals.length === 0 && (
          <div className="flex h-20 items-center justify-center rounded-md border-2 border-dashed text-xs text-muted-foreground">
            Sin deals
          </div>
        )}
      </div>
    </div>
  );
}

// Sección colapsable para etapas especiales (LOST, FROZEN)
function CollapsedStageSection({
  stageCode,
  stageLabel,
  stageColor,
  deals,
}: {
  stageCode: string;
  stageLabel: string;
  stageColor: string;
  deals: PipelineDeal[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);

  if (deals.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/40 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <div
          className="h-3 w-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: stageColor }}
        />
        <span className="text-sm font-semibold">{stageLabel}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
          {deals.length}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {formatCurrency(totalValue)}
        </span>
      </button>

      {isExpanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-3 pt-0">
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}

export function KanbanBoard({
  dealsByStage,
  onStageTransition,
  onDealUpdate,
}: KanbanBoardProps) {
  const [activeDeal, setActiveDeal] = useState<PipelineDeal | null>(null);
  const [localDealsByStage, setLocalDealsByStage] = useState(dealsByStage);

  // Diálogo de transición para etapas con reglas especiales
  const [transitionDialog, setTransitionDialog] = useState<{
    deal: PipelineDeal;
    toStage: string;
  } | null>(null);

  // Sensor de puntero con distancia mínima para evitar clics accidentales
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  // Etapas activas (visibles como columnas)
  const visibleStages = ACTIVE_PIPELINE_STAGES;

  // Etapas que requieren datos adicionales al transicionar
  const STAGES_REQUIRING_DIALOG = ["DISCOVERY_DONE", "RESERVED", "WON", "LOST"];

  // Manejar inicio de arrastre
  function handleDragStart(event: DragStartEvent) {
    const allDeals = Object.values(localDealsByStage).flat();
    const deal = allDeals.find((d) => d.id === event.active.id);
    setActiveDeal(deal ?? null);
  }

  // Manejar fin de arrastre y mover deal a nueva etapa
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDeal(null);

    if (!over) return;

    const dealId = active.id as string;
    const targetStage = over.id as string;

    // Verificar que sea una etapa válida
    const isValidStage = PIPELINE_STAGES.some((s) => s.code === targetStage);
    if (!isValidStage) return;

    // Encontrar el deal
    const allDeals = Object.values(localDealsByStage).flat();
    const deal = allDeals.find((d) => d.id === dealId);
    if (!deal || deal.stage === targetStage) return;

    // Si la etapa requiere datos adicionales, mostrar diálogo
    if (STAGES_REQUIRING_DIALOG.includes(targetStage)) {
      setTransitionDialog({ deal, toStage: targetStage });
      return;
    }

    // Actualizar visualmente de inmediato (optimistic update)
    setLocalDealsByStage((prev) => {
      const updated = { ...prev };
      // Remover deal de la etapa actual
      const fromStage = deal.stage;
      updated[fromStage] = (updated[fromStage] || []).filter(
        (d) => d.id !== dealId
      );
      // Agregar a la nueva etapa
      const movedDeal = { ...deal, stage: targetStage, daysInStage: 0 };
      updated[targetStage] = [...(updated[targetStage] || []), movedDeal];
      return updated;
    });

    // Llamar al servidor
    const success = await onStageTransition(dealId, targetStage);
    if (!success) {
      // Revertir si falla
      setLocalDealsByStage(dealsByStage);
    }
  }

  // Manejar transición exitosa desde el diálogo
  const handleTransitionSuccess = useCallback(() => {
    setTransitionDialog(null);
    onDealUpdate();
  }, [onDealUpdate]);

  // Sincronizar cuando cambian los datos externos
  useState(() => {
    setLocalDealsByStage(dealsByStage);
  });

  return (
    <div className="space-y-4">
      {/* Kanban con drag & drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Contenedor horizontal con scroll */}
        <div className="flex gap-3 overflow-x-auto pb-4">
          {visibleStages.map((stage) => {
            const stageDeals = localDealsByStage[stage.code] || [];
            return (
              <KanbanColumn
                key={stage.code}
                stageCode={stage.code}
                stageLabel={stage.label}
                stageColor={stage.color}
                deals={stageDeals}
              />
            );
          })}
        </div>

        {/* Overlay del deal siendo arrastrado */}
        <DragOverlay>
          {activeDeal ? <DealCard deal={activeDeal} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      {/* Secciones colapsadas para LOST y FROZEN */}
      <div className="space-y-2">
        <CollapsedStageSection
          stageCode="LOST"
          stageLabel="Perdidos"
          stageColor={STAGE_COLORS["LOST"] || "#EF4444"}
          deals={localDealsByStage["LOST"] || []}
        />
        <CollapsedStageSection
          stageCode="FROZEN"
          stageLabel="Congelados"
          stageColor={STAGE_COLORS["FROZEN"] || "#94A3B8"}
          deals={localDealsByStage["FROZEN"] || []}
        />
      </div>

      {/* Diálogo de transición con reglas de negocio */}
      {transitionDialog && (
        <StageTransitionDialog
          deal={transitionDialog.deal}
          toStage={transitionDialog.toStage}
          open={true}
          onOpenChange={(open) => {
            if (!open) setTransitionDialog(null);
          }}
          onSuccess={handleTransitionSuccess}
        />
      )}
    </div>
  );
}
