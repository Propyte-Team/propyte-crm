// Componente cliente del plan de carrera
// Muestra nivel actual, requisitos con progreso, KPIs y botón de ascenso
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Award,
  TrendingUp,
  Target,
  Star,
  Shield,
  CheckCircle,
  XCircle,
  ArrowUp,
  BarChart3,
} from "lucide-react";
import { formatMXN } from "@/lib/constants";
import type { CareerProgress, CareerKPIs } from "@/server/career";

// Colores por nivel de carrera
const LEVEL_COLORS: Record<string, { bg: string; text: string; badge: string }> = {
  JR: { bg: "bg-blue-100", text: "text-blue-700", badge: "bg-blue-500" },
  SR: { bg: "bg-green-100", text: "text-green-700", badge: "bg-green-500" },
  TOP_PRODUCER: { bg: "bg-purple-100", text: "text-purple-700", badge: "bg-purple-500" },
  TEAM_LEADER: { bg: "bg-orange-100", text: "text-orange-700", badge: "bg-orange-500" },
  GERENTE: { bg: "bg-red-100", text: "text-red-700", badge: "bg-red-500" },
};

interface CareerContentProps {
  progress: CareerProgress;
  kpis: CareerKPIs;
}

export function CareerContent({ progress, kpis }: CareerContentProps) {
  const levelColor = LEVEL_COLORS[progress.currentLevel] || LEVEL_COLORS.JR;

  // Determinar color de la barra de progreso según porcentaje
  function getProgressBarColor(current: number, required: number): string {
    if (required === 0) return "bg-green-500";
    const pct = (current / required) * 100;
    if (pct >= 100) return "bg-green-500";
    if (pct >= 70) return "bg-amber-500";
    return "bg-red-500";
  }

  // Formatear valores de SEDETUS como texto
  function formatRequirementValue(
    current: number,
    required: number,
    unit: string,
    label: string
  ): string {
    if (label === "SEDETUS vigente") {
      return current === 1 ? "Vigente" : "No vigente";
    }
    return `${current} / ${required} ${unit}`;
  }

  // Meses en formato legible
  const monthNames = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];

  function formatMonth(monthStr: string): string {
    const [year, month] = monthStr.split("-");
    const monthIndex = parseInt(month) - 1;
    return `${monthNames[monthIndex]} ${year}`;
  }

  return (
    <div className="space-y-6">
      {/* Tarjeta de nivel actual */}
      <Card className={`border-2 ${levelColor.bg}`}>
        <CardContent className="flex items-center gap-6 p-6">
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-full ${levelColor.badge}`}
          >
            <Award className="h-8 w-8 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">Nivel actual</p>
            <h2 className={`text-2xl font-bold ${levelColor.text}`}>
              {progress.currentLevelLabel}
            </h2>
            {progress.nextLevelLabel && (
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <ArrowUp className="h-3 w-3" />
                  Siguiente: {progress.nextLevelLabel}
                </Badge>
              </div>
            )}
            {!progress.nextLevelLabel && (
              <Badge className="mt-1 bg-amber-500 text-white">
                Nivel maximo alcanzado
              </Badge>
            )}
          </div>
          {/* Boton de solicitar ascenso */}
          {progress.nextLevelLabel && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Button
                      disabled={!progress.allRequirementsMet}
                      className="gap-2"
                    >
                      <ArrowUp className="h-4 w-4" />
                      Solicitar Ascenso
                    </Button>
                  </div>
                </TooltipTrigger>
                {!progress.allRequirementsMet && (
                  <TooltipContent>
                    <p>Debes cumplir todos los requisitos para solicitar ascenso</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-full bg-blue-100 p-3">
              <Target className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{kpis.quarterDeals}</p>
              <p className="text-sm text-muted-foreground">Cierres del trimestre</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-full bg-green-100 p-3">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{kpis.conversionRate}%</p>
              <p className="text-sm text-muted-foreground">Tasa de Conversion</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-full bg-purple-100 p-3">
              <Star className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{kpis.activityCompliance}%</p>
              <p className="text-sm text-muted-foreground">Compliance de Actividades</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className={`rounded-full p-3 ${kpis.sedetusValid ? "bg-green-100" : "bg-red-100"}`}>
              <Shield className={`h-5 w-5 ${kpis.sedetusValid ? "text-green-600" : "text-red-600"}`} />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {kpis.sedetusValid ? "Vigente" : "Vencido"}
              </p>
              <p className="text-sm text-muted-foreground">SEDETUS</p>
              {kpis.sedetusExpiry && (
                <p className="text-xs text-muted-foreground">
                  Vence: {new Date(kpis.sedetusExpiry).toLocaleDateString("es-MX")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Requisitos para el siguiente nivel */}
      {progress.requirements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Requisitos para {progress.nextLevelLabel}
            </CardTitle>
            <CardDescription>
              Completa estos requisitos para avanzar al siguiente nivel
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {progress.requirements.map((req, index) => {
              const pct =
                req.required > 0
                  ? Math.min((req.current / req.required) * 100, 100)
                  : req.met
                    ? 100
                    : 0;
              const barColor = getProgressBarColor(req.current, req.required);

              return (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {req.met ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400" />
                      )}
                      {req.label}
                    </span>
                    <span className="text-muted-foreground">
                      {formatRequirementValue(req.current, req.required, req.unit, req.label)}
                    </span>
                  </div>
                  {/* Barra de progreso con color dinamico */}
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Grafico de cierres por mes (barras simples) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5" />
            Cierres por Mes
          </CardTitle>
          <CardDescription>
            Deals cerrados en los ultimos 6 meses
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            {kpis.dealsPerMonth.map((item) => {
              const maxCount = Math.max(...kpis.dealsPerMonth.map((d) => d.count), 1);
              const heightPct = (item.count / maxCount) * 100;

              return (
                <div key={item.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-medium">{item.count}</span>
                  <div className="w-full rounded-t bg-muted" style={{ height: "120px" }}>
                    <div
                      className="w-full rounded-t bg-primary transition-all"
                      style={{
                        height: `${heightPct}%`,
                        marginTop: `${100 - heightPct}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatMonth(item.month)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Comisiones totales */}
      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <div className="rounded-full bg-yellow-100 p-3">
            <TrendingUp className="h-5 w-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{formatMXN(kpis.totalCommissions)}</p>
            <p className="text-sm text-muted-foreground">
              Comisiones totales acumuladas
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
