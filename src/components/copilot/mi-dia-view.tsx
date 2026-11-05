// #988 — «Mi día»: las tareas de la cadencia de nuevos del asesor, en orden y con el tope de 40.
"use client";

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { MiDia } from "@/lib/copilot/mi-dia";
import { TOPE_TAREAS_DIA } from "@/lib/copilot/cadencia-nuevos";
import { TareaDelDia } from "./tarea-del-dia";

export function MiDiaView({ data, userId, sinMigrar = false }: { data: MiDia; userId: string; sinMigrar?: boolean }) {
  const router = useRouter();
  const refrescar = () => router.refresh();

  if (sinMigrar) {
    return (
      <div className="crm-card text-[13px] text-[color:var(--text-secondary)]">
        Copilot todavía no está instalado en la base: falta correr la migración de «Mi día» (#988).
      </div>
    );
  }

  const total = data.tareas.length + data.fueraDelTope;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Mi día</h1>
        <span className="text-[13px] text-[color:var(--text-secondary)]">
          {total} {total === 1 ? "tarea pendiente" : "tareas pendientes"}
          {data.vencidas > 0 && <span className="text-red-600"> · {data.vencidas} vencidas</span>}
          {data.hechasHoy.length > 0 && <> · {data.hechasHoy.length} terminadas hoy</>}
        </span>
      </div>
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        Cadencia de nuevos. Copilot no envía nada: abre el mensaje, revísalo, mándalo tú y marca lo que pasó. Si el lead
        responde, márcalo y pasa a Contactado.
      </p>

      {total === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No tienes toques pendientes. Los leads nuevos aparecen aquí al entrar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.tareas.map((t) => (
            <TareaDelDia key={t.clave} tarea={t} userId={userId} onCambio={refrescar} />
          ))}
          {data.fueraDelTope > 0 && (
            <p className="crm-card text-[13px] text-[color:var(--text-secondary)]">
              {data.fueraDelTope} {data.fueraDelTope === 1 ? "tarea más quedó" : "tareas más quedaron"} fuera del tope de{" "}
              {TOPE_TAREAS_DIA} del día. Aparecen aquí conforme termines las de arriba.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
