// Diálogo para restablecer la contraseña de otro usuario.
//
// Vive aparte del formulario de editar usuario a propósito: mezclar el cambio
// de credenciales con la edición de datos hace fácil cambiar una contraseña sin
// querer mientras se corrige un teléfono.
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

/** Pareado con resetPasswordSchema del servidor. El servidor es quien manda. */
const MIN_LENGTH = 8;

interface TargetUser {
  id: string;
  name: string;
  email: string;
}

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: TargetUser | null;
  onSubmit: (userId: string, password: string) => Promise<void>;
  isPending: boolean;
}

export function ResetPasswordDialog({
  open,
  onOpenChange,
  user,
  onSubmit,
  isPending,
}: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  // Limpiar al abrir o al cambiar de usuario: dejar una contraseña tecleada en
  // el estado y reabrir el diálogo sobre OTRA persona es cómo se le cambia la
  // clave a quien no era.
  useEffect(() => {
    setPassword("");
    setConfirm("");
    setError("");
  }, [user, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    if (password.length < MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`);
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setError("");
    await onSubmit(user.id, password);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restablecer contraseña</DialogTitle>
          <DialogDescription>
            {user
              ? `Se asignará una contraseña nueva a ${user.name} (${user.email}).`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Nueva contraseña</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`Mínimo ${MIN_LENGTH} caracteres`}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar contraseña</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repite la contraseña"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <p className="text-xs text-muted-foreground">
            La persona seguirá con su sesión abierta si ya había entrado: el cambio
            aplica a partir del próximo inicio de sesión.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Procesando..." : "Restablecer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
