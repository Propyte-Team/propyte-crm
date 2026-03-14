// Mapa visual de unidades con cuadrícula coloreada por estado
// Verde = DISPONIBLE, Amarillo = APARTADA, Rojo = VENDIDA, Gris = NO_DISPONIBLE
"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UNIT_STATUS_LABELS,
  UNIT_STATUS_COLORS,
  UNIT_TYPE_LABELS,
  formatCurrency,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

interface UnitGridProps {
  units: any[];
}

// Colores de fondo para el grid según estado
const STATUS_BG: Record<string, string> = {
  DISPONIBLE: "bg-green-400 hover:bg-green-500 text-white",
  APARTADA: "bg-yellow-400 hover:bg-yellow-500 text-yellow-900",
  VENDIDA: "bg-red-400 hover:bg-red-500 text-white",
  NO_DISPONIBLE: "bg-gray-300 hover:bg-gray-400 text-gray-600",
};

export function UnitGrid({ units }: UnitGridProps) {
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [selectedUnit, setSelectedUnit] = useState<any | null>(null);

  // Filtrar unidades
  const filteredUnits = units.filter((u) => {
    if (filterStatus !== "all" && u.status !== filterStatus) return false;
    if (filterType !== "all" && u.unitType !== filterType) return false;
    return true;
  });

  // Obtener tipos únicos
  const uniqueTypes = Array.from(new Set(units.map((u: any) => u.unitType as string)));

  return (
    <div className="space-y-4">
      {/* Filtros y leyenda */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-3">
          {/* Filtro por estado */}
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {Object.entries(UNIT_STATUS_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filtro por tipo */}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Todos los tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {uniqueTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {UNIT_TYPE_LABELS[type] || type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Leyenda */}
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-green-400" />
            Disponible
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-yellow-400" />
            Apartada
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-red-400" />
            Vendida
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-gray-300" />
            No Disponible
          </span>
        </div>
      </div>

      {/* Grid de unidades */}
      <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
        {filteredUnits.map((unit) => (
          <button
            key={unit.id}
            onClick={() => setSelectedUnit(selectedUnit?.id === unit.id ? null : unit)}
            className={cn(
              "relative flex flex-col items-center justify-center rounded-md p-1.5 text-xs font-medium transition-all cursor-pointer aspect-square",
              STATUS_BG[unit.status] || STATUS_BG.NO_DISPONIBLE,
              selectedUnit?.id === unit.id && "ring-2 ring-primary ring-offset-2 scale-110 z-10"
            )}
            title={`${unit.unitNumber} - ${UNIT_STATUS_LABELS[unit.status] || unit.status}`}
          >
            <span className="truncate text-[10px] leading-none">{unit.unitNumber}</span>
          </button>
        ))}

        {filteredUnits.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
            No hay unidades con los filtros seleccionados
          </div>
        )}
      </div>

      {/* Popover con detalle de unidad seleccionada */}
      {selectedUnit && (
        <div className="rounded-lg border bg-card p-4 shadow-md animate-in fade-in slide-in-from-bottom-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Unidad</p>
              <p className="font-semibold">{selectedUnit.unitNumber}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tipo</p>
              <p className="font-medium">
                {UNIT_TYPE_LABELS[selectedUnit.unitType] || selectedUnit.unitType}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Area</p>
              <p className="font-medium">{Number(selectedUnit.area_m2)} m2</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Piso</p>
              <p className="font-medium">{selectedUnit.floor ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Precio</p>
              <p className="font-semibold">
                {formatCurrency(Number(selectedUnit.price), selectedUnit.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estado</p>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                  UNIT_STATUS_COLORS[selectedUnit.status]?.bg,
                  UNIT_STATUS_COLORS[selectedUnit.status]?.text
                )}
              >
                {UNIT_STATUS_LABELS[selectedUnit.status] || selectedUnit.status}
              </span>
            </div>
            {selectedUnit.reservedByContact && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Reservado por</p>
                <p className="font-medium">
                  {selectedUnit.reservedByContact.firstName}{" "}
                  {selectedUnit.reservedByContact.lastName}
                  {selectedUnit.reservedByUser && (
                    <span className="text-muted-foreground">
                      {" "}
                      (Asesor: {selectedUnit.reservedByUser.name})
                    </span>
                  )}
                </p>
              </div>
            )}
            {selectedUnit.salePrice && (
              <div>
                <p className="text-xs text-muted-foreground">Precio de Venta</p>
                <p className="font-semibold text-green-600">
                  {formatCurrency(Number(selectedUnit.salePrice), selectedUnit.currency)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
