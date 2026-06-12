// Brand linter — guardarraíl de voz Sage (consolidado §6.0 / Anexo §D.6).
// Bloquea ANTES de enviar cualquier salida de IA con frases prohibidas
// (hype, urgencia/escasez manufacturada, promesas de retorno).
const PROHIBITED = [
  "oportunidad única",
  "oportunidad unica",
  "plusvalía garantizada",
  "plusvalia garantizada",
  "retorno garantizado",
  "ganancia garantizada",
  "paraíso",
  "paraiso",
  "últimas unidades",
  "ultimas unidades",
  "solo hoy",
  "sólo hoy",
  "antes de que se acabe",
  "no te lo pierdas",
  "inversión segura",
  "inversion segura",
  "sin riesgo",
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export interface LintResult {
  ok: boolean;
  violations: string[];
}

export function lintBrandVoice(text: string): LintResult {
  const norm = normalize(text);
  const violations: string[] = [];
  for (const phrase of PROHIBITED) {
    if (norm.includes(normalize(phrase)) && !violations.includes(phrase)) {
      // reporta la variante canónica (con acento) una sola vez
      const canonical = PROHIBITED.find((p) => normalize(p) === normalize(phrase));
      const label = canonical ?? phrase;
      if (!violations.some((v) => normalize(v) === normalize(label))) violations.push(label);
    }
  }
  return { ok: violations.length === 0, violations };
}
