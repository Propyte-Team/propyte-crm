// Reasignación de la cartera de un usuario a otro. Los conteos vienen del
// servidor al abrir: sin ellos, quien administra no sabe qué está moviendo.
// Un scope en cero se muestra deshabilitado, no oculto — que esté vacío es
// información, no ruido.
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export const ASSET_SCOPE_LABELS: Record<string, string> = {
  contacts: "Contactos",
  deals: "Negocios",
  conversations: "Conversaciones del inbox",
  units: "Unidades reservadas",
  walkins: "Walk-ins asignados",
  quotes: "Cotizaciones",
};

interface ReassignAssetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; name: string; plaza: string } | null;
  /** Candidatos a destino: solo usuarios activos. */
  candidates: Array<{ id: string; name: string; plaza: string }>;
  loadCounts: (id: string) => Promise<Record<string, number>>;
  onConfirm: (
    fromId: string,
    toId: string,
    scopes: string[],
  ) => Promise<Record<string, number>>;
}

export function ReassignAssetsDialog({
  open,
  onOpenChange,
  user,
  candidates,
  loadCounts,
  onConfirm,
}: ReassignAssetsDialogProps) {
  const { toast } = useToast();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setCounts(null);
    loadCounts(user.id)
      .then((c) => {
        setCounts(c);
        // Precargar los scopes que tienen algo que mover.
        setSelected(Object.keys(c).filter((k) => c[k] > 0));
      })
      .catch((error: unknown) =>
        toast({
          title: "No se pudieron cargar los activos",
          description: error instanceof Error ? error.message : "Error inesperado",
          variant: "destructive",
        }),
      );
  }, [open, user, loadCounts, toast]);

  function close() {
    setCounts(null);
    setSelected([]);
    setTarget("");
    setSaving(false);
    onOpenChange(false);
  }

  function toggle(scope: string) {
    setSelected((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  const targetUser = candidates.find((c) => c.id === target);
  const crossPlaza = Boolean(targetUser && user && targetUser.plaza !== user.plaza);
  const totalToMove = selected.reduce((sum, s) => sum + (counts?.[s] ?? 0), 0);

  async function submit() {
    if (!user || !target) return;
    setSaving(true);
    try {
      const moved = await onConfirm(user.id, target, selected);
      const detail = Object.entries(moved)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${ASSET_SCOPE_LABELS[k] ?? k}`)
        .join(", ");
      toast({
        title: "Activos reasignados",
        description: detail || "No había nada que mover",
      });
      close();
    } catch (error) {
      toast({
        title: "No se pudo reasignar",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover activos</DialogTitle>
          <DialogDescription>
            {user ? `Desde ${user.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Destino</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Elige a quién pasan" />
              </SelectTrigger>
              <SelectContent>
                {candidates
                  .filter((c) => c.id !== user?.id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {crossPlaza && (
              <p className="mt-1 text-xs text-amber-600">
                El destino es de otra plaza ({targetUser?.plaza}). Se permite,
                pero verifica que sea intencional.
              </p>
            )}
          </div>

          <div>
            <Label>Qué se mueve</Label>
            {counts === null ? (
              <p className="text-sm text-muted-foreground">Contando...</p>
            ) : (
              <div className="mt-1 space-y-1">
                {Object.keys(ASSET_SCOPE_LABELS).map((scope) => {
                  const n = counts[scope] ?? 0;
                  return (
                    <label
                      key={scope}
                      className={`flex items-center gap-2 text-sm ${
                        n === 0 ? "text-muted-foreground" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(scope)}
                        disabled={n === 0}
                        onChange={() => toggle(scope)}
                      />
                      <span className="flex-1">{ASSET_SCOPE_LABELS[scope]}</span>
                      <span className="font-mono text-xs">{n}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {selected.includes("quotes") && (
              <p className="mt-2 text-xs text-amber-600">
                Mover cotizaciones reescribe su autoría. El movimiento queda
                registrado en la bitácora.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !target || selected.length === 0}
          >
            {saving ? "Moviendo..." : `Mover ${totalToMove} activos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
