// Diálogo de solo lectura con el historial de altas/bajas/eliminaciones de usuarios.
//
// Vive aparte de la tabla de usuarios (igual que ResetPasswordDialog) porque es una
// vista distinta de los mismos datos: no se edita nada aquí, solo se lee "quién hizo
// qué y cuándo". Los eventos ya vienen armados desde el servidor (getUserAuditHistory
// en @/server/admin) a partir de AuditLog — este componente solo los pinta.
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export interface UserHistoryEventData {
  id: string;
  kind: "activated" | "deactivated" | "deleted";
  targetName: string;
  targetEmail: string;
  actorName: string;
  createdAt: Date;
}

const KIND_CONFIG: Record<
  UserHistoryEventData["kind"],
  { label: string; className: string }
> = {
  activated: { label: "Activado", className: "bg-green-100 text-green-700" },
  deactivated: { label: "Desactivado", className: "bg-gray-100 text-gray-700" },
  deleted: { label: "Eliminado", className: "bg-red-100 text-red-700" },
};

function formatFechaHora(fecha: Date) {
  return new Date(fecha).toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface UserHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: UserHistoryEventData[];
}

export function UserHistoryDialog({ open, onOpenChange, events }: UserHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historial de usuarios</DialogTitle>
          <DialogDescription>
            Activaciones, desactivaciones y eliminaciones, con fecha, hora y quién lo hizo.
          </DialogDescription>
        </DialogHeader>

        {events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Todavía no hay eventos registrados.
          </p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => {
              const config = KIND_CONFIG[event.kind];
              return (
                <div
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{event.targetName}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${config.className}`}
                      >
                        {config.label}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {event.targetEmail} · por {event.actorName}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 whitespace-nowrap font-normal">
                    {formatFechaHora(event.createdAt)}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
