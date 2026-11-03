// Rúbrica de actitud (spec §4.3): cuatro ejes de 0 a 5 sobre las tres respuestas
// situacionales. Una llamada aparte a Claude, con timeout; cualquier fallo → null y la
// evaluación sigue sin actitud (evaluar.ts lo marca en el desglose).
import { askClaude } from "@/lib/bot/claude";
import { CLAVES_ACTITUD, type Respuestas } from "./respuestas";

export interface Actitud { puntos: number; razones: string[] }

const EJES = ["motivacion", "rechazo", "ambicion", "claridad"] as const;
const TIMEOUT_MS = 6_000;

const SYSTEM =
  "Eres reclutador de asesores inmobiliarios. Evalúa las respuestas de un candidato a tres preguntas " +
  "situacionales con cuatro ejes, cada uno de 0 a 5: motivacion (razones concretas para vender bienes raíces, " +
  "no genéricas), rechazo (qué hizo ante un no: persistencia con criterio, no terquedad), ambicion (meta a 12 meses " +
  "medible y realista), claridad (se expresa con orden y sin rodeos). Responde SOLO JSON: " +
  '{"ejes":{"motivacion":n,"rechazo":n,"ambicion":n,"claridad":n},"razones":["máximo 3 frases cortas en español"]}';

export function parsearActitud(texto: string): Actitud | null {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Si el modelo rodea el JSON con prosa («Aquí está: {...}»), nos quedamos con el objeto.
  const objeto = limpio.startsWith("{") ? limpio : (limpio.match(/\{[\s\S]*\}/)?.[0] ?? limpio);
  try {
    const j = JSON.parse(objeto) as { ejes?: Record<string, unknown>; razones?: unknown };
    if (!j || typeof j !== "object" || !j.ejes) return null;
    let puntos = 0;
    let vistos = 0;
    for (const eje of EJES) {
      const v = j.ejes[eje];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      vistos++;
      puntos += Math.max(0, Math.min(5, Math.round(v)));
    }
    if (vistos === 0) return null;
    const razones = Array.isArray(j.razones) ? j.razones.filter((r): r is string => typeof r === "string").slice(0, 3) : [];
    return { puntos, razones };
  } catch {
    return null;
  }
}

export async function evaluarActitud(respuestas: Respuestas, model: string): Promise<Actitud | null> {
  const contestadas = CLAVES_ACTITUD.filter((k) => respuestas[k]);
  if (contestadas.length === 0) return null;
  const cuerpo = [
    `1) ¿Por qué quieres vender bienes raíces y no otra cosa?\n${respuestas.actitud_1 ?? "(sin respuesta)"}`,
    `2) La última vez que te dijeron que no, ¿qué hiciste?\n${respuestas.actitud_2 ?? "(sin respuesta)"}`,
    `3) ¿Qué meta te pondrías a 12 meses?\n${respuestas.actitud_3 ?? "(sin respuesta)"}`,
  ].join("\n\n");
  try {
    const texto = await Promise.race([
      askClaude({ system: SYSTEM, messages: [{ role: "user", content: cuerpo }], maxTokens: 300, model }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    return texto ? parsearActitud(texto) : null;
  } catch (err) {
    console.warn("[reclutamiento] rúbrica de actitud falló:", err);
    return null;
  }
}
