// Componente generico de tabla de reporte con soporte para formato de moneda
// y fila de totales
"use client";

import { formatMXN } from "@/lib/constants";

// Definicion de columna
export interface ReportColumn {
  header: string;
  key: string;
  isCurrency?: boolean;
  isPercentage?: boolean;
}

interface ReportTableProps {
  columns: ReportColumn[];
  data: Record<string, unknown>[];
  title?: string;
  showTotals?: boolean;
}

export function ReportTable({ columns, data, title, showTotals = true }: ReportTableProps) {
  // Calcular totales para columnas numericas
  const totals: Record<string, number> = {};
  if (showTotals && data.length > 0) {
    for (const col of columns) {
      const firstValue = data[0]?.[col.key];
      if (typeof firstValue === "number") {
        totals[col.key] = data.reduce((sum, row) => {
          const val = row[col.key];
          return sum + (typeof val === "number" ? val : 0);
        }, 0);
      }
    }
  }

  // Formatear valor de celda segun tipo de columna
  function formatValue(value: unknown, column: ReportColumn): string {
    if (value === null || value === undefined) return "-";
    if (column.isCurrency && typeof value === "number") {
      return formatMXN(value);
    }
    if (column.isPercentage && typeof value === "number") {
      return `${value}%`;
    }
    if (typeof value === "object") {
      // Para objetos (como byStage, byAdvisor), mostrar como lista
      const obj = value as Record<string, number>;
      return Object.entries(obj)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
    }
    return String(value);
  }

  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-sm font-semibold text-muted-foreground uppercase">
          {title}
        </h3>
      )}

      {data.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          No hay datos para mostrar con los filtros seleccionados
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                {columns.map((col) => (
                  <th key={col.key} className="px-4 py-3 font-medium">
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, index) => (
                <tr
                  key={index}
                  className="border-b last:border-0 hover:bg-muted/30"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 ${
                        col.isCurrency || col.isPercentage
                          ? "text-right font-medium"
                          : ""
                      }`}
                    >
                      {formatValue(row[col.key], col)}
                    </td>
                  ))}
                </tr>
              ))}

              {/* Fila de totales */}
              {showTotals && Object.keys(totals).length > 0 && (
                <tr className="border-t-2 bg-muted/30 font-semibold">
                  {columns.map((col, index) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 ${
                        col.isCurrency || col.isPercentage
                          ? "text-right"
                          : ""
                      }`}
                    >
                      {index === 0 && !totals[col.key]
                        ? "TOTAL"
                        : totals[col.key] !== undefined
                          ? formatValue(totals[col.key], col)
                          : ""}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
