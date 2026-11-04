// "Usado por…" de cada guion: qué bot general, marcas (con sus cuentas conectadas) y agentes por
// tipo de contacto lo tienen elegido. Pura: usa los datos que ya baja /api/admin/bot/resumen.
import type { AgenteLite, BotConfigLite, CuentaLite, MarcaLite } from "./quien-contesta";

export interface EntradaUsoGuiones {
  botConfig: Pick<BotConfigLite, "activePlaybookId">;
  agentes: AgenteLite[];
  marcas: MarcaLite[];
  cuentas: CuentaLite[];
}

/** playbookId → lista de textos cortos («Bot general», «Marca X (cuenta A, cuenta B)», «Agente Y»). */
export function usoDeGuiones(e: EntradaUsoGuiones, excluirAgenteId?: string | null): Map<string, string[]> {
  const uso = new Map<string, string[]>();
  const agregar = (id: string | null | undefined, texto: string) => {
    if (!id) return;
    uso.set(id, [...(uso.get(id) ?? []), texto]);
  };
  agregar(e.botConfig.activePlaybookId, "Bot general");
  for (const m of e.marcas) {
    const cuentas = e.cuentas.filter((c) => c.brandId === m.id).map((c) => c.name);
    agregar(m.playbookId, cuentas.length ? `Marca ${m.name} (${cuentas.join(", ")})` : `Marca ${m.name}`);
  }
  for (const a of e.agentes) {
    if (a.id === excluirAgenteId) continue;
    agregar(a.playbookId, `Agente ${a.name}`);
  }
  return uso;
}

/** Texto para mostrar junto al guion; vacío si nadie lo usa. */
export function textoUsadoPor(usos: string[] | undefined): string {
  return usos?.length ? `usado por: ${usos.join("; ")}` : "sin uso";
}
