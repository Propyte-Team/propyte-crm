// Vista del pipeline con toggle Kanban/Tabla y barra de filtros
"use client";

import { useState, useEffect, useCallback } from "react";
import { LayoutGrid, Table as TableIcon, Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { DealsTable } from "@/components/pipeline/deals-table";
import { DealForm } from "@/components/pipeline/deal-form";
import {
  PIPELINE_STAGES,
  DEAL_TYPE_LABELS,
  formatCurrency,
} from "@/lib/constants";

// Tipo de deal para el pipeline (derivado de la respuesta del servidor)
export interface PipelineDeal {
  id: string;
  contactId: string;
  contactName: string;
  contactFirstName: string;
  contactLastName: string;
  development: string | null;
  developmentId: string | null;
  unit: string | null;
  unitId: string | null;
  value: number;
  currency: string;
  stage: string;
  dealType: string;
  probability: number;
  temperature: string;
  advisorName: string;
  advisorId: string;
  advisorAvatar: string | null;
  daysInStage: number;
  expectedCloseDate: string;
  createdAt: string;
  updatedAt: string;
  isStagnant: boolean;
  leadSourceAtDeal: string;
  lostReason?: string | null;
  lostReasonDetail?: string | null;
  actualCloseDate?: string | null;
  commissionTotal?: number | null;
}

interface PipelineViewProps {
  initialDealsByStage: Record<string, any[]>;
  userRole: string;
  userId: string;
}

/**
 * Transforma los datos crudos del servidor al tipo PipelineDeal.
 */
function transformDeal(deal: any): PipelineDeal {
  const now = new Date();
  const updatedAt = new Date(deal.updatedAt);
  const daysInStage = Math.floor(
    (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Determinar si está estancado (sin actividad reciente)
  const lastActivity = deal.activities?.[0]?.createdAt;
  const lastDate = lastActivity ? new Date(lastActivity) : updatedAt;
  const daysSinceActivity = Math.floor(
    (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const stagnationLimits: Record<string, number> = {
    NEW_LEAD: 3, CONTACTED: 5, DISCOVERY_DONE: 7,
    MEETING_SCHEDULED: 5, MEETING_COMPLETED: 5,
    PROPOSAL_SENT: 7, NEGOTIATION: 10, RESERVED: 14,
    CONTRACT_SIGNED: 21, CLOSING: 30,
  };

  const isStagnant = daysSinceActivity > (stagnationLimits[deal.stage] || 7);

  return {
    id: deal.id,
    contactId: deal.contactId,
    contactName: `${deal.contact?.firstName || ""} ${deal.contact?.lastName || ""}`.trim(),
    contactFirstName: deal.contact?.firstName || "",
    contactLastName: deal.contact?.lastName || "",
    development: deal.development?.name || null,
    developmentId: deal.developmentId || null,
    unit: deal.unit?.unitNumber || null,
    unitId: deal.unitId || null,
    value: Number(deal.estimatedValue || 0),
    currency: deal.currency || "MXN",
    stage: deal.stage,
    dealType: deal.dealType,
    probability: deal.probability || 0,
    temperature: deal.contact?.temperature || "COLD",
    advisorName: deal.assignedTo?.name || "",
    advisorId: deal.assignedToId || "",
    advisorAvatar: deal.assignedTo?.avatarUrl || null,
    daysInStage,
    expectedCloseDate: deal.expectedCloseDate,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    isStagnant,
    leadSourceAtDeal: deal.leadSourceAtDeal || "",
    lostReason: deal.lostReason,
    lostReasonDetail: deal.lostReasonDetail,
    actualCloseDate: deal.actualCloseDate,
    commissionTotal: deal.commissionTotal ? Number(deal.commissionTotal) : null,
  };
}

export function PipelineView({
  initialDealsByStage,
  userRole,
  userId,
}: PipelineViewProps) {
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [showFilters, setShowFilters] = useState(false);
  const [showNewDeal, setShowNewDeal] = useState(false);

  // Filtros
  const [filterStage, setFilterStage] = useState<string>("all");
  const [filterDealType, setFilterDealType] = useState<string>("all");

  // Transformar datos iniciales
  const [dealsByStage, setDealsByStage] = useState<Record<string, PipelineDeal[]>>(() => {
    const transformed: Record<string, PipelineDeal[]> = {};
    for (const [stage, deals] of Object.entries(initialDealsByStage)) {
      transformed[stage] = deals.map(transformDeal);
    }
    return transformed;
  });

  // Obtener todos los deals como lista plana
  const allDeals = Object.values(dealsByStage).flat();

  // Filtrar deals según filtros activos
  const filteredDeals = allDeals.filter((deal) => {
    if (filterStage !== "all" && deal.stage !== filterStage) return false;
    if (filterDealType !== "all" && deal.dealType !== filterDealType) return false;
    return true;
  });

  // Calcular resumen
  const activeDeals = filteredDeals.filter(
    (d) => !["WON", "LOST", "FROZEN"].includes(d.stage)
  );
  const valorPonderado = activeDeals.reduce(
    (sum, d) => sum + (d.value * d.probability) / 100,
    0
  );

  // Recargar datos
  const reloadDeals = useCallback(async () => {
    try {
      const res = await fetch("/api/deals?pageSize=500");
      if (!res.ok) return;
      const json = await res.json();
      const deals: PipelineDeal[] = (json.data || []).map(transformDeal);

      // Agrupar por etapa
      const grouped: Record<string, PipelineDeal[]> = {};
      for (const deal of deals) {
        if (!grouped[deal.stage]) grouped[deal.stage] = [];
        grouped[deal.stage].push(deal);
      }
      setDealsByStage(grouped);
    } catch (err) {
      console.error("Error al recargar deals:", err);
    }
  }, []);

  // Manejar transición de etapa desde kanban (drag & drop)
  const handleStageTransition = useCallback(
    async (dealId: string, toStage: string) => {
      try {
        const res = await fetch(`/api/deals/${dealId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: toStage }),
        });

        if (!res.ok) {
          const data = await res.json();
          alert(data.error || "Error al cambiar etapa");
          // Recargar para revertir el estado visual
          await reloadDeals();
          return false;
        }

        return true;
      } catch {
        alert("Error de conexión al cambiar etapa");
        await reloadDeals();
        return false;
      }
    },
    [reloadDeals]
  );

  return (
    <div className="space-y-4">
      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Toggle Kanban/Tabla */}
          <Button
            variant={viewMode === "kanban" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("kanban")}
          >
            <LayoutGrid className="mr-1 h-4 w-4" />
            Kanban
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("table")}
          >
            <TableIcon className="mr-1 h-4 w-4" />
            Tabla
          </Button>

          {/* Botón de filtros */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="mr-1 h-4 w-4" />
            Filtros
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {/* Resumen */}
          <span className="text-sm text-muted-foreground">
            {activeDeals.length} deals activos &middot;{" "}
            {formatCurrency(valorPonderado)} ponderado
          </span>

          {/* Botón nuevo deal */}
          <Dialog open={showNewDeal} onOpenChange={setShowNewDeal}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Deal
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Crear Nuevo Deal</DialogTitle>
              </DialogHeader>
              <DealForm
                onSuccess={() => {
                  setShowNewDeal(false);
                  reloadDeals();
                }}
                onCancel={() => setShowNewDeal(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Barra de filtros colapsable */}
      {showFilters && (
        <Card>
          <CardContent className="flex flex-wrap gap-4 p-4">
            {/* Filtro por etapa */}
            <div className="w-48">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Etapa
              </label>
              <Select value={filterStage} onValueChange={setFilterStage}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas las etapas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las etapas</SelectItem>
                  {PIPELINE_STAGES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filtro por tipo de deal */}
            <div className="w-48">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tipo de Deal
              </label>
              <Select value={filterDealType} onValueChange={setFilterDealType}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los tipos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  {Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Botón limpiar filtros */}
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterStage("all");
                  setFilterDealType("all");
                }}
              >
                Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vista Kanban */}
      {viewMode === "kanban" && (
        <KanbanBoard
          dealsByStage={dealsByStage}
          onStageTransition={handleStageTransition}
          onDealUpdate={reloadDeals}
        />
      )}

      {/* Vista Tabla */}
      {viewMode === "table" && (
        <DealsTable deals={filteredDeals} onDealUpdate={reloadDeals} />
      )}
    </div>
  );
}
