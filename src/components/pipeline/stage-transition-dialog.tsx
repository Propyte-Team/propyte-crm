// Diálogo para transiciones de etapa con validación de reglas de negocio
// Muestra campos dinámicos según la etapa destino
"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { STAGE_LABELS, STAGE_COLORS, LOST_REASON_LABELS } from "@/lib/constants";
import type { PipelineDeal } from "@/components/pipeline/pipeline-view";

interface StageTransitionDialogProps {
  deal: PipelineDeal;
  toStage: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface UnitOption {
  id: string;
  unitNumber: string;
  unitType: string;
  price: string;
  status: string;
}

export function StageTransitionDialog({
  deal,
  toStage,
  open,
  onOpenChange,
  onSuccess,
}: StageTransitionDialogProps) {
  // Estado de campos dinámicos
  const [unitId, setUnitId] = useState(deal.unitId || "");
  const [actualCloseDate, setActualCloseDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [lostReason, setLostReason] = useState("");
  const [lostReasonDetail, setLostReasonDetail] = useState("");

  // Unidades disponibles (para RESERVED)
  const [units, setUnits] = useState<UnitOption[]>([]);

  // Estado de envío
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar unidades si la transición requiere unidad
  useEffect(() => {
    if (toStage === "RESERVED" && deal.developmentId) {
      const loadUnits = async () => {
        try {
          const res = await fetch(
            `/api/units?developmentId=${deal.developmentId}&status=DISPONIBLE`
          );
          if (res.ok) {
            const json = await res.json();
            setUnits(json.data || []);
          }
        } catch (err) {
          console.error("Error al cargar unidades:", err);
        }
      };
      loadUnits();
    }
  }, [toStage, deal.developmentId]);

  // Enviar transición al servidor
  async function handleConfirm() {
    setError(null);
    setSubmitting(true);

    try {
      const body: any = { stage: toStage };

      // Agregar campos según la etapa destino
      if (toStage === "RESERVED" && unitId) {
        body.unitId = unitId;
      }
      if (toStage === "WON") {
        body.actualCloseDate = actualCloseDate;
      }
      if (toStage === "LOST") {
        body.lostReason = lostReason;
        body.lostReasonDetail = lostReasonDetail || undefined;
      }

      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al cambiar etapa");
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Error al cambiar etapa");
    } finally {
      setSubmitting(false);
    }
  }

  // Determinar si el formulario es válido
  function isValid(): boolean {
    if (toStage === "RESERVED" && !unitId && !deal.unitId) return false;
    if (toStage === "WON" && !actualCloseDate) return false;
    if (toStage === "LOST" && !lostReason) return false;
    return true;
  }

  const fromColor = STAGE_COLORS[deal.stage] || "#6B7280";
  const toColor = STAGE_COLORS[toStage] || "#6B7280";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cambiar Etapa del Deal</DialogTitle>
          <DialogDescription>
            {deal.contactName}
          </DialogDescription>
        </DialogHeader>

        {/* Indicador visual de transición */}
        <div className="flex items-center justify-center gap-3 py-4">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold text-white"
            style={{ backgroundColor: fromColor }}
          >
            {STAGE_LABELS[deal.stage] || deal.stage}
          </span>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold text-white"
            style={{ backgroundColor: toColor }}
          >
            {STAGE_LABELS[toStage] || toStage}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Campos dinámicos según etapa destino */}
        <div className="space-y-4">
          {/* DISCOVERY_DONE: mostrar info del perfil del contacto */}
          {toStage === "DISCOVERY_DONE" && (
            <div className="rounded-md border bg-blue-50 p-4 space-y-2">
              <p className="text-sm font-medium text-blue-800">
                Requisito: el contacto debe tener completado su perfil de inversión
              </p>
              <p className="text-xs text-blue-600">
                Perfil de inversión, tipo de propiedad, presupuesto y horizonte de compra
                deben estar completos antes de avanzar.
              </p>
            </div>
          )}

          {/* RESERVED: selector de unidad */}
          {toStage === "RESERVED" && (
            <div className="space-y-2">
              <Label htmlFor="unit">
                Unidad a Reservar <span className="text-red-500">*</span>
              </Label>
              {deal.unitId ? (
                <div className="rounded-md border bg-green-50 p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-green-700">
                      Unidad ya asignada: {deal.unit}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  {!deal.developmentId && (
                    <p className="text-sm text-amber-600">
                      Este deal no tiene un desarrollo asignado. Asigna uno primero.
                    </p>
                  )}
                  <Select value={unitId} onValueChange={setUnitId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar unidad..." />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.unitNumber} - {u.unitType} - $
                          {Number(u.price).toLocaleString()}
                        </SelectItem>
                      ))}
                      {units.length === 0 && (
                        <div className="p-2 text-center text-sm text-muted-foreground">
                          No hay unidades disponibles
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          )}

          {/* WON: fecha de cierre real */}
          {toStage === "WON" && (
            <div className="space-y-2">
              <Label htmlFor="closeDate">
                Fecha Real de Cierre <span className="text-red-500">*</span>
              </Label>
              <Input
                id="closeDate"
                type="date"
                value={actualCloseDate}
                onChange={(e) => setActualCloseDate(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Se calcularán las comisiones correspondientes al cerrar como ganado.
              </p>
            </div>
          )}

          {/* LOST: razón de pérdida */}
          {toStage === "LOST" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="lostReason">
                  Razón de Pérdida <span className="text-red-500">*</span>
                </Label>
                <Select value={lostReason} onValueChange={setLostReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar razón..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LOST_REASON_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lostDetail">Detalle (opcional)</Label>
                <Input
                  id="lostDetail"
                  placeholder="Describe brevemente el motivo..."
                  value={lostReasonDetail}
                  onChange={(e) => setLostReasonDetail(e.target.value)}
                  maxLength={500}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || !isValid()}
            variant={toStage === "LOST" ? "destructive" : "default"}
          >
            {submitting ? "Procesando..." : "Confirmar Cambio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
