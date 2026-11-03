// #957: sección «Operaciones» de la ficha del contacto (lo que antes era la tabla de Deals).
//
// Cada compra (o contrato o convenio) es una operación con su etapa —En preparación, Apartado, Firma,
// Escritura, Postventa o Cancelada— y su subestado. Desde aquí se aparta, se firma, se marcan las
// casillas de la firma, se reaparta y se cancela. El estado del contacto lo pone la base a partir de
// su operación activa más avanzada. La API vuelve a validar todo (lib/operaciones.ts).
//
// «Negocios anteriores»: los de antes del #957 sin etapa (la #958 los mueve). Se pueden volver una
// operación en preparación para cotizar o apartar.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ACCION_DE_ETAPA,
  ETAPA_OPERACION_COLORS,
  ETAPA_OPERACION_LABELS,
  FORMA_PAGO_LABELS,
  FORMA_PAGO_ORDER,
  NEGOCIO_ANTERIOR_LABEL,
  TIPO_OPERACION_LABELS,
  esEtapaOperacion,
  esTipoOperacion,
  muestraCasillas,
  separarOperaciones,
  siguientesEtapas,
  subestadosDeEtapa,
  type EtapaOperacion,
} from "@/lib/operaciones";

export interface OperacionDelContacto {
  id: string;
  etapa?: string | null;
  tipoOperacion?: string | null;
  subestado?: string | null;
  stage?: string | null;
  flujo?: string | null;
  reapartados?: number | null;
  contratoFirmado?: boolean | null;
  enganchePagado?: boolean | null;
  formaPago?: string | null;
  propiedadDescripcion?: string | null;
  hubUnitId?: string | null;
  unitId?: string | null;
  estimatedValue?: number | string | null;
  currency?: string | null;
  createdAt?: string | Date | null;
  reservedAt?: string | Date | null;
  development?: { name?: string | null } | null;
  unit?: { unitNumber?: string | null } | null;
  assignedTo?: { name?: string | null } | null;
  /** custom.hubUnitSnapshot: copia de la unidad del Hub al crearla o apartarla (lib/hub/types.ts). */
  custom?: { hubUnitSnapshot?: { numero?: string | null; titulo?: string | null } | null } | null;
}

interface Props {
  operaciones: readonly OperacionDelContacto[];
  /** Etiquetas de la etapa vieja, para los negocios anteriores. */
  etiquetaEtapaVieja: (stage: string | null | undefined) => string;
  readOnly?: boolean;
  onGuardado?: () => void;
  onNueva?: () => void;
}

async function patch(id: string, cuerpo: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/deals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json?.error ?? "No se pudo guardar";
  } catch {
    return "No se pudo guardar (sin conexión)";
  }
}

function dinero(v: unknown, moneda?: string | null): string {
  const n = Number(String(v ?? ""));
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda || "MXN", maximumFractionDigits: 0 }).format(n);
}

function queSeVende(op: OperacionDelContacto): string {
  const desarrollo = op.development?.name ?? null;
  const snap = op.custom?.hubUnitSnapshot;
  const unidad = op.unit?.unitNumber ?? snap?.numero ?? snap?.titulo ?? null;
  if (desarrollo || unidad) return [desarrollo, unidad].filter(Boolean).join(" · ");
  return op.propiedadDescripcion || "Sin propiedad";
}

const chip = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs";
const chipStyle = { borderColor: "var(--border-default)", background: "var(--bg-card)" } as const;

export function OperacionesDelContacto({ operaciones: todas, etiquetaEtapaVieja, readOnly, onGuardado, onNueva }: Props) {
  const { operaciones, anteriores } = separarOperaciones(todas);
  const [apartando, setApartando] = useState<OperacionDelContacto | null>(null);

  return (
    <div className="space-y-3">
      {operaciones.length === 0 && anteriores.length === 0 && (
        <p className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
          Sin operaciones. Crea una para cotizarle y, cuando aparte, se vuelve la venta.
        </p>
      )}

      {operaciones.map((op) => (
        <TarjetaOperacion key={op.id} op={op} readOnly={readOnly} onGuardado={onGuardado} onApartar={() => setApartando(op)} />
      ))}

      {anteriores.length > 0 && (
        <div className="pt-2">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-[color:var(--text-tertiary)]">
            Negocios anteriores ({anteriores.length})
          </p>
          <ul className="space-y-2">
            {anteriores.map((op) => (
              <NegocioAnterior key={op.id} op={op} etiquetaEtapaVieja={etiquetaEtapaVieja} readOnly={readOnly} onGuardado={onGuardado} />
            ))}
          </ul>
        </div>
      )}

      {!readOnly && onNueva && operaciones.length + anteriores.length > 0 && (
        <p className="text-[12px] text-[color:var(--text-tertiary)]">
          ¿Otra compra? Crea una operación nueva: cada compra lleva la suya.
        </p>
      )}

      <DialogoApartar op={apartando} onCerrar={() => setApartando(null)} onGuardado={onGuardado} />
    </div>
  );
}

