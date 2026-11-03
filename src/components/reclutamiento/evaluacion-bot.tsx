// Bot de reclutamiento (plan 2026-11-03, Task 7) — «Evaluación del bot» en el diálogo del
// candidato. Solo lectura: lo que el bot capturó y cómo lo calificó. Sin estado ni efectos (se
// prueba con render estático).
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import type { CandidatoFila } from "@/lib/reclutamiento/shared";
import {
  estadoBot,
  hrefConversacion,
  motivoLegible,
  origenLabel,
  respuestasLegibles,
} from "@/lib/reclutamiento/presentacion";

/** Badge del veredicto + puntaje («Apto · 72/100»), o «En guion» si sigue en la charla. */
export function BadgeBot({ f }: { f: CandidatoFila }) {
  const e = estadoBot(f);
  if (!e) return null;
  if (e.tipo === "en_guion") {
    return <span className="badge badge-info" title="El bot aún no termina el guion">En guion</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`badge ${e.clase}`}>{e.label}</span>
      {e.puntaje && <span className="num text-xs text-muted-foreground">{e.puntaje}</span>}
    </span>
  );
}

/** null si el candidato no tiene nada del bot (alta manual sin evaluación). */
export function EvaluacionBot({ f }: { f: CandidatoFila }) {
  const estado = estadoBot(f);
  const respuestas = respuestasLegibles(f.botRespuestas);
  const conversacion = f.source === "CHAT" ? hrefConversacion(f) : null;
  if (!estado && respuestas.length === 0 && !f.horarioEntrevista && !conversacion) return null;
  const motivo = motivoLegible(f.botMotivo);

  return (
    <section
      aria-label="Evaluación del bot"
      className="space-y-3 rounded-md border p-3 text-sm"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Evaluación del bot</h3>
        <span className="text-xs text-muted-foreground">Origen: {origenLabel(f)}</span>
      </div>

      {estado && (
        <div className="flex flex-wrap items-center gap-2">
          <BadgeBot f={f} />
          {motivo && <span className="text-muted-foreground">{motivo}</span>}
        </div>
      )}

      {f.botResumen && <p className="whitespace-pre-line">{f.botResumen}</p>}

      {f.horarioEntrevista && (
        <p>
          <span className="text-muted-foreground">Horario para entrevista: </span>
          {f.horarioEntrevista}
        </p>
      )}

      {respuestas.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {respuestas.map((r) => (
            <div key={r.clave} className="contents">
              <dt className="text-muted-foreground">{r.etiqueta}</dt>
              <dd className="break-words">{r.valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {conversacion && (
        <Link href={conversacion} className="btn-secondary inline-flex w-fit items-center gap-1 text-[12px]">
          <MessageSquare className="h-3.5 w-3.5" /> Abrir conversación
        </Link>
      )}
    </section>
  );
}
