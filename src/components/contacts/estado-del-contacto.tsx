// #953: estado del contacto del flujograma v0.2 — chip de estado, chip de subestado, razón de salida y
// ticket estimado. Lo usan la ficha (completo) y la lista (solo el chip de estado).
//
// El chip ofrece solo los cambios que permite el flujograma desde el estado actual (y que aplican al
// flujo del contacto). Si el cambio pide algo más —la razón de una salida, el ticket desde Demo— abre
// un formulario. La API vuelve a validar todo (lib/estados.ts): la pantalla no es la frontera.
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ESTADO_COLORS,
  ESTADO_LABELS,
  ESTADO_VACIO_COLOR,
  ESTADOS_CON_TICKET,
  RAZON_SALIDA_AYUDA,
  RAZON_SALIDA_LABELS,
  RAZONES_CON_DETALLE,
  RAZONES_CON_FECHA,
  esEstado,
  esSalida,
  etiquetaEstado,
  etiquetaRazon,
  opcionesDeEstado,
  pideFormulario,
  razonesDe,
  subestadosDe,
  tituloRazon,
  type RazonSalida,
} from "@/lib/estados";

export interface ContactoConEstado {
  id: string;
  estado: string | null;
  subestado?: string | null;
  flujo?: string | null;
  ticketEstimado?: number | string | null;
  ticketMoneda?: string | null;
  razonSalida?: string | null;
  razonSalidaDetalle?: string | null;
  fechaRecontacto?: string | null;
}

interface Props {
  contacto: ContactoConEstado;
  readOnly?: boolean;
  /** Puede usar las correcciones fuera del flujograma (solo administradores). */
  puedeCorregir?: boolean;
  /** Solo el chip de estado (lista de contactos). */
  compacto?: boolean;
  /** Después de guardar: la ficha relee, la lista actualiza su fila. */
  onGuardado?: (cambios: Record<string, unknown>) => void;
  /** Ocultar el ticket (el rol no lo ve). */
  sinTicket?: boolean;
}

type Formulario =
  | { modo: "estado"; destino: string; forzar: boolean }
  | { modo: "razon" }
  | { modo: "ticket" };

function formatoTicket(v: unknown, moneda?: string | null): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v));
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda || "MXN", maximumFractionDigits: 0 }).format(n);
}

async function guardar(id: string, cuerpo: Record<string, unknown>): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/contacts?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? "No se pudo guardar" };
    return { ok: true, data: json?.data };
  } catch {
    return { ok: false, error: "No se pudo guardar (sin conexión)" };
  }
}

