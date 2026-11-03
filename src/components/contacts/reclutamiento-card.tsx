// Bot de reclutamiento (plan 2026-11-03, Task 8) — tarjeta «Reclutamiento» en la ficha del
// contacto: espejo de solo lectura de su candidato. La página solo la carga para quien puede ver
// Reclutamiento (`puedeVerReclutamiento`); para los demás llega null y no se pinta.
import Link from "next/link";
import { ExternalLink, FileText, Link2, MessageSquare } from "lucide-react";
import type { CandidatoDeContacto } from "@/server/reclutamiento";
import { etapa, hrefSitio } from "@/lib/reclutamiento/shared";
import { estadoBot, hrefConversacion } from "@/lib/reclutamiento/presentacion";

const enlace = "inline-flex items-center gap-1 text-[13px] hover:underline";
const teal = { color: "var(--color-teal)" };

export function ReclutamientoCard({ candidato: c }: { candidato: CandidatoDeContacto | null | undefined }) {
  if (!c) return null;
  const e = etapa(c.stage);
  const bot = estadoBot(c);
  const enlaceCv = hrefSitio(c.cvUrl);
  const conversacion = c.source === "CHAT" ? hrefConversacion({ conversationId: c.sourceRef }) : null;

  return (
    <div className="crm-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">Reclutamiento</h2>
        <Link href="/reclutamiento" className={enlace} style={teal}>
          <ExternalLink className="h-3.5 w-3.5" /> Abrir en Reclutamiento
        </Link>
      </div>

      <div className="space-y-2.5 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-md px-2 py-0.5 text-xs font-medium text-white"
            style={{ background: e?.color ?? "#6B7280" }}
          >
            {e?.label ?? c.stage}
          </span>
          {bot?.tipo === "veredicto" && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className={`badge ${bot.clase}`}>{bot.label}</span>
              {bot.puntaje && <span className="num text-xs text-muted-foreground">{bot.puntaje}</span>}
            </span>
          )}
          {bot?.tipo === "en_guion" && (
            <span className="badge badge-info" title="El bot aún no termina el guion">En guion</span>
          )}
        </div>

        {c.botResumen && (
          <p className="line-clamp-3 whitespace-pre-line text-[color:var(--text-primary)]" title={c.botResumen}>
            {c.botResumen}
          </p>
        )}

        {c.horarioEntrevista && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[color:var(--text-tertiary)]">Horario para entrevista</span>
            <span className="text-right font-medium text-[color:var(--text-primary)]">{c.horarioEntrevista}</span>
          </div>
        )}

        {(c.cvFileId || enlaceCv || conversacion) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {c.cvFileId && (
              <a
                href={`/api/reclutamiento/${c.id}/files/${c.cvFileId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={enlace}
                style={teal}
              >
                <FileText className="h-3.5 w-3.5" /> Ver CV
              </a>
            )}
            {enlaceCv && (
              <a href={enlaceCv} target="_blank" rel="noopener noreferrer" className={enlace} style={teal} title={c.cvUrl ?? undefined}>
                <Link2 className="h-3.5 w-3.5" /> Ver enlace
              </a>
            )}
            {conversacion && (
              <Link href={conversacion} className={enlace} style={teal}>
                <MessageSquare className="h-3.5 w-3.5" /> Abrir conversación
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
