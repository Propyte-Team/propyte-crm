// Visor de reportes: dialogo que permite filtrar, generar y exportar reportes
// Conecta con server actions reales para cada tipo de reporte
"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import {
  STAGE_LABELS,
  LEAD_SOURCE_LABELS,
  LOST_REASON_LABELS,
  PLAZA_LABELS,
} from "@/lib/constants";
import {
  getPipelineReport,
  getAbsorptionReport,
  getCommissionsReport,
  getActivitiesReport,
  getLeadSourcesReport,
  getForecastReport,
  getLostDealsReport,
} from "@/server/reports";
import { ReportTable, type ReportColumn } from "./report-table";
import type { ReportType } from "./reports-grid";

// Titulos de cada tipo de reporte
const REPORT_TITLES: Record<ReportType, string> = {
  pipeline: "Reporte de Pipeline",
  absorption: "Reporte de Absorcion",
  commissions: "Reporte de Comisiones",
  activities: "Reporte de Actividades",
  "lead-sources": "Reporte de Fuentes de Leads",
  forecast: "Reporte de Forecast",
  "lost-deals": "Reporte de Deals Perdidos",
};

// Columnas por tipo de reporte
const REPORT_COLUMNS: Record<ReportType, ReportColumn[]> = {
  pipeline: [
    { header: "Etapa", key: "stageLabel" },
    { header: "Cantidad", key: "count" },
    { header: "Valor Total", key: "totalValue", isCurrency: true },
    { header: "Dias Promedio", key: "avgDaysInStage" },
    { header: "Estancados", key: "stagnantCount" },
  ],
  absorption: [
    { header: "Desarrollo", key: "developmentName" },
    { header: "Total Unidades", key: "totalUnits" },
    { header: "Vendidas", key: "soldUnits" },
    { header: "Reservadas", key: "reservedUnits" },
    { header: "Disponibles", key: "availableUnits" },
    { header: "Absorcion/Mes", key: "absorptionRate" },
    { header: "Precio Promedio", key: "avgPrice", isCurrency: true },
  ],
  commissions: [
    { header: "Asesor", key: "advisorName" },
    { header: "Deals", key: "dealCount" },
    { header: "Comision Total", key: "totalCommission", isCurrency: true },
    { header: "Pendiente", key: "pendingCommission", isCurrency: true },
    { header: "Pagado", key: "paidCommission", isCurrency: true },
  ],
  activities: [
    { header: "Asesor", key: "advisorName" },
    { header: "Llamadas", key: "callsOut" },
    { header: "WhatsApp", key: "whatsappOut" },
    { header: "Emails", key: "emailsSent" },
    { header: "Reuniones", key: "meetings" },
    { header: "Discovery", key: "discoveries" },
    { header: "Propuestas", key: "proposals" },
    { header: "Seguimientos", key: "followUps" },
    { header: "Total", key: "total" },
  ],
  "lead-sources": [
    { header: "Fuente", key: "leadSourceLabel" },
    { header: "Contactos", key: "totalContacts" },
    { header: "Con Deal", key: "convertedToDeals" },
    { header: "Ganados", key: "wonDeals" },
    { header: "Conversion", key: "conversionRate", isPercentage: true },
    { header: "Valor Promedio", key: "avgDealValue", isCurrency: true },
  ],
  forecast: [
    { header: "Mes", key: "month" },
    { header: "Deals", key: "dealCount" },
    { header: "Valor Estimado", key: "totalEstimatedValue", isCurrency: true },
    { header: "Valor Ponderado", key: "weightedValue", isCurrency: true },
  ],
  "lost-deals": [
    { header: "Razon de Perdida", key: "lostReasonLabel" },
    { header: "Cantidad", key: "count" },
    { header: "Valor Perdido", key: "totalValueLost", isCurrency: true },
    { header: "Por Etapa", key: "byStage" },
    { header: "Por Asesor", key: "byAdvisor" },
  ],
};