export function EstadoDelContacto({ contacto, readOnly, puedeCorregir = false, compacto = false, onGuardado, sinTicket = false }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<Formulario | null>(null);

  const estado = contacto.estado ?? null;
  const { normales, correcciones } = opcionesDeEstado(estado, contacto.flujo ?? null, puedeCorregir);
  const subestados = subestadosDe(estado, contacto.flujo ?? null);
  const color = estado && esEstado(estado) ? ESTADO_COLORS[estado] : ESTADO_VACIO_COLOR;

  async function aplicar(cuerpo: Record<string, unknown>): Promise<boolean> {
    setOcupado(true);
    setError(null);
    const r = await guardar(contacto.id, cuerpo);
    setOcupado(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    onGuardado?.(r.data ?? cuerpo);
    return true;
  }

  function elegirEstado(valor: string) {
    const forzar = valor.startsWith("forzar:");
    const destino = forzar ? valor.slice("forzar:".length) : valor;
    if (destino === (estado ?? "")) return;
    if (pideFormulario(destino, contacto)) {
      setError(null);
      setFormulario({ modo: "estado", destino, forzar });
      return;
    }
    void aplicar({ estado: destino || null, ...(forzar ? { forzarCambio: true } : {}) });
  }

  const ticket = formatoTicket(contacto.ticketEstimado, contacto.ticketMoneda);

  return (
    <>
      <Chip
        color={color}
        etiqueta={etiquetaEstado(estado)}
        ocupado={ocupado}
        readOnly={readOnly}
        titulo={estado ? undefined : "Este contacto todavía no tiene estado: elígelo"}
      >
        <select
          className="absolute inset-0 cursor-pointer opacity-0"
          value={estado ?? ""}
          onChange={(e) => elegirEstado(e.target.value)}
          aria-label="Cambiar estado"
        >
          {normales.map((o) => (
            <option key={`n-${o.valor}`} value={o.valor}>{o.etiqueta}</option>
          ))}
          {correcciones.length > 0 && (
            <optgroup label="Corregir (administrador)">
              {correcciones.map((o) => (
                <option key={`f-${o.valor}`} value={`forzar:${o.valor}`}>{o.etiqueta}</option>
              ))}
            </optgroup>
          )}
        </select>
      </Chip>

      {!compacto && subestados.length > 0 && (
        <Chip etiqueta={subestados.find((s) => s.valor === contacto.subestado)?.etiqueta ?? "Subestado —"} ocupado={ocupado} readOnly={readOnly}>
          <select
            className="absolute inset-0 cursor-pointer opacity-0"
            value={contacto.subestado ?? ""}
            onChange={(e) => e.target.value && void aplicar({ subestado: e.target.value })}
            aria-label="Cambiar subestado"
          >
            {!contacto.subestado && <option value="">Subestado —</option>}
            {subestados.map((s) => (
              <option key={s.valor} value={s.valor}>{s.etiqueta}</option>
            ))}
          </select>
        </Chip>
      )}

      {!compacto && esSalida(estado) && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
          style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}
          disabled={readOnly}
          onClick={() => {
            setError(null);
            setFormulario({ modo: "razon" });
          }}
          title={contacto.razonSalidaDetalle ?? undefined}
        >
          {tituloRazon(estado)}: {etiquetaRazon(contacto.razonSalida) ?? "elegir"}
        </button>
      )}

      {/* El ticket se ve cuando ya hay uno, o desde Reunión (Demo lo pide para avanzar). */}
      {!compacto && !sinTicket && (ticket || estado === "REUNION" || (estado && esEstado(estado) && ESTADOS_CON_TICKET.includes(estado))) && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
          style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}
          disabled={readOnly}
          onClick={() => {
            setError(null);
            setFormulario({ modo: "ticket" });
          }}
        >
          Ticket {ticket ?? "—"}
        </button>
      )}

      {error && !formulario && (
        <span role="alert" className="text-xs text-[color:var(--color-danger,#DC2626)]">{error}</span>
      )}

      {formulario && (
        <FormularioDeEstado
          contacto={contacto}
          formulario={formulario}
          ocupado={ocupado}
          error={error}
          onCerrar={() => {
            setFormulario(null);
            setError(null);
          }}
          onGuardar={async (cuerpo) => {
            if (await aplicar(cuerpo)) setFormulario(null);
          }}
        />
      )}
    </>
  );
}

function Chip({
  color,
  etiqueta,
  ocupado,
  readOnly,
  titulo,
  children,
}: {
  color?: string;
  etiqueta: string;
  ocupado?: boolean;
  readOnly?: boolean;
  titulo?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-card)", opacity: ocupado ? 0.5 : 1 }}
      title={titulo}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {etiqueta}
      {!readOnly && (
        <>
          <svg className="h-3 w-3 text-[color:var(--text-tertiary)]" viewBox="0 0 12 12" fill="none"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.2" /></svg>
          {children}
        </>
      )}
    </span>
  );
}

