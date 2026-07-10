/**
 * Eval manual de tono del bot. Requiere ANTHROPIC_API_KEY. Cuesta unos centavos.
 * Uso: npx tsx scripts/eval-bot-voice.ts [--preset=PROFESIONAL_CALIDO]
 * Sin --preset corre los 4.
 */
import { buildSystemPrompt } from "../src/lib/bot/claude";
import { lintBrandVoice } from "../src/lib/bot/brand-linter";
import { DEFAULT_BOT_CONFIG } from "../src/lib/bot/config";
import { TONE_PRESETS } from "../src/lib/bot/tone-presets";
import type { BotTonePreset } from "@prisma/client";

const API_URL = "https://api.anthropic.com/v1/messages";
const contact = { firstName: "Juan", preferredLanguage: "ES" };

interface Scenario {
  name: string;
  messages: { role: "user" | "assistant"; content: string }[];
  catalog: any[];
  expectEscalate?: boolean;
  expectLang?: "ES" | "EN";
}

const SCENARIOS: Scenario[] = [
  { name: "apertura fría", messages: [{ role: "user", content: "Hola" }], catalog: [] },
  { name: "precio sin catálogo", messages: [{ role: "user", content: "¿Cuánto cuesta un depa en Tulum?" }], catalog: [] },
  { name: "calificar zona", messages: [{ role: "user", content: "Busco algo para invertir" }], catalog: [] },
  { name: "apartar (escala)", messages: [{ role: "user", content: "Quiero apartar hoy mismo" }], catalog: [], expectEscalate: true },
  { name: "queja (escala)", messages: [{ role: "user", content: "Tengo una queja del trato que recibí" }], catalog: [], expectEscalate: true },
  { name: "legal/fiscal (escala)", messages: [{ role: "user", content: "¿Qué impuestos pago como extranjero?" }], catalog: [], expectEscalate: true },
  { name: "inglés", messages: [{ role: "user", content: "Hi, do you have condos in Tulum?" }], catalog: [], expectLang: "EN" },
];

async function callClaude(system: string, messages: Scenario["messages"], model: string): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 300, system, thinking: { type: "disabled" }, messages }),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return (data.content?.find((b: any) => b.type === "text")?.text ?? "").trim();
}

async function judge(reply: string, model: string): Promise<{ score: number; reason: string }> {
  const rubric =
    "Evalúa esta respuesta de un asesor inmobiliario por WhatsApp. Puntúa 1-5 qué tan PROFESIONAL-CÁLIDA, humana, natural (no robótica) y libre de hype es. Devuelve SOLO JSON: {\"score\":n,\"reason\":\"...\"}.";
  const out = await callClaude(rubric, [{ role: "user", content: reply }], model);
  try {
    const j = JSON.parse(out.replace(/```json|```/g, "").trim());
    return { score: Number(j.score), reason: String(j.reason) };
  } catch {
    return { score: 0, reason: `no-parse: ${out.slice(0, 80)}` };
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY");
    process.exit(1);
  }
  const arg = process.argv.find((a) => a.startsWith("--preset="));
  const presets: BotTonePreset[] = arg
    ? [arg.split("=")[1] as BotTonePreset]
    : (Object.keys(TONE_PRESETS) as BotTonePreset[]);
  const model = process.env.BOT_MODEL?.trim() || "claude-sonnet-5";

  for (const preset of presets) {
    console.log(`\n===== PRESET: ${preset} =====`);
    for (const sc of SCENARIOS) {
      const system = buildSystemPrompt({ config: { ...DEFAULT_BOT_CONFIG, tonePreset: preset }, contact, catalog: sc.catalog });
      const reply = await callClaude(system, sc.messages, model);

      const lint = lintBrandVoice(reply);
      const hasEscalate = reply.includes("[ESCALAR]");
      const clean = reply.replace(/\[ESCALAR\]/g, "").trim();
      const invented = sc.catalog.length === 0 && /\$|MXN|USD/.test(clean);
      const gates: string[] = [];
      if (!lint.ok) gates.push(`linter:${lint.violations.join("|")}`);
      if (sc.expectEscalate && !hasEscalate) gates.push("falta[ESCALAR]");
      if (!sc.expectEscalate && hasEscalate) gates.push("escaló de más");
      if (invented) gates.push("cifra inventada sin catálogo");

      const j = await judge(clean, model);
      const verdict = gates.length === 0 ? "PASS" : `FAIL(${gates.join(", ")})`;
      console.log(`\n[${sc.name}] tono=${j.score}/5 ${verdict}`);
      console.log(`  → ${clean.replace(/\n/g, " ")}`);
      console.log(`  judge: ${j.reason}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
