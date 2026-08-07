// Diálogo de cambio de contraseña. La contraseña se muestra UNA sola vez:
// nada la persiste en claro. Por eso este componente NO recarga la página al
// terminar — el reload fue exactamente el bug que se comió la API key recién
// generada en abril (618fa7f), y aquí el fallo sería irreversible.
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
import { Copy, KeyRound } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface PasswordResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; name: string; email: string } | null;
  /** Devuelve la contraseña en claro para mostrarla una vez. */
  onConfirm: (id: string, password?: string) => Promise<string>;
}

export function PasswordResetDialog({
  open,
  onOpenChange,
  user,
  onConfirm,
}: PasswordResetDialogProps) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setPassword("");
    setGenerated(null);
    setSaving(false);
    onOpenChange(false);
  }

  async function submit(useGenerated: boolean) {
    if (!user) return;
    setSaving(true);
    try {
      const result = await onConfirm(user.id, useGenerated ? undefined : password);
      setGenerated(result);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>
            {user ? `${user.name} — ${user.email}` : ""}
          </DialogDescription>
        </DialogHeader>

        {generated ? (
          <div className="space-y-3">
            <div className="rounded-md border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-900">
              Copia la contraseña ahora. No se vuelve a mostrar: solo se guarda
              su hash.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-sm">
                {generated}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(generated);
                  toast({ title: "Contraseña copiada" });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="new-password">Contraseña nueva</Label>
              <Input
                id="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => submit(true)}
              disabled={saving}
            >
              <KeyRound className="mr-2 h-3.5 w-3.5" />
              Generar una segura
            </Button>
          </div>
        )}

        <DialogFooter>
          {generated ? (
            <Button onClick={close}>Ya la copié</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancelar
              </Button>
              <Button
                onClick={() => submit(false)}
                disabled={saving || password.length < 8}
              >
                {saving ? "Guardando..." : "Cambiar contraseña"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
