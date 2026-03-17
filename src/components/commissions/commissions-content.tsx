// Componente cliente para visualización y gestión de comisiones
// Incluye tarjetas de resumen, filtros, tabla y acciones de cambio de estado

"use client";

import { useState, useTransition, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DollarSign,
  Clock,
  CheckCircle,
  MoreHorizontal,
  Download,
  FileText,
} from "lucide-react";
import { updateCommissionStatus } from "@/server/commissions";
import type { CommissionStatus } from "@prisma/client";

// --- Tipos de props ---
interface CommissionRecord {
  id: string;
  contactName: string;
  developmentName: string | null;
  dealType: string;
  advisorName: string;
  estimatedValue: number;
  currency: string;
  commissionTotal: number;
  commissionAdvisor: number;
  commissionTL: number;
  commissionGerente: number;
  commissionDirector: number;
  commissionBrokerExt: number;
  commissionStatus: CommissionStatus;
  actualCloseDate: string | null;
  createdAt: string;
}

interface CommissionTotals {
  pendiente: number;
  facturada: number;
  pagada: number;
}

interface CommissionsContentProps {
  commissions: CommissionRecord[];
  totals: CommissionTotals;
  userRole: string;
}

// Etiquetas legibles para tipo de operación
const DEAL_TYPE_LABELS: Record<string, string> = {
  NATIVA_CONTADO: "Nativa Contado",
  NATIVA_FINANCIAMIENTO: "Nativa Financiamiento",
  MACROLOTE: "Macrolote",
  CORRETAJE: "Corretaje",
  MASTERBROKER: "MasterBroker",
};

// Configuración visual de badges por estado
const STATUS_CONFIG: Record<
  CommissionStatus,
  { label: string; className: string }
> = {
  PENDIENTE: { label: "Pendiente", className: "bg-amber-100 text-amber-700" },
  FACTURADA: { label: "Facturada", className: "bg-blue-100 text-blue-700" },
  PAGADA: { label: "Pagada", className: "bg-green-100 text-green-700" },
};

