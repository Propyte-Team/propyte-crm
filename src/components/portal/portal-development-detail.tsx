// Detalle de desarrollo para el portal de desarrollador externo
// Muestra métricas agregadas SIN revelar datos de contactos individuales
"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Calendar,
  Percent,
  TrendingUp,
  DollarSign,
  Users,
  BarChart3,
} from "lucide-react";
import {
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_STATUS_COLORS,
  UNIT_STATUS_LABELS,
  UNIT_TYPE_LABELS,
  formatCurrency,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

// Colores de fondo para el grid de unidades
const STATUS_BG: Record<string, string> = {
  DISPONIBLE: "bg-green-400 text-white",
  APARTADA: "bg-yellow-400 text-yellow-900",
  VENDIDA: "bg-red-400 text-white",
  NO_DISPONIBLE: "bg-gray-300 text-gray-600",
};

// Tipo de unidad sin datos de contacto (mascarada)
interface PortalUnit {
  id: string;
  unitNumber: string;
  unitType: string;
  area_m2: string | number;
  price: string | number;
  currency: string;
  floor: number | null;
  status: string;
}

// Tipo del pipeline por etapa
interface PipelineStageData {
  stage: string;
  label: string;
  count: number;
  totalValue: number;
}

// Tipo de venta mensual
interface MonthlySale {
  month: string;
  count: number;
}

// Props del componente
interface PortalDevelopmentDetailProps {
  data: {
    development: {
      id: string;
      name: string;
      developerName: string;
      location: string;
      status: string;
      developmentType: string;
      totalUnits: number;
      commissionRate: string | number;
      deliveryDate: string | null;
      totalDevelopmentValue: string | number | null;
      currency: string;
      plaza: string;
      constructionProgress: number;
      priceMin: string | number;
      priceMax: string | number;
      createdAt: string;
    };
    units: PortalUnit[];
    unitSummary: {
      total: number;
      disponible: number;
      apartada: number;
      vendida: number;
      noDisponible: number;
    };
    pipelineByStage: PipelineStageData[];
    monthlySales: MonthlySale[];
    absorptionRate: number;
    pipelineValue: number;
    activitySummary: {
      meetings: number;
      proposals: number;
      visits: number;
    };
  };
}

export function PortalDevelopmentDetail({
  data,
}: PortalDevelopmentDetailProps) {
  const { development: dev, units, unitSummary, pipelineByStage, monthlySales, absorptionRate, pipelineValue, activitySummary } = data;

  // Formatear fecha de entrega
  const deliveryDateStr = dev.deliveryDate
    ? new Date(dev.deliveryDate).toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
      })
    : "Sin definir";

  return (
    <div className="space-y-6">
      {/* Enlace para volver */}
      <Link
        href="/portal"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al dashboard
      </Link>

      {/* Tarjeta de información del desarrollo */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{dev.name}</h1>
            <p className="mt-1 text-sm text-gray-500">
              Desarrollador: {dev.developerName}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-sm font-semibold",
              DEVELOPMENT_STATUS_COLORS[dev.status] || "bg-gray-100 text-gray-700"
            )}
          >
            {DEVELOPMENT_STATUS_LABELS[dev.status] || dev.status}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {/* Ubicación */}
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Ubicación</p>
              <p className="text-sm font-medium">{dev.location}</p>
            </div>
          </div>

          {/* Valor total */}
          <div className="flex items-start gap-2">
            <DollarSign className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Valor Total</p>
              <p className="text-sm font-medium">
                {dev.totalDevelopmentValue
                  ? formatCurrency(Number(dev.totalDevelopmentValue), dev.currency)
                  : "N/A"}
              </p>
            </div>
          </div>

          {/* Comisión */}
          <div className="flex items-start gap-2">
            <Percent className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Comisión</p>
              <p className="text-sm font-medium">{Number(dev.commissionRate)}%</p>
            </div>
          </div>

          {/* Entrega */}
          <div className="flex items-start gap-2">
            <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Entrega</p>
              <p className="text-sm font-medium">{deliveryDateStr}</p>
            </div>
          </div>

          {/* Avance construcción */}
          <div className="flex items-start gap-2">
            <Building2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Avance</p>
              <p className="text-sm font-medium">{dev.constructionProgress}%</p>
            </div>
          </div>

          {/* Rango de precios */}
          <div className="flex items-start gap-2">
            <BarChart3 className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Rango precios</p>
              <p className="text-sm font-medium">
                {formatCurrency(Number(dev.priceMin), dev.currency)} -{" "}
                {formatCurrency(Number(dev.priceMax), dev.currency)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tarjetas de estadísticas */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Unidades"
          value={unitSummary.total.toString()}
          color="bg-gray-50"
          textColor="text-gray-900"
        />
        <StatCard
          label="Disponibles"
          value={unitSummary.disponible.toString()}
          color="bg-green-50"
          textColor="text-green-700"
        />
        <StatCard
          label="Apartadas"
          value={unitSummary.apartada.toString()}
          color="bg-yellow-50"
          textColor="text-yellow-700"
        />
        <StatCard
          label="Vendidas"
          value={unitSummary.vendida.toString()}
          color="bg-red-50"
          textColor="text-red-700"
        />
        <StatCard
          label="Absorción"
          value={`${absorptionRate} uds/mes`}
          color="bg-emerald-50"
          textColor="text-emerald-700"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Valor Pipeline"
          value={formatCurrency(pipelineValue, dev.currency)}
          color="bg-blue-50"
          textColor="text-blue-700"
          icon={<DollarSign className="h-4 w-4" />}
        />
      </div>

      {/* Grid de disponibilidad de unidades (SIN info de contacto) */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Mapa de Disponibilidad
        </h2>

        {/* Leyenda */}
        <div className="mb-4 flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-green-400" />
            Disponible
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-yellow-400" />
            Apartada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-red-400" />
            Vendida
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-gray-300" />
            No Disponible
          </span>
        </div>

        {/* Grid de unidades */}
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12">
          {units.map((unit) => (
            <div
              key={unit.id}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-md p-1 text-xs font-medium",
                STATUS_BG[unit.status] || STATUS_BG.NO_DISPONIBLE
              )}
              title={`${unit.unitNumber} - ${
                UNIT_STATUS_LABELS[unit.status] || unit.status
              } - ${UNIT_TYPE_LABELS[unit.unitType] || unit.unitType} - ${
                Number(unit.area_m2)
              } m2 - ${formatCurrency(Number(unit.price), unit.currency)}`}
            >
              <span className="truncate text-[10px] leading-none">
                {unit.unitNumber}
              </span>
            </div>
          ))}
          {units.length === 0 && (
            <div className="col-span-full py-8 text-center text-sm text-gray-400">
              No hay unidades registradas
            </div>
          )}
        </div>
      </div>

      {/* Pipeline por etapa (SIN datos de contacto) */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Resumen de Pipeline
        </h2>

        {pipelineByStage.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">
            No hay deals activos en el pipeline
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 pr-4 font-medium text-gray-500">
                    Etapa
                  </th>
                  <th className="pb-3 pr-4 text-right font-medium text-gray-500">
                    Deals
                  </th>
                  <th className="pb-3 text-right font-medium text-gray-500">
                    Valor Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {pipelineByStage.map((stage) => (
                  <tr key={stage.stage} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium text-gray-700">
                      {stage.label}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-600">
                      {stage.count}
                    </td>
                    <td className="py-3 text-right font-medium text-gray-900">
                      {formatCurrency(stage.totalValue, dev.currency)}
                    </td>
                  </tr>
                ))}
                {/* Fila de totales */}
                <tr className="border-t-2 font-semibold">
                  <td className="pt-3 pr-4 text-gray-900">Total</td>
                  <td className="pt-3 pr-4 text-right text-gray-900">
                    {pipelineByStage.reduce((sum, s) => sum + s.count, 0)}
                  </td>
                  <td className="pt-3 text-right text-gray-900">
                    {formatCurrency(
                      pipelineByStage.reduce((sum, s) => sum + s.totalValue, 0),
                      dev.currency
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Resumen de actividad reciente (agregado, sin datos individuales) */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Actividad Reciente
        </h2>
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">
            {activitySummary.meetings}
          </span>{" "}
          reuniones,{" "}
          <span className="font-semibold text-gray-900">
            {activitySummary.proposals}
          </span>{" "}
          propuestas,{" "}
          <span className="font-semibold text-gray-900">
            {activitySummary.visits}
          </span>{" "}
          visitas en los últimos 30 días
        </p>
      </div>

      {/* Tendencia mensual de ventas */}
      {monthlySales.length > 0 && (
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Ventas Mensuales
          </h2>
          <div className="flex items-end gap-2">
            {monthlySales.map((sale) => {
              // Calcular altura relativa al máximo
              const maxCount = Math.max(
                ...monthlySales.map((s) => s.count),
                1
              );
              const heightPct = (sale.count / maxCount) * 100;

              return (
                <div
                  key={sale.month}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="text-xs font-medium text-gray-700">
                    {sale.count}
                  </span>
                  <div
                    className="w-full rounded-t bg-[#1E3A5F] transition-all"
                    style={{
                      height: `${Math.max(heightPct, 8)}px`,
                      minHeight: "4px",
                      maxHeight: "120px",
                    }}
                  />
                  <span className="text-[10px] text-gray-500">
                    {formatMonth(sale.month)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Tarjeta de estadística reutilizable
function StatCard({
  label,
  value,
  color,
  textColor,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  textColor: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border p-4 shadow-sm", color)}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={cn("mt-1 text-lg font-bold", textColor)}>
        {icon && <span className="mr-1 inline-block align-middle">{icon}</span>}
        {value}
      </p>
    </div>
  );
}

// Formatea "2024-03" a "Mar 24"
function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const monthNames = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  const monthIndex = parseInt(month, 10) - 1;
  return `${monthNames[monthIndex] || month} ${year.slice(2)}`;
}