function TarjetaOperacion({
  op,
  readOnly,
  onGuardado,
  onApartar,
}: {
  op: OperacionDelContacto;
  readOnly?: boolean;
  onGuardado?: () => void;
  onApartar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmaCancelar, setConfirmaCancelar] = useState(false);

  const etapa: EtapaOperacion = esEtapaOperacion(op.etapa) ? op.etapa : "EN_PREPARACION";
  const tipo = esTipoOperacion(op.tipoOperacion) ? op.tipoOperacion : "VENTA";
  const subestados = subestadosDeEtapa(etapa, { flujo: op.flujo, tipo });
  const siguientes = siguientesEtapas(tipo, etapa).filter((e) => e !== "CANCELADA");
  const puedeCancelar = siguientesEtapas(tipo, etapa).includes("CANCELADA");
  const tieneUnidad = !!(op.hubUnitId || op.unitId);

  async function aplicar(cuerpo: Record<string, unknown>) {
    setOcupado(true);
    setError(null);
    const e = await patch(op.id, cuerpo);
    setOcupado(false);
    if (e) {
      setError(e);
      return;
    }
    setConfirmaCancelar(false);
    onGuardado?.();
  }

  function avanzar(destino: EtapaOperacion) {
    // Apartar una venta pide la unidad del Hub (se aparta en el inventario).
    if (destino === "APARTADO" && !tieneUnidad) {
      onApartar();
      return;
    }
    void aplicar({ etapa: destino });
  }

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--border-subtle)", opacity: ocupado ? 0.6 : 1 }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={chip} style={chipStyle}>
          <span className="h-2 w-2 rounded-full" style={{ background: ETAPA_OPERACION_COLORS[etapa] }} />
          {ETAPA_OPERACION_LABELS[etapa]}
        </span>
        {subestados.length > 0 && (
          <label className={`${chip} relative`} style={chipStyle}>
            {subestados.find((s) => s.valor === op.subestado)?.etiqueta ?? "Subestado —"}
            {!readOnly && (
              <select
                className="absolute inset-0 cursor-pointer opacity-0"
                value={op.subestado ?? ""}
                disabled={ocupado}
                onChange={(e) => e.target.value && void aplicar({ subestado: e.target.value })}
                aria-label="Cambiar subestado de la operación"
              >
                {!op.subestado && <option value="">Subestado —</option>}
                {subestados.map((s) => (
                  <option key={s.valor} value={s.valor}>{s.etiqueta}</option>
                ))}
              </select>
            )}
          </label>
        )}
        <span className="text-[13px] font-medium">{TIPO_OPERACION_LABELS[tipo]}</span>
        <span className="text-[13px] text-[color:var(--text-secondary)]">{queSeVende(op)}</span>
        <span className="num text-[13px]">{dinero(op.estimatedValue, op.currency)}</span>
        {op.assignedTo?.name && <span className="text-[12px] text-[color:var(--text-tertiary)]">{op.assignedTo.name}</span>}
        {(op.reapartados ?? 0) > 0 && (
          <span className="text-[12px] text-[color:var(--text-tertiary)]">Reapartada {op.reapartados} {op.reapartados === 1 ? "vez" : "veces"}</span>
        )}
        <Link href={`/pipeline/${op.id}`} className="ml-auto text-[12px] text-[color:var(--color-teal,#0D9488)] hover:underline">
          Ver detalle
        </Link>
      </div>

      {(muestraCasillas(tipo, etapa) || (tipo === "VENTA" && etapa !== "CANCELADA")) && (
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[13px]">
          {muestraCasillas(tipo, etapa) && (
            <>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!op.contratoFirmado}
                  disabled={readOnly || ocupado}
                  onChange={(e) => void aplicar({ contratoFirmado: e.target.checked })}
                />
                Contrato firmado
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!op.enganchePagado}
                  disabled={readOnly || ocupado}
                  onChange={(e) => void aplicar({ enganchePagado: e.target.checked })}
                />
                Enganche pagado
              </label>
            </>
          )}
          {tipo === "VENTA" && etapa !== "CANCELADA" && (
            <label className="inline-flex items-center gap-1.5">
              Forma de pago
              <select
                className="form-input py-0.5 text-[13px]"
                value={op.formaPago ?? ""}
                disabled={readOnly || ocupado}
                onChange={(e) => void aplicar({ formaPago: e.target.value || null })}
              >
                <option value="">—</option>
                {FORMA_PAGO_ORDER.map((f) => (
                  <option key={f} value={f}>{FORMA_PAGO_LABELS[f]}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {!readOnly && (siguientes.length > 0 || puedeCancelar || etapa === "APARTADO") && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {siguientes.map((e) => (
            <button key={e} type="button" className="btn-secondary text-[12px]" disabled={ocupado} onClick={() => avanzar(e)}>
              {ACCION_DE_ETAPA[e]}
            </button>
          ))}
          {etapa === "APARTADO" && (
            <button
              type="button"
              className="btn-secondary text-[12px]"
              disabled={ocupado}
              title="Renueva el apartado (y su reloj) cuando se vence sin firmar"
              onClick={() => void aplicar({ reapartar: true })}
            >
              Reapartar
            </button>
          )}
          {puedeCancelar &&
            (confirmaCancelar ? (
              <span className="inline-flex items-center gap-2 text-[12px]">
                ¿Cancelar esta operación?
                <button type="button" className="btn-danger text-[12px]" disabled={ocupado} onClick={() => void aplicar({ etapa: "CANCELADA" })}>
                  Sí, cancelar
                </button>
                <button type="button" className="btn-secondary text-[12px]" onClick={() => setConfirmaCancelar(false)}>
                  No
                </button>
              </span>
            ) : (
              <button type="button" className="btn-secondary text-[12px]" disabled={ocupado} onClick={() => setConfirmaCancelar(true)}>
                Cancelar operación
              </button>
            ))}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-[color:var(--color-danger,#DC2626)]">{error}</p>
      )}
    </div>
  );
}

function NegocioAnterior({
  op,
  etiquetaEtapaVieja,
  readOnly,
  onGuardado,
}: {
  op: OperacionDelContacto;
  etiquetaEtapaVieja: (stage: string | null | undefined) => string;
  readOnly?: boolean;
  onGuardado?: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cerrado = op.stage === "WON" || op.stage === "LOST";

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: "var(--border-subtle)" }}>
      <span className={chip} style={chipStyle} title="De antes de Operaciones: se ordena en la #958">
        {NEGOCIO_ANTERIOR_LABEL} · {etiquetaEtapaVieja(op.stage)}
      </span>
      <span className="text-[color:var(--text-secondary)]">{queSeVende(op)}</span>
      <span className="num">{dinero(op.estimatedValue, op.currency)}</span>
      {!readOnly && !cerrado && (
        <button
          type="button"
          className="btn-secondary text-[12px]"
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true);
            setError(null);
            const e = await patch(op.id, { etapa: "EN_PREPARACION" });
            setOcupado(false);
            if (e) setError(e);
            else onGuardado?.();
          }}
        >
          {ACCION_DE_ETAPA.EN_PREPARACION}
        </button>
      )}
      <Link href={`/pipeline/${op.id}`} className="ml-auto text-[12px] text-[color:var(--color-teal,#0D9488)] hover:underline">
        Ver detalle
      </Link>
      {error && <span role="alert" className="w-full text-xs text-[color:var(--color-danger,#DC2626)]">{error}</span>}
    </li>
  );
}

