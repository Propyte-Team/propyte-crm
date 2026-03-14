// Tabla de deals con columnas ordenables y acciones
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  MoreHorizontal,
  Eye,
  Edit,
  ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  STAGE_LABELS,
  STAGE_COLORS,
  DEAL_TYPE_LABELS,
  formatCurrency,
} from "@/lib/constants";
import type { PipelineDeal } from "@/components/pipeline/pipeline-view";

interface DealsTableProps {
  deals: PipelineDeal[];
  onDealUpdate: () => void;
}

// Tipo para ordenamiento
type SortField = "value" | "createdAt" | "stage" | "daysInStage" | "probability";
type SortDirection = "asc" | "desc";

export function DealsTable({ deals, onDealUpdate }: DealsTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  // Ordenar deals
  const sortedDeals = [...deals].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "value":
        cmp = a.value - b.value;
        break;
      case "createdAt":
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "stage":
        cmp = a.stage.localeCompare(b.stage);
        break;
      case "daysInStage":
        cmp = a.daysInStage - b.daysInStage;
        break;
      case "probability":
        cmp = a.probability - b.probability;
        break;
      default:
        cmp = 0;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Toggle ordenamiento
  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  // Botón de encabezado ordenable
  function SortHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Todos los Deals ({deals.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-3 font-medium">Contacto</th>
                <th className="pb-3 font-medium">Desarrollo</th>
                <th className="pb-3 font-medium">Unidad</th>
                <th className="pb-3 font-medium">
                  <SortHeader field="stage">Etapa</SortHeader>
                </th>
                <th className="pb-3 font-medium">Tipo</th>
                <th className="pb-3 font-medium">
                  <SortHeader field="value">Valor</SortHeader>
                </th>
                <th className="pb-3 font-medium">
                  <SortHeader field="probability">Prob.</SortHeader>
                </th>
                <th className="pb-3 font-medium">Asesor</th>
                <th className="pb-3 font-medium">
                  <SortHeader field="daysInStage">Dias</SortHeader>
                </th>
                <th className="pb-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sortedDeals.map((deal) => {
                const stageColor = STAGE_COLORS[deal.stage] || "#6B7280";

                return (
                  <tr
                    key={deal.id}
                    className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                    onClick={() => router.push(`/pipeline/${deal.id}`)}
                  >
                    <td className="py-3 font-medium">{deal.contactName}</td>
                    <td className="py-3 text-muted-foreground">
                      {deal.development || "-"}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {deal.unit || "-"}
                    </td>
                    <td className="py-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: stageColor }}
                      >
                        {STAGE_LABELS[deal.stage] || deal.stage}
                      </span>
                    </td>
                    <td className="py-3 text-muted-foreground text-xs">
                      {DEAL_TYPE_LABELS[deal.dealType] || deal.dealType}
                    </td>
                    <td className="py-3 font-medium">
                      {formatCurrency(deal.value, deal.currency)}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {deal.probability}%
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {deal.advisorName}
                    </td>
                    <td className="py-3">
                      <span className={deal.isStagnant ? "text-amber-600 font-medium" : "text-muted-foreground"}>
                        {deal.daysInStage}d
                      </span>
                    </td>
                    <td className="py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/pipeline/${deal.id}`);
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Ver detalle
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/pipeline/${deal.id}`);
                            }}
                          >
                            <ArrowRightLeft className="mr-2 h-4 w-4" />
                            Cambiar etapa
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/pipeline/${deal.id}`);
                            }}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}

              {sortedDeals.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No se encontraron deals con los filtros actuales
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
