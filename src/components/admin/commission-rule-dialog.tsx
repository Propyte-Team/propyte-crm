// Dialogo de formulario para crear/editar reglas de comision
// Selects para DealType, LeadSourceCategory y UserRole
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
import {
  DEAL_TYPE_LABELS,
  LEAD_SOURCE_CATEGORY_LABELS,
  ROLE_LABELS,
} from "@/lib/constants";
import { z } from "zod";

// Esquema de validacion
const ruleFormSchema = z.object({
  dealType: z.string().min(1, "Selecciona un tipo de operacion"),
  leadSourceCategory: z.string().min(1, "Selecciona una categoria de fuente"),
  role: z.string().min(1, "Selecciona un rol"),
  percentage: z.number().min(0, "Minimo 0%").max(100, "Maximo 100%"),
  isActive: z.boolean(),
});

interface CommissionRuleData {
  id: string;
  dealType: string;
  leadSourceCategory: string;
  role: string;
  percentage: any;
  isActive: boolean;
}

interface CommissionRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: CommissionRuleData | null;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  isPending: boolean;
}

export function CommissionRuleDialog({
  open,
  onOpenChange,
  rule,
  onSubmit,
  isPending,
}: CommissionRuleDialogProps) {
  const isEditing = !!rule;

  // Estado del formulario
  const [formData, setFormData] = useState({
    dealType: "",
    leadSourceCategory: "",
    role: "",
    percentage: "",
    isActive: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Inicializar formulario cuando cambia la regla a editar
  useEffect(() => {
    if (rule) {
      setFormData({
        dealType: rule.dealType,
        leadSourceCategory: rule.leadSourceCategory,
        role: rule.role,
        percentage: String(Number(rule.percentage)),
        isActive: rule.isActive,
      });
    } else {
      setFormData({
        dealType: "",
        leadSourceCategory: "",
        role: "",
        percentage: "",
        isActive: true,
      });
    }
    setErrors({});
  }, [rule, open]);

  // Manejar cambios
  function handleChange(field: string, value: string | boolean) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  // Validar y enviar
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const dataToValidate = {
      ...formData,
      percentage: parseFloat(formData.percentage) || 0,
    };

    const result = ruleFormSchema.safeParse(dataToValidate);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0]?.toString();
        if (field) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    await onSubmit({
      dealType: formData.dealType,
      leadSourceCategory: formData.leadSourceCategory,
      role: formData.role,
      percentage: parseFloat(formData.percentage),
      isActive: formData.isActive,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar Regla de Comision" : "Nueva Regla de Comision"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Modifica los parametros de la regla seleccionada"
              : "Configura una nueva regla de comision"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo de operacion */}
          <div className="space-y-2">
            <Label>Tipo de Operacion</Label>
            <Select
              value={formData.dealType}
              onValueChange={(v) => handleChange("dealType", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DEAL_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.dealType && (
              <p className="text-sm text-red-500">{errors.dealType}</p>
            )}
          </div>

          {/* Categoria de fuente */}
          <div className="space-y-2">
            <Label>Categoria de Fuente</Label>
            <Select
              value={formData.leadSourceCategory}
              onValueChange={(v) => handleChange("leadSourceCategory", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar categoria" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LEAD_SOURCE_CATEGORY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.leadSourceCategory && (
              <p className="text-sm text-red-500">{errors.leadSourceCategory}</p>
            )}
          </div>

          {/* Rol */}
          <div className="space-y-2">
            <Label>Rol que recibe la comision</Label>
            <Select
              value={formData.role}
              onValueChange={(v) => handleChange("role", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.role && (
              <p className="text-sm text-red-500">{errors.role}</p>
            )}
          </div>

          {/* Porcentaje */}
          <div className="space-y-2">
            <Label htmlFor="percentage">Porcentaje (%)</Label>
            <Input
              id="percentage"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={formData.percentage}
              onChange={(e) => handleChange("percentage", e.target.value)}
              placeholder="2.5"
            />
            {errors.percentage && (
              <p className="text-sm text-red-500">{errors.percentage}</p>
            )}
          </div>

          {/* Activa */}
          <div className="flex items-center gap-3">
            <Label htmlFor="isActive" className="cursor-pointer">
              Regla activa
            </Label>
            <input
              id="isActive"
              type="checkbox"
              checked={formData.isActive}
              onChange={(e) => handleChange("isActive", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Procesando..."
                : isEditing
                  ? "Actualizar Regla"
                  : "Crear Regla"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