interface Opcion {
  id: string;
  name?: string;
  unitNumber?: string;
  unitType?: string;
  price?: string;
}

/** Apartar sin unidad: se elige del inventario del Hub (solo las disponibles). */
function DialogoApartar({ op, onCerrar, onGuardado }: { op: OperacionDelContacto | null; onCerrar: () => void; onGuardado?: () => void }) {
  const [desarrollos, setDesarrollos] = useState<Opcion[]>([]);
  const [unidades, setUnidades] = useState<Opcion[]>([]);
  const [desarrollo, setDesarrollo] = useState("");
  const [unidad, setUnidad] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!op) return;
    setDesarrollo("");
    setUnidad("");
    setError(null);
    fetch("/api/hub/developments")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setDesarrollos(j.data ?? []))
      .catch(() => setDesarrollos([]));
  }, [op]);

  useEffect(() => {
    setUnidad("");
    if (!desarrollo) {
      setUnidades([]);
      return;
    }
    fetch(`/api/hub/units?developmentId=${encodeURIComponent(desarrollo)}&onlyAvailable=true`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setUnidades(j.data ?? []))
      .catch(() => setUnidades([]));
  }, [desarrollo]);

  async function apartar() {
    if (!op || !unidad) return;
    setOcupado(true);
    setError(null);
    const e = await patch(op.id, { etapa: "APARTADO", hubDevelopmentId: desarrollo, hubUnitId: unidad });
    setOcupado(false);
    if (e) {
      setError(e);
      return;
    }
    onCerrar();
    onGuardado?.();
  }

  return (
    <Dialog open={!!op} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apartar</DialogTitle>
          <DialogDescription>Elige la unidad que aparta el cliente. Se aparta también en el inventario.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-[13px]">
          <label className="block">
            Desarrollo
            <select className="form-input mt-1 w-full" value={desarrollo} onChange={(e) => setDesarrollo(e.target.value)}>
              <option value="">Elegir…</option>
              {desarrollos.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            Unidad
            <select className="form-input mt-1 w-full" value={unidad} disabled={!desarrollo} onChange={(e) => setUnidad(e.target.value)}>
              <option value="">{desarrollo && unidades.length === 0 ? "Sin unidades disponibles" : "Elegir…"}</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {[u.unitNumber, u.unitType, u.price ? dinero(u.price) : null].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          </label>
          {error && <p role="alert" className="text-xs text-[color:var(--color-danger,#DC2626)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary text-[13px]" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="btn-primary text-[13px]" disabled={!unidad || ocupado} onClick={() => void apartar()}>
              Apartar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
