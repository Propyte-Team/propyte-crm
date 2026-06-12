// Tipos del catálogo del Hub (proyección read-only desde real_estate_hub).
// El CRM NO posee inventario: estos tipos representan datos cuya fuente de verdad
// es el Hub (Propyte_hub / real_estate_hub). Ver speckit MAESTRO §2.1.

export interface HubDevelopment {
  id: string;
  nombre: string;
  zona: string | null;
  plaza: string | null;
  status: string | null;
  precioMin: number | null;
  precioMax: number | null;
  moneda: string;
}

export interface HubUnit {
  id: string;
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
  status: string | null; // estado_unidad del Hub (DISPONIBLE/APARTADA/VENDIDA/…)
}

export interface HubHoldResult {
  ok: boolean;
  unit?: { id: string; status: string; holdExpiresAt: string | null };
  error?: string;
}

export interface HubUnitFilters {
  developmentId?: string;
  search?: string;
  onlyAvailable?: boolean;
  limit?: number;
}

export interface HubDevelopmentFilters {
  search?: string;
  zone?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  limit?: number;
}
