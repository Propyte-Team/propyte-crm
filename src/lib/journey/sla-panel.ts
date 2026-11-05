// Políticas SLA activas para mostrarlas junto a los flujos de /journey (solo lectura). Puro.
// Antes vivían en el mapa general que se retiró; la edición sigue en Configuración → Automatización.
import { describeConditions } from "@/lib/workflows/condition-catalog";

export interface PoliticaSla {
  id: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  firstTouchMinutes: number;
  retryMinutes: number;
  orphanHours: number;
  conditions: unknown;
}

export interface FilaSla {
  id: string;
  name: string;
  isDefault: boolean;
  priority: number;
  /** «Primer contacto en 15 min · reintento cada 60 min · sin dueño tras 24 h». */
  tiempos: string;
  /** A quién aplica, en frase («Todos los contactos»). */
  aQuien: string;
}

/** Solo las activas, de mayor a menor prioridad (número menor = primero). */
export function filasDeSla(politicas: PoliticaSla[]): FilaSla[] {
  return politicas
    .filter((p) => p.isActive)
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      priority: p.priority,
      tiempos: `Primer contacto en ${p.firstTouchMinutes} min · reintento cada ${p.retryMinutes} min · sin dueño tras ${p.orphanHours} h`,
      aQuien: p.isDefault ? "Todos los contactos" : describeConditions(p.conditions, { vacio: "Todos los contactos" }),
    }));
}