// Formateador de moneda MXN
function formatCurrency(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function CommissionsContent({
  commissions,
  totals,
  userRole,
}: CommissionsContentProps) {
  // Estado de filtros
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [monthFilter, setMonthFilter] = useState<string>("ALL");
  const [isPending, startTransition] = useTransition();

  // Roles con permisos para cambiar estado
  const canChangeStatus = userRole === "ADMIN" || userRole === "DIRECTOR" || userRole === "GERENTE";

  // Filtrar comisiones localmente
  const filtered = commissions.filter((c) => {
    // Filtro por estado
    if (statusFilter !== "ALL" && c.commissionStatus !== statusFilter) {
      return false;
    }
    // Filtro por mes
    if (monthFilter !== "ALL") {
      const date = new Date(c.createdAt);
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      if (yearMonth !== monthFilter) return false;
    }
    return true;
  });

  // Obtener meses disponibles para el filtro
  const availableMonths = Array.from(
    new Set(
      commissions.map((c) => {
        const d = new Date(c.createdAt);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      })
    )
  ).sort().reverse();

  // Formatear nombre de mes
  function formatMonth(yearMonth: string): string {
    const [year, month] = yearMonth.split("-");
    const date = new Date(Number(year), Number(month) - 1);
    return date.toLocaleDateString("es-MX", { year: "numeric", month: "long" });
  }

  // Manejar cambio de estado de comisión
  const handleStatusChange = useCallback(
    (dealId: string, newStatus: CommissionStatus) => {
      startTransition(async () => {
        try {
          await updateCommissionStatus(dealId, newStatus);
          // Recargar la página para reflejar cambios
          window.location.reload();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Error al actualizar estado";
          alert(message);
        }
      });
    },
    []
  );

  // Exportar CSV
  const handleExportCSV = useCallback(() => {
    const headers = [
      "Contacto",
      "Desarrollo",
      "Tipo de Operación",
      "Asesor",
      "Valor del Deal",
      "Comisión Total",
      "Comisión Asesor",
      "Estado",
      "Fecha",
    ];

    const rows = filtered.map((c) => [
      c.contactName,
      c.developmentName ?? "",
      DEAL_TYPE_LABELS[c.dealType] ?? c.dealType,
      c.advisorName,
      c.estimatedValue.toString(),
      c.commissionTotal.toString(),
      c.commissionAdvisor.toString(),
      STATUS_CONFIG[c.commissionStatus].label,
      c.createdAt.split("T")[0],
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `comisiones_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <>
      {/* Tarjetas de resumen */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Total Pendiente */}
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-full bg-amber-100 p-3">
              <Clock className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Pendiente</p>
              <p className="text-2xl font-bold">
                {formatCurrency(totals.pendiente)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Total Facturada */}
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-full bg-blue-100 p-3">
              <FileText className="h-5 w-5 text-blue-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Facturada</p>
              <p className="text-2xl font-bold">
                {formatCurrency(totals.facturada)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Total Pagada */}
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-full bg-green-100 p-3">
              <CheckCircle className="h-5 w-5 text-green-700" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Pagada</p>
              <p className="text-2xl font-bold">
                {formatCurrency(totals.pagada)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Barra de filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          {/* Filtro por estado */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Estado:
            </span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="PENDIENTE">Pendiente</SelectItem>
                <SelectItem value="FACTURADA">Facturada</SelectItem>
                <SelectItem value="PAGADA">Pagada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filtro por mes */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Mes:
            </span>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los meses</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatMonth(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Botón exportar CSV */}
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de comisiones */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Detalle de Comisiones ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <DollarSign className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-lg font-medium text-muted-foreground">
                No hay comisiones registradas
              </p>
              <p className="mt-1 text-sm text-muted-foreground/60">
                Las comisiones aparecen cuando los deals alcanzan la etapa WON
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Contacto</th>
                    <th className="pb-3 font-medium">Desarrollo</th>
                    <th className="pb-3 font-medium">Tipo de Operación</th>
                    <th className="pb-3 font-medium">Asesor</th>
                    <th className="pb-3 font-medium text-right">Valor del Deal</th>
                    <th className="pb-3 font-medium text-right">Comisión Total</th>
                    <th className="pb-3 font-medium text-right">Comisión Asesor</th>
                    <th className="pb-3 font-medium">Estado</th>
                    {canChangeStatus && (
                      <th className="pb-3 font-medium">Acciones</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((commission) => {
                    const config = STATUS_CONFIG[commission.commissionStatus];
                    return (
                      <tr
                        key={commission.id}
                        className="border-b last:border-0 hover:bg-muted/50"
                      >
                        <td className="py-3 font-medium">
                          {commission.contactName}
                        </td>
                        <td className="py-3">
                          {commission.developmentName ?? "—"}
                        </td>
                        <td className="py-3">
                          {DEAL_TYPE_LABELS[commission.dealType] ??
                            commission.dealType}
                        </td>
                        <td className="py-3">{commission.advisorName}</td>
                        <td className="py-3 text-right">
                          {formatCurrency(commission.estimatedValue)}
                        </td>
                        <td className="py-3 text-right font-medium">
                          {formatCurrency(commission.commissionTotal)}
                        </td>
                        <td className="py-3 text-right">
                          {formatCurrency(commission.commissionAdvisor)}
                        </td>
                        <td className="py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${config.className}`}
                          >
                            {config.label}
                          </span>
                        </td>
                        {canChangeStatus && (
                          <td className="py-3">
                            <CommissionActions
                              dealId={commission.id}
                              currentStatus={commission.commissionStatus}
                              onStatusChange={handleStatusChange}
                              isPending={isPending}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// --- Componente de acciones por comisión ---
interface CommissionActionsProps {
  dealId: string;
  currentStatus: CommissionStatus;
  onStatusChange: (dealId: string, newStatus: CommissionStatus) => void;
  isPending: boolean;
}

function CommissionActions({
  dealId,
  currentStatus,
  onStatusChange,
  isPending,
}: CommissionActionsProps) {
  // No mostrar acciones si ya está pagada
  if (currentStatus === "PAGADA") return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={isPending}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {currentStatus === "PENDIENTE" && (
          <DropdownMenuItem
            onClick={() => onStatusChange(dealId, "FACTURADA")}
          >
            <FileText className="mr-2 h-4 w-4 text-blue-600" />
            Marcar como Facturada
          </DropdownMenuItem>
        )}
        {currentStatus === "FACTURADA" && (
          <DropdownMenuItem
            onClick={() => onStatusChange(dealId, "PAGADA")}
          >
            <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
            Marcar como Pagada
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
