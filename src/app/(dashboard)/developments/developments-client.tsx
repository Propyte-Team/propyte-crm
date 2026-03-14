// Cliente para la lista de desarrollos con filtros y grid
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Home, DollarSign, Plus, Filter, Building2, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Progress } from "@/components/ui/progress";
import {
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_STATUS_COLORS,
  DEVELOPMENT_TYPE_LABELS,
  PLAZA_LABELS,
  formatCurrency,
} from "@/lib/constants";
import { DevelopmentForm } from "@/components/developments/development-form";

interface DevelopmentsClientProps {
  initialDevelopments: any[];
  isAdmin: boolean;
  userRole: string;
}

export function DevelopmentsClient({
  initialDevelopments,
  isAdmin,
  userRole,
}: DevelopmentsClientProps) {
  const router = useRouter();
  const [developments] = useState(initialDevelopments);
  const [showNewDev, setShowNewDev] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filtros
  const [filterPlaza, setFilterPlaza] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");

  // Aplicar filtros
  const filteredDevs = developments.filter((dev: any) => {
    if (filterPlaza !== "all" && dev.plaza !== filterPlaza) return false;
    if (filterStatus !== "all" && dev.status !== filterStatus) return false;
    if (filterType !== "all" && dev.developmentType !== filterType) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Desarrollos</h1>
          <p className="text-muted-foreground">
            Catálogo de desarrollos inmobiliarios ({filteredDevs.length})
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="mr-1 h-4 w-4" />
            Filtros
          </Button>
          {isAdmin && (
            <Dialog open={showNewDev} onOpenChange={setShowNewDev}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo Desarrollo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Crear Nuevo Desarrollo</DialogTitle>
                </DialogHeader>
                <DevelopmentForm
                  onSuccess={() => {
                    setShowNewDev(false);
                    router.refresh();
                  }}
                  onCancel={() => setShowNewDev(false)}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Filtros */}
      {showFilters && (
        <Card>
          <CardContent className="flex flex-wrap gap-4 p-4">
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Plaza
              </label>
              <Select value={filterPlaza} onValueChange={setFilterPlaza}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las plazas</SelectItem>
                  {Object.entries(PLAZA_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Estado
              </label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  {Object.entries(DEVELOPMENT_STATUS_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tipo
              </label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  {Object.entries(DEVELOPMENT_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterPlaza("all");
                  setFilterStatus("all");
                  setFilterType("all");
                }}
              >
                Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grid de tarjetas de desarrollos */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredDevs.map((dev: any) => {
          const statusColors = DEVELOPMENT_STATUS_COLORS[dev.status] || "bg-gray-100 text-gray-700";
          const unitCounts = dev.unitCounts || {
            disponible: dev.availableUnits,
            apartada: dev.reservedUnits || 0,
            vendida: dev.soldUnits || 0,
            total: dev.totalUnits,
          };
          const totalRegistered = unitCounts.total || dev.totalUnits;
          const disponiblePct = totalRegistered > 0
            ? (unitCounts.disponible / totalRegistered) * 100
            : 0;

          return (
            <Card
              key={dev.id}
              className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => router.push(`/developments/${dev.id}`)}
            >
              {/* Placeholder de imagen */}
              <div className="flex h-36 items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                <Building2 className="h-12 w-12 text-primary/30" />
              </div>

              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg truncate">{dev.name}</CardTitle>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors}`}>
                    {DEVELOPMENT_STATUS_LABELS[dev.status] || dev.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {dev.developerName} &middot;{" "}
                  {DEVELOPMENT_TYPE_LABELS[dev.developmentType] || dev.developmentType}
                </p>
              </CardHeader>

              <CardContent className="space-y-3">
                {/* Ubicación */}
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{dev.location}</span>
                  <span className="ml-auto text-xs">
                    {PLAZA_LABELS[dev.plaza] || dev.plaza}
                  </span>
                </div>

                {/* Unidades disponibles */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Unidades</span>
                    <span className="font-medium">
                      {unitCounts.disponible}{" "}
                      <span className="text-muted-foreground">
                        / {totalRegistered} disponibles
                      </span>
                    </span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                    {/* Verde: disponible */}
                    <div
                      className="h-full bg-green-500"
                      style={{ width: `${(unitCounts.disponible / Math.max(totalRegistered, 1)) * 100}%` }}
                    />
                    {/* Amarillo: apartada */}
                    <div
                      className="h-full bg-yellow-400"
                      style={{ width: `${(unitCounts.apartada / Math.max(totalRegistered, 1)) * 100}%` }}
                    />
                    {/* Rojo: vendida */}
                    <div
                      className="h-full bg-red-500"
                      style={{ width: `${(unitCounts.vendida / Math.max(totalRegistered, 1)) * 100}%` }}
                    />
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      {unitCounts.disponible} disp.
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-yellow-400" />
                      {unitCounts.apartada} apart.
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      {unitCounts.vendida} vend.
                    </span>
                  </div>
                </div>

                {/* Rango de precios */}
                <div className="flex items-center gap-1 text-sm">
                  <DollarSign className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium">
                    {formatCurrency(Number(dev.priceMin), dev.currency)} -{" "}
                    {formatCurrency(Number(dev.priceMax), dev.currency)}
                  </span>
                </div>

                {/* Comisión */}
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Percent className="h-4 w-4 flex-shrink-0" />
                  <span>Comisión: {Number(dev.commissionRate)}%</span>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filteredDevs.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No se encontraron desarrollos con los filtros actuales
          </div>
        )}
      </div>
    </div>
  );
}
