// Grid de tarjetas de reportes con apertura del visor de reporte
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Activity,
  Users,
  Target,
  XCircle,
} from "lucide-react";
import { ReportViewer } from "./report-viewer";

// Tipos de reporte disponibles
export type ReportType =
  | "pipeline"
  | "absorption"
  | "commissions"
  | "activities"
  | "lead-sources"
  | "forecast"
  | "lost-deals";

// Configuracion de cada reporte
const REPORTS: Array<{
  id: ReportType;
  title: string;
  description: string;
  icon: typeof BarChart3;
  iconColor: string;
  iconBg: string;
}> = [
  {
    id: "pipeline",
    title: "Pipeline",
    description: "Estado actual del pipeline por etapa, valor y probabilidad de cierre",
    icon: BarChart3,
    iconColor: "text-blue-500",
    iconBg: "bg-blue-100",
  },
  {
    id: "absorption",
    title: "Absorcion",
    description: "Velocidad de absorcion por desarrollo, unidades vendidas por periodo",
    icon: TrendingUp,
    iconColor: "text-green-500",
    iconBg: "bg-green-100",
  },
  {
    id: "commissions",
    title: "Comisiones",
    description: "Comisiones generadas, pendientes de pago y facturacion por asesor",
    icon: DollarSign,
    iconColor: "text-yellow-600",
    iconBg: "bg-yellow-100",
  },
  {
    id: "activities",
    title: "Actividades",
    description: "Cumplimiento del acuerdo de actividad por asesor y equipo",
    icon: Activity,
    iconColor: "text-purple-500",
    iconBg: "bg-purple-100",
  },
  {
    id: "lead-sources",
    title: "Fuentes de Leads",
    description: "Rendimiento por fuente de lead: volumen, conversion y costo por lead",
    icon: Users,
    iconColor: "text-orange-500",
    iconBg: "bg-orange-100",
  },
  {
    id: "forecast",
    title: "Forecast",
    description: "Proyeccion de cierres y facturacion para los proximos meses",
    icon: Target,
    iconColor: "text-teal-500",
    iconBg: "bg-teal-100",
  },
  {
    id: "lost-deals",
    title: "Deals Perdidos",
    description: "Analisis de deals perdidos por motivo, etapa y asesor",
    icon: XCircle,
    iconColor: "text-red-500",
    iconBg: "bg-red-100",
  },
];

export function ReportsGrid() {
  const [activeReport, setActiveReport] = useState<ReportType | null>(null);

  return (
    <>
      {/* Grid de tarjetas de reportes */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => {
          const IconComponent = report.icon;

          return (
            <Card key={report.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start gap-4">
                  {/* Icono del reporte */}
                  <div className={`rounded-lg p-3 ${report.iconBg}`}>
                    <IconComponent className={`h-6 w-6 ${report.iconColor}`} />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">{report.title}</CardTitle>
                    <CardDescription className="mt-1">
                      {report.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setActiveReport(report.id)}
                >
                  Generar Reporte
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Visor de reporte */}
      {activeReport && (
        <ReportViewer
          reportType={activeReport}
          onClose={() => setActiveReport(null)}
        />
      )}
    </>
  );
}
