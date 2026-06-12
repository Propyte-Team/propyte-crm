// Riel operativo del deal (Fase 2, T2.2): next-best-action + checklist por etapa
// + contexto de la unidad del Hub (snapshot congelado). Lógica de reglas, sin IA.
"use client";

import { CheckCircle2, Circle, ArrowRight, Building2 } from "lucide-react";

interface Props {
  deal: any;
}

// Siguiente mejor acción según la etapa (regla simple, accionable).
const NEXT_BEST_ACTION: Record<string, string> = {
  NEW_LEAD: "Haz el primer contacto en menos de 5 minutos (WhatsApp o llamada).",
  CONTACTED: "Agenda una llamada de descubrimiento para calificar necesidad y presupuesto.",
  DISCOVERY_DONE: "Agenda la visita/recorrido al desarrollo.",
  MEETING_SCHEDULED: "Confirma la visita 24h antes y prepara unidades que encajen.",
  MEETING_COMPLETED: "Envía una cotización con la unidad que más le interesó.",
  PROPOSAL_SENT: "Da seguimiento a la propuesta y resuelve objeciones.",
  NEGOTIATION: "Cierra condiciones y prepara el apartado de la unidad.",
  RESERVED: "Reúne KYC y documentos para avanzar a firma.",
  CONTRACT_SIGNED: "Coordina el proceso de cierre/escrituración.",
  CLOSING: "Verifica pagos y agenda la entrega.",
  WON: "Inicia postventa: bienvenida, encuesta y referidos.",
  LOST: "Registra el motivo y programa reactivación futura si aplica.",
  FROZEN: "Define fecha y condición de reactivación.",
};

// Checklist mínimo por etapa (lo que debe estar listo para avanzar con calidad).
function checklist(deal: any): { label: string; done: boolean }[] {
  const hasUnit = !!(deal.hubUnitId || deal.unitId);
  const hasHold = !!deal.holdId;
  const hasQuote = (deal.quotes?.length ?? 0) > 0;
  const hasDocs = (deal.documents?.length ?? 0) > 0;
  const c = deal.contact ?? {};
  const hasProfile = !!(c.investmentProfile && c.budgetMax && c.propertyType);

  switch (deal.stage) {
    case "NEW_LEAD":
    case "CONTACTED":
      return [
        { label: "Contacto con teléfono válido", done: !!c.phone },
        { label: "Perfil de inversión capturado", done: hasProfile },
      ];
    case "DISCOVERY_DONE":
    case "MEETING_SCHEDULED":
    case "MEETING_COMPLETED":
      return [
        { label: "Perfil de inversión capturado", done: hasProfile },
        { label: "Unidad de interés asignada (Hub)", done: hasUnit },
      ];
    case "PROPOSAL_SENT":
    case "NEGOTIATION":
      return [
        { label: "Unidad asignada (Hub)", done: hasUnit },
        { label: "Cotización enviada", done: hasQuote },
      ];
    case "RESERVED":
      return [
        { label: "Unidad asignada (Hub)", done: hasUnit },
        { label: "Hold confirmado en el Hub", done: hasHold },
        { label: "Cotización emitida", done: hasQuote },
      ];
    case "CONTRACT_SIGNED":
    case "CLOSING":
      return [
        { label: "Hold/reserva en el Hub", done: hasHold },
        { label: "Documentos KYC / contrato", done: hasDocs },
      ];
    case "WON":
      return [
        { label: "Documentos de cierre", done: hasDocs },
        { label: "Venta confirmada en el Hub", done: hasHold },
      ];
    default:
      return [];
  }
}

export function DealOperationalRail({ deal }: Props) {
  const nba = NEXT_BEST_ACTION[deal.stage];
  const items = checklist(deal);
  const snap = (deal.custom && typeof deal.custom === "object" ? (deal.custom as any).hubUnitSnapshot : null) as
    | Record<string, any>
    | null;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Next-best-action */}
      <div className="crm-card !p-4 md:col-span-1" style={{ borderColor: "var(--border-strong, #d4d4d4)" }}>
        <div className="flex items-center gap-2">
          <ArrowRight className="h-4 w-4" style={{ color: "var(--color-teal, #0D9488)" }} />
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
            Siguiente acción
          </span>
        </div>
        <p className="mt-2 text-[14px] leading-snug text-[color:var(--text-primary)]">
          {nba ?? "Avanza el deal según corresponda."}
        </p>
      </div>

      {/* Checklist por etapa */}
      <div className="crm-card !p-4 md:col-span-1">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
          Checklist de la etapa
        </span>
        <ul className="mt-2 space-y-1.5">
          {items.length > 0 ? (
            items.map((it, i) => (
              <li key={i} className="flex items-center gap-2 text-[13px]">
                {it.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "#16A34A" }} />
                ) : (
                  <Circle className="h-4 w-4 shrink-0" style={{ color: "var(--text-tertiary)" }} />
                )}
                <span style={{ color: it.done ? "var(--text-tertiary)" : "var(--text-primary)" }}>{it.label}</span>
              </li>
            ))
          ) : (
            <li className="text-[13px] text-[color:var(--text-tertiary)]">Sin requisitos para esta etapa.</li>
          )}
        </ul>
      </div>

      {/* Contexto de unidad del Hub (snapshot congelado) */}
      <div className="crm-card !p-4 md:col-span-1">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--text-tertiary)]">
            Unidad (Hub)
          </span>
        </div>
        {snap ? (
          <div className="mt-2 space-y-1 text-[13px]">
            <p className="text-[color:var(--text-primary)]">{snap.titulo ?? snap.numero ?? "Unidad"}</p>
            <p className="text-[color:var(--text-tertiary)]">
              {[snap.tipo, snap.recamaras ? `${snap.recamaras} rec` : null, snap.m2Construccion ? `${snap.m2Construccion} m²` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {snap.precioMxn && (
              <p className="num text-[color:var(--text-primary)]">
                ${Number(snap.precioMxn).toLocaleString("es-MX")} {snap.moneda ?? "MXN"}
              </p>
            )}
            <p className="text-[11px] text-[color:var(--text-tertiary)]">
              Snapshot del Hub {snap.snapshotAt ? `· ${new Date(snap.snapshotAt).toLocaleDateString("es-MX")}` : ""}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-[color:var(--text-tertiary)]">
            Sin unidad del Hub asignada. Selecciona una al editar el deal.
          </p>
        )}
      </div>
    </div>
  );
}