interface ReportViewerProps {
  reportType: ReportType;
  onClose: () => void;
}

export function ReportViewer({ reportType, onClose }: ReportViewerProps) {
  const [isPending, startTransition] = useTransition();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [plaza, setPlaza] = useState("ALL");
  const [reportData, setReportData] = useState<Record<string, unknown>[] | null>(null);

  // Generar reporte llamando al server action correspondiente
  function handleGenerate() {
    startTransition(async () => {
      const filters = {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        plaza: plaza !== "ALL" ? plaza : undefined,
      };

      try {
        let data: Record<string, unknown>[];

        switch (reportType) {
          case "pipeline": {
            const raw = await getPipelineReport(filters);
            // Agregar etiquetas de etapa en espanol
            data = raw.map((row) => ({
              ...row,
              stageLabel: STAGE_LABELS[row.stage] ?? row.stage,
            }));
            break;
          }
          case "absorption": {
            const raw = await getAbsorptionReport(filters);
            data = raw as unknown as Record<string, unknown>[];
            break;
          }
          case "commissions": {
            const raw = await getCommissionsReport(filters);
            data = raw as unknown as Record<string, unknown>[];
            break;
          }
          case "activities": {
            const raw = await getActivitiesReport(filters);
            data = raw as unknown as Record<string, unknown>[];
            break;
          }
          case "lead-sources": {
            const raw = await getLeadSourcesReport(filters);
            data = raw.map((row) => ({
              ...row,
              leadSourceLabel: LEAD_SOURCE_LABELS[row.leadSource] ?? row.leadSource,
            }));
            break;
          }
          case "forecast": {
            const raw = await getForecastReport(filters);
            data = raw as unknown as Record<string, unknown>[];
            break;
          }
          case "lost-deals": {
            const raw = await getLostDealsReport(filters);
            data = raw.map((row) => ({
              ...row,
              lostReasonLabel: LOST_REASON_LABELS[row.lostReason] ?? row.lostReason,
            }));
            break;
          }
          default:
            data = [];
        }

        setReportData(data);
      } catch (error: any) {
        console.error("Error generando reporte:", error);
        setReportData([]);
      }
    });
  }

  // Exportar datos a CSV y descargar
  function handleExportCSV() {
    if (!reportData || reportData.length === 0) return;

    const columns = REPORT_COLUMNS[reportType];
    // Encabezados
    const headers = columns.map((c) => c.header).join(",");
    // Filas
    const rows = reportData.map((row) =>
      columns
        .map((col) => {
          const value = row[col.key];
          if (value === null || value === undefined) return "";
          if (typeof value === "object") {
            // Convertir objetos a string legible
            const obj = value as Record<string, number>;
            return `"${Object.entries(obj)
              .map(([k, v]) => `${k}:${v}`)
              .join("; ")}"`;
          }
          // Escapar valores con comas
          const str = String(value);
          if (str.includes(",") || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(",")
    );

    const csv = [headers, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reporte-${reportType}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{REPORT_TITLES[reportType]}</DialogTitle>
          <DialogDescription>
            Configura los filtros y genera el reporte
          </DialogDescription>
        </DialogHeader>

        {/* Filtros */}
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label htmlFor="dateFrom">Fecha desde</Label>
            <Input
              id="dateFrom"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dateTo">Fecha hasta</Label>
            <Input
              id="dateTo"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <Label>Plaza</Label>
            <Select value={plaza} onValueChange={setPlaza}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las plazas</SelectItem>
                {Object.entries(PLAZA_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleGenerate} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generando...
                </>
              ) : (
                "Generar"
              )}
            </Button>
            {reportData && reportData.length > 0 && (
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            )}
          </div>
        </div>

        {/* Resultados */}
        {reportData !== null && (
          <div className="mt-4">
            <ReportTable
              columns={REPORT_COLUMNS[reportType]}
              data={reportData}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