function FormularioDeEstado({
  contacto,
  formulario,
  ocupado,
  error,
  onCerrar,
  onGuardar,
}: {
  contacto: ContactoConEstado;
  formulario: Formulario;
  ocupado: boolean;
  error: string | null;
  onCerrar: () => void;
  onGuardar: (cuerpo: Record<string, unknown>) => void;
}) {
  const destino = formulario.modo === "estado" ? formulario.destino : contacto.estado;
  const pideRazon = formulario.modo !== "ticket" && esSalida(destino);
  const pideTicket =
    formulario.modo === "ticket" || (formulario.modo === "estado" && !!destino && esEstado(destino) && ESTADOS_CON_TICKET.includes(destino));
  const razones = razonesDe(destino);

  const [razon, setRazon] = useState<string>(formulario.modo === "razon" ? contacto.razonSalida ?? "" : "");
  const [detalle, setDetalle] = useState<string>(formulario.modo === "razon" ? contacto.razonSalidaDetalle ?? "" : "");
  const [fecha, setFecha] = useState<string>(
    formulario.modo === "razon" && contacto.fechaRecontacto ? String(contacto.fechaRecontacto).slice(0, 10) : "",
  );
  const [ticket, setTicket] = useState<string>(
    contacto.ticketEstimado !== null && contacto.ticketEstimado !== undefined ? String(contacto.ticketEstimado) : "",
  );
  const [moneda, setMoneda] = useState<string>(contacto.ticketMoneda || "MXN");

  const titulo =
    formulario.modo === "ticket"
      ? "Ticket estimado"
      : formulario.modo === "razon"
        ? tituloRazon(destino)
        : `Pasar a ${destino && esEstado(destino) ? ESTADO_LABELS[destino] : etiquetaEstado(null)}`;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const cuerpo: Record<string, unknown> = {};
    if (formulario.modo === "estado") {
      cuerpo.estado = formulario.destino || null;
      if (formulario.forzar) cuerpo.forzarCambio = true;
    }
    if (pideRazon) {
      cuerpo.razonSalida = razon || null;
      cuerpo.razonSalidaDetalle = detalle.trim() || null;
      cuerpo.fechaRecontacto = RAZONES_CON_FECHA.includes(razon as RazonSalida) ? fecha || null : null;
    }
    if (pideTicket) {
      const n = Number(ticket.replace(/[,\s$]/g, ""));
      cuerpo.ticketEstimado = ticket.trim() === "" ? null : Number.isFinite(n) ? n : null;
      cuerpo.ticketMoneda = moneda;
    }
    onGuardar(cuerpo);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {formulario.modo === "estado" && formulario.forzar && (
            <DialogDescription>Corrección fuera del flujograma: queda marcada en la cronología.</DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3">
          {pideRazon && (
            <>
              <label className="block">
                <span className="form-label">{tituloRazon(destino)}</span>
                <select className="form-input w-full" value={razon} onChange={(e) => setRazon(e.target.value)} required>
                  <option value="">Elige una razón</option>
                  {razones.map((r) => (
                    <option key={r} value={r}>{RAZON_SALIDA_LABELS[r]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="form-label">
                  Detalle{RAZONES_CON_DETALLE.includes(razon as RazonSalida) ? " (obligatorio)" : ""}
                </span>
                <textarea
                  className="form-input w-full"
                  rows={2}
                  maxLength={500}
                  value={detalle}
                  placeholder={RAZON_SALIDA_AYUDA[razon as RazonSalida] ?? ""}
                  onChange={(e) => setDetalle(e.target.value)}
                  required={RAZONES_CON_DETALLE.includes(razon as RazonSalida)}
                />
              </label>
              {RAZONES_CON_FECHA.includes(razon as RazonSalida) && (
                <label className="block">
                  <span className="form-label">Fecha de recontacto</span>
                  <input type="date" className="form-input w-full" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
                </label>
              )}
            </>
          )}
          {pideTicket && (
            <div className="flex items-end gap-2">
              <label className="block flex-1">
                <span className="form-label">Ticket estimado{formulario.modo === "estado" ? " (obligatorio desde Demo)" : ""}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="form-input w-full"
                  value={ticket}
                  placeholder="Ej. 3,500,000"
                  onChange={(e) => setTicket(e.target.value)}
                  required={formulario.modo === "estado"}
                />
              </label>
              <select className="form-input" value={moneda} onChange={(e) => setMoneda(e.target.value)} aria-label="Moneda">
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-[color:var(--color-danger,#DC2626)]">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary text-[13px]" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn-primary text-[13px]" disabled={ocupado}>Guardar</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
