// [TEMPORAL — diagnóstico webhook meta-dm]
// Buffer en memoria con los últimos hits que Meta manda al webhook de DMs.
// Permite ver, sin SSH, si Meta está llegando, qué payload envía, y si se guarda o truena.
// QUITAR (junto con la ruta /debug y las llamadas recordHit en route.ts) una vez resuelto.

export interface WebhookHit {
  at: string;
  object?: string;
  sigHeader: boolean;
  sigValid: boolean | "skipped";
  entryCount: number;
  parsed: number;
  processed: number;
  results: Array<Record<string, unknown>>;
  note?: string;
  rawSnippet: string;
}

const MAX = 40;
const hits: WebhookHit[] = [];

export function recordHit(hit: WebhookHit): void {
  hits.unshift(hit);
  if (hits.length > MAX) hits.length = MAX;
}

export function getHits(): WebhookHit[] {
  return hits;
}
