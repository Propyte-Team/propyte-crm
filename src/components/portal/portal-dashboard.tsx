// Dashboard del portal de desarrollador externo
// Muestra tarjetas con resumen de cada desarrollo asignado
"use client";

import Link from "next/link";
import {
  Building2,
  MapPin,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import {
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_STATUS_COLORS,
  formatCurrency,
} from "@/lib/constants";

// Tipo del resumen de desarrollo que viene del server action
interface DevelopmentSummary {
  id: string;
  name: string;
  location: string;
  status: string;
  totalUnits: number;
  availableCount: number;
  reservedCount: number;
  soldCount: number;
  activeDealsCount: number;
  pipelineValue: number;
  absorptionRate: number;
  recentDealCount: number;
  currency: string;
}

interface PortalDashboardProps {
  data: {
    userName: string;
    developments: DevelopmentSummary[];
  };
}

export function PortalDashboard({ data }: PortalDashboardProps) {
  const { userName, developments } = data;

  return (
    <div className="space-y-6">
      {/* Mensaje de bienvenida */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">
          Bienvenido, {userName}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Aquí puedes ver el estado de tus desarrollos y el avance del pipeline
          de ventas.
        </p>
      </div>

      {/* Grid de tarjetas de desarrollos */}
      {developments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-white px-6 py-16 shadow-sm">
          <Building2 className="mb-4 h-12 w-12 text-gray-300" />
          <p className="text-lg font-medium text-gray-500">
            No hay desarrollos asignados
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Contacta a tu representante de Propyte para más información.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {developments.map((dev) => (
            <DevelopmentCard key={dev.id} development={dev} />
          ))}
        </div>
      )}
    </div>
  );
}

// Tarjeta individual de desarrollo
function DevelopmentCard({
  development: dev,
}: {
  development: DevelopmentSummary;
}) {
  // Porcentajes para la barra de progreso
  const total = dev.totalUnits || 1;
  const soldPct = (dev.soldCount / total) * 100;
  const reservedPct = (dev.reservedCount / total) * 100;
  const availablePct = (dev.availableCount / total) * 100;

  return (
    <div className="flex flex-col rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Encabezado con nombre y badge de estado */}
      <div className="border-b p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-gray-900">
              {dev.name}
            </h3>
            <div className="mt-1 flex items-center gap-1 text-sm text-gray-500">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{dev.location}</span>
            </div>
          </div>
          <span
            className={`ml-2 flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              DEVELOPMENT_STATUS_COLORS[dev.status] || "bg-gray-100 text-gray-700"
            }`}
          >
            {DEVELOPMENT_STATUS_LABELS[dev.status] || dev.status}
          </span>
        </div>
      </div>

      {/* Cuerpo con métricas */}
      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Barra de progreso de unidades */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>Progreso de ventas</span>
            <span>
              {dev.soldCount} de {dev.totalUnits} vendidas
            </span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
            {/* Vendidas (rojo) */}
            {soldPct > 0 && (
              <div
                className="bg-red-400 transition-all"
                style={{ width: `${soldPct}%` }}
                title={`Vendidas: ${dev.soldCount}`}
              />
            )}
            {/* Apartadas (amarillo) */}
            {reservedPct > 0 && (
              <div
                className="bg-yellow-400 transition-all"
                style={{ width: `${reservedPct}%` }}
                title={`Apartadas: ${dev.reservedCount}`}
              />
            )}
            {/* Disponibles (verde) */}
            {availablePct > 0 && (
              <div
                className="bg-green-400 transition-all"
                style={{ width: `${availablePct}%` }}
                title={`Disponibles: ${dev.availableCount}`}
              />
            )}
          </div>
          {/* Leyenda compacta */}
          <div className="mt-1.5 flex gap-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-400" />
              {dev.availableCount} disp.
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-yellow-400" />
              {dev.reservedCount} apart.
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              {dev.soldCount} vend.
            </span>
          </div>
        </div>

        {/* Métricas clave */}
        <div className="grid grid-cols-2 gap-3">
          {/* Pipeline activo */}
          <div className="rounded-md bg-blue-50 px-3 py-2">
            <p className="text-[11px] font-medium text-blue-600">
              Pipeline activo
            </p>
            <p className="text-sm font-bold text-blue-900">
              {formatCurrency(dev.pipelineValue, dev.currency)}
            </p>
          </div>

          {/* Absorción */}
          <div className="rounded-md bg-emerald-50 px-3 py-2">
            <p className="text-[11px] font-medium text-emerald-600">
              Absorción
            </p>
            <p className="text-sm font-bold text-emerald-900">
              <TrendingUp className="mb-0.5 inline h-3.5 w-3.5" />{" "}
              {dev.absorptionRate} uds/mes
            </p>
          </div>
        </div>
      </div>

      {/* Footer con botón de detalle */}
      <div className="border-t px-4 py-3">
        <Link
          href={`/portal/developments/${dev.id}`}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-[#1E3A5F] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2D5A8E]"
        >
          Ver Detalle
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
