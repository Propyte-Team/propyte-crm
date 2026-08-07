// Cambio de estado de un usuario. Suspender exige motivo: sin él, en tres
// semanas nadie recuerda por qué esa cuenta está detenida.
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useToast } from "@/components/ui/use-toast";

export type UserStatusValue = "ACTIVE" | "SUSPENDED" | "INACTIVE";

const STATUS_OPTIONS: Array<{ value: UserStatusValue; label: string; hint: string }> = [
  { value: "ACTIVE", label: "Activo", hint: "Entra al CRM y recibe leads nuevos." },
  {
    value: "SUSPENDED",
    label: "Suspendido",
    hint: "Temporal: no entra ni recibe leads, conserva su cartera.",
  },
  {
    value: "INACTIVE",
    label: "Inactivo",
    hint: "Baja definitiva. Sigue visible en la tabla y se puede reactivar.",
  },
];

interface UserStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; name: string; status: string } | null;
  onConfirm: (id: string, status: UserStatusValue, reason?: string) => Promise<void>;
}

export function UserStatusDialog({
  open,
  onOpenChange,
  user,
  onConfirm,
}: UserStatusDialogProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<UserStatusValue>("SUSPENDED");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  function close() {
    setReason("");
    setStatus("SUSPENDED");
    setSaving(false);
    onOpenChange(false);
  }

  const needsReason = status === "SUSPENDED";
  const canSubmit = !saving && (!needsReason || reason.trim().length >= 3);

  async function submit() {
    if (!user) return;
    setSaving(true);
    try {
      await onConfirm(user.id, status, needsReason ? reason.trim() : undefined);
      close();
    } catch (error) {
      toast({
        title: "No se pudo cambiar el estado",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
      setSaving(false);
    }
  }

  const hint = STATUS_OPTIONS.find((o) => o.value === status)?.hint;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar estado</DialogTitle>
          <DialogDescription>{user?.name ?? ""}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Estado nuevo</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as UserStatusValue)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>

          {needsReason && (
            <div>
              <Label htmlFor="suspension-reason">Motivo</Label>
              <Input
                id="suspension-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. incapacidad médica hasta el 20 de agosto"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving ? "Guardando..." : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
