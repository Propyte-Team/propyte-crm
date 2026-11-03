// Veredicto del bot y su mapa a las etapas del módulo Reclutamiento (#926, base de Notion).
// El bot solo mueve la etapa cuando el candidato sigue en la inicial: si un humano ya lo movió,
// el veredicto se guarda en botResultado y la etapa se respeta.
import { ETAPA_INICIAL, type EtapaCode } from "./shared";

export const VEREDICTOS = ["APTO", "REVISAR", "NO_APTO"] as const;
export type Veredicto = (typeof VEREDICTOS)[number];

const ETAPA_POR_VEREDICTO: Record<Veredicto, EtapaCode> = {
  APTO: "CONTACTO_INICIAL", // el gerente lo contacta para agendar entrevista
  REVISAR: "FILTRO_CV", // lo revisa una persona
  NO_APTO: "DESCARTADO", // falló un filtro o puntaje bajo; se puede reabrir a mano
};

export function etapaDeResultado(v: Veredicto): EtapaCode {
  return ETAPA_POR_VEREDICTO[v];
}

export function botPuedeMoverEtapa(etapaActual: string): boolean {
  return etapaActual === ETAPA_INICIAL;
}
