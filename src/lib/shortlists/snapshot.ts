import type { HubUnit } from "@/lib/hub/types";

/** Datos del Hub congelados al agregar la unidad a la shortlist. */
export interface UnitSnapshot {
  hubUnitId: string;
  developmentId: string | null;
  numero: string | null;
  titulo: string | null;
  tipo: string | null;
  tipologia: string | null;
  recamaras: number | null;
  banos: number | null;
  m2Construccion: number | null;
  m2Total: number | null;
  precioMxn: number | null;
  precioUsd: number | null;
  moneda: string;
  status: string | null;
}

export function buildUnitSnapshot(u: HubUnit): UnitSnapshot {
  return {
    hubUnitId: u.id,
    developmentId: u.developmentId,
    numero: u.numero,
    titulo: u.titulo,
    tipo: u.tipo,
    tipologia: u.tipologia,
    recamaras: u.recamaras,
    banos: u.banos,
    m2Construccion: u.m2Construccion,
    m2Total: u.m2Total,
    precioMxn: u.precioMxn,
    precioUsd: u.precioUsd,
    moneda: u.moneda,
    status: u.status,
  };
}

export function nextSortOrder(items: { sortOrder: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1;
}

export function shouldMarkOpened(shortlist: { openedAt: Date | null }): boolean {
  return shortlist.openedAt == null;
}
