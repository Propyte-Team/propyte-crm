// Cliente para detalle de desarrollo con mapa de unidades y estadísticas
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Calendar,
  ExternalLink,
  Edit,
  DollarSign,
  Percent,
  BarChart3,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_STATUS_COLORS,
  DEVELOPMENT_TYPE_LABELS,
  PLAZA_LABELS,
  UNIT_TYPE_LABELS,
  formatCurrency,
} from "@/lib/constants";
import { UnitGrid } from "@/components/developments/unit-grid";

interface DevelopmentDetailClientProps {
  development: any;
  isAdmin: boolean;
}

export function DevelopmentDetailClient({
  development,
  isAdmin,
}: DevelopmentDetailClientProps) {
  const router = useRouter();
  const dev = development;

  // Calcular estadísticas de unidades
  const units = dev.units || [];
  const disponible = units.filter((u: any) => u.status === "DISPONIBLE").length;
  const apartada = units.filter((u: any) => u.status === "APARTADA").length;
  const vendida = units.filter((u: any) => u.status === "VENDIDA").length;
  const noDisponible = units.filter((u: any) => u.status === "NO_DISPONIBLE").length;
  const totalUnits = units.length;

  // Tasa de absorción
  const absorptionRate = totalUnits > 0 ? ((vendida + apartada) / totalUnits) * 100 : 0;

  // Ingreso total
  const totalRevenue = units
    .filter((u: any) => u.status === "VENDIDA" && u.salePrice)
    .reduce((sum: number, u: any) => sum + Number(u.salePrice || 0), 0);

  const statusColors = DEVELOPMENT_STATUS_COLORS[dev.status] || "bg-gray-100 text-gray-700";

  // Formatear fecha
  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("es-MX", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div className="space-y-6">
      {/* Navegación */}
      <Button variant="ghost" size="sm" onClick={() => router.push("/developments")}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        Desarrollos
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{dev.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColors}`}>
              {DEVELOPMENT_STATUS_LABELS[dev.status] || dev.status}
            </span>
            <span className="text-sm text-muted-foreground">
              {dev.developerName}
            </span>
            <span className="text-sm text-muted-foreground">
              {DEVELOPMENT_TYPE_LABELS[dev.developmentType] || dev.developmentType}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {dev.brochureUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={dev.brochureUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" />
                {dev.brochureUrl.includes("drive.google.com") ? "Carpeta Drive" : "Brochure"}
              </a>
            </Button>
          )}
          {dev.virtualTourUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={dev.virtualTourUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" />
                Tour Virtual
              </a>
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm">
              <Edit className="mr-1 h-4 w-4" />
              Editar
            </Button>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Building2 className="h-5 w-5" />}
          label="Unidades Totales"
          value={totalUnits.toString()}
          detail={`${disponible} disponibles`}
        />
        <StatCard
          icon={<BarChart3 className="h-5 w-5" />}
          label="Absorción"
          value={`${absorptionRate.toFixed(1)}%`}
          detail={`${vendida} vendidas, ${apartada} apartadas`}
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Rango de Precios"
          value={formatCurrency(Number(dev.priceMin), dev.currency)}
          detail={`a ${formatCurrency(Number(dev.priceMax), dev.currency)}`}
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Ingreso por Ventas"
          value={formatCurrency(totalRevenue, dev.currency)}
          detail={`Comisión: ${Number(dev.commissionRate)}%`}
        />
      </div>

      {/* Información del desarrollo */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Información General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ubicación</span>
              <span className="font-medium flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {dev.location}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plaza</span>
              <span className="font-medium">{PLAZA_LABELS[dev.plaza] || dev.plaza}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Moneda</span>
              <span className="font-medium">{dev.currency}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Progreso de Construcción</span>
              <span className="font-medium">{dev.constructionProgress}%</span>
            </div>
            <Progress value={dev.constructionProgress} className="h-2" />
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fecha de Entrega</span>
              <span className="font-medium">{formatDate(dev.deliveryDate)}</span>
            </div>
            {dev.contractStartDate && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contrato</span>
                  <span className="font-medium">
                    {formatDate(dev.contractStartDate)} - {formatDate(dev.contractEndDate)}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Descripción y Amenidades</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{dev.description}</p>
            {dev.amenities && dev.amenities.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Amenidades:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {dev.amenities.map((amenity: string, idx: number) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {amenity}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mapa de unidades */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Mapa de Disponibilidad ({totalUnits} unidades)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UnitGrid units={units} />
        </CardContent>
      </Card>

      {/* Tabla de unidades */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle de Unidades</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Unidad</th>
                  <th className="pb-3 font-medium">Tipo</th>
                  <th className="pb-3 font-medium">Piso</th>
                  <th className="pb-3 font-medium">Area (m2)</th>
                  <th className="pb-3 font-medium">Precio</th>
                  <th className="pb-3 font-medium">Estado</th>
                  <th className="pb-3 font-medium">Reservado por</th>
                  <th className="pb-3 font-medium">Deals</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit: any) => {
                  const statusMap: Record<string, { label: string; className: string }> = {
                    DISPONIBLE: { label: "Disponible", className: "bg-green-100 text-green-700" },
                    APARTADA: { label: "Apartada", className: "bg-yellow-100 text-yellow-700" },
                    VENDIDA: { label: "Vendida", className: "bg-red-100 text-red-700" },
                    NO_DISPONIBLE: { label: "No Disponible", className: "bg-gray-100 text-gray-500" },
                  };
                  const statusConfig = statusMap[unit.status] || statusMap.NO_DISPONIBLE;

                  return (
                    <tr
                      key={unit.id}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="py-3 font-medium">{unit.unitNumber}</td>
                      <td className="py-3 text-muted-foreground">
                        {UNIT_TYPE_LABELS[unit.unitType] || unit.unitType}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {unit.floor ?? "-"}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {Number(unit.area_m2)}
                      </td>
                      <td className="py-3 font-medium">
                        {formatCurrency(Number(unit.price), unit.currency)}
                      </td>
                      <td className="py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusConfig.className}`}>
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="py-3 text-muted-foreground text-xs">
                        {unit.reservedByContact
                          ? `${unit.reservedByContact.firstName} ${unit.reservedByContact.lastName}`
                          : "-"}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {unit._count?.deals || 0}
                      </td>
                    </tr>
                  );
                })}
                {units.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No hay unidades registradas para este desarrollo
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Componente auxiliar para tarjetas de estadística
function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
          {icon}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
