// Coerción/validación de valores capturados por el bot, por CaptureType (Anexo Técnico §B-Task 3).
// Regla de oro: NUNCA regresar ok:true con un valor no confiable. Si no se puede
// coercionar con confianza, regresar { ok:false, writes:[] } y quien llama no escribe nada.
import type { CaptureType } from "@prisma/client";
import { normalizePhoneE164 } from "@/lib/phone";

export interface EnumOption {
  value: string;
  synonyms?: string[];
}

export interface CaptureTask {
  targetField: string;
  captureType: CaptureType;
  enumOptions?: EnumOption[];
}

export interface CaptureWrite {
  field: string;
  value: string | number | boolean;
}

export interface CaptureResult {
  ok: boolean;
  writes: CaptureWrite[];
}

const NOT_OK: CaptureResult = { ok: false, writes: [] };

// Normaliza a minúsculas y sin acentos — mismo patrón que brand-linter.ts.
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeForMatch(s: string): string {
  return stripAccents(s.toLowerCase());
}

// ---------------------------------------------------------------------------
// MONEY / BUDGET_RANGE — parser compartido de montos en español.
// ---------------------------------------------------------------------------
const MULTIPLIER_WORDS: Record<string, number> = {
  millones: 1_000_000,
  millon: 1_000_000,
  mdp: 1_000_000,
  mil: 1_000,
  k: 1_000,
};
// Orden de intento para el multiplicador "compartido" (no pegado a un número
// específico) — no afecta la correctitud porque cada patrón exige que no le
// siga una letra, pero se deja explícito de mayor a menor magnitud.
const MULTIPLIER_ORDER = ["millones", "millon", "mdp", "mil", "k"];

function findSharedMultiplier(norm: string): number | null {
  for (const word of MULTIPLIER_ORDER) {
    const re = new RegExp(`${word}(?![a-z])`);
    if (re.test(norm)) return MULTIPLIER_WORDS[word];
  }
  return null;
}

// Extrae todos los montos numéricos de un texto, aplicando el sufijo
// "millones/millón/mdp/mil/k" pegado al número, o si no hay uno pegado,
// el sufijo compartido que aparezca en cualquier parte del texto (ej.
// "entre 2 y 3 millones" → el "millones" del final aplica a ambos números).
function parseMoneyAmounts(rawText: string): number[] {
  const norm = normalizeForMatch(rawText);
  const sharedMultiplier = findSharedMultiplier(norm);

  const numberRe = /\d[\d.,]*/g;
  const amounts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = numberRe.exec(norm))) {
    const numValue = parseFloat(m[0].replace(/,/g, ""));
    if (Number.isNaN(numValue)) continue;

    const rest = norm.slice(m.index + m[0].length);
    const localMatch = /^\s*(millones|millon|mdp|mil|k)(?![a-z])/.exec(rest);
    const multiplier = localMatch ? MULTIPLIER_WORDS[localMatch[1]] : (sharedMultiplier ?? 1);
    amounts.push(numValue * multiplier);
  }
  return amounts;
}

function coerceMoney(targetField: string, raw: string): CaptureResult {
  const amounts = parseMoneyAmounts(raw);
  if (amounts.length === 0) return NOT_OK;
  return { ok: true, writes: [{ field: targetField, value: amounts[0] }] };
}

function coerceBudgetRange(raw: string): CaptureResult {
  const amounts = parseMoneyAmounts(raw);
  if (amounts.length === 0) return NOT_OK;
  const min = amounts.length >= 2 ? Math.min(amounts[0], amounts[1]) : amounts[0];
  const max = amounts.length >= 2 ? Math.max(amounts[0], amounts[1]) : amounts[0];
  return {
    ok: true,
    writes: [
      { field: "budgetMin", value: min },
      { field: "budgetMax", value: max },
    ],
  };
}

// ---------------------------------------------------------------------------
// EMAIL
// ---------------------------------------------------------------------------
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function coerceEmail(targetField: string, raw: string): CaptureResult {
  const match = raw.match(EMAIL_RE);
  if (!match) return NOT_OK;
  return { ok: true, writes: [{ field: targetField, value: match[0].toLowerCase() }] };
}

// ---------------------------------------------------------------------------
// PHONE — reusa el normalizador E.164 de @/lib/phone.
// ---------------------------------------------------------------------------
function coercePhone(targetField: string, raw: string): CaptureResult {
  const normalized = normalizePhoneE164(raw);
  if (!normalized) return NOT_OK;
  return { ok: true, writes: [{ field: targetField, value: normalized }] };
}

// ---------------------------------------------------------------------------
// ENUM — contains-match sobre value/synonyms normalizados.
// ---------------------------------------------------------------------------
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Regla principal: CONTAINS literal (soporta sinónimos multi-palabra).
// Fallback quirúrgico: diminutivo en español para candidatos de una sola
// palabra (ej. "casa" -> "casita"), donde el CONTAINS literal falla porque
// el diminutivo reemplaza la vocal final ("cas" + "it" + vocal + "s"?).
// Anclado con \b para no generar falsos positivos (ej. "castillo" NO matchea).
function isEnumMatch(normRaw: string, normCandidate: string): boolean {
  if (!normCandidate) return false;
  if (normRaw.includes(normCandidate)) return true;
  if (!normCandidate.includes(" ") && normCandidate.length > 3) {
    const stem = escapeRegex(normCandidate.slice(0, -1));
    const diminutiveRe = new RegExp(`\\b${stem}it[ao]s?\\b`);
    if (diminutiveRe.test(normRaw)) return true;
  }
  return false;
}

function coerceEnum(targetField: string, raw: string, enumOptions?: EnumOption[]): CaptureResult {
  if (!enumOptions || enumOptions.length === 0) return NOT_OK;
  const normRaw = normalizeForMatch(raw);
  if (!normRaw) return NOT_OK;

  for (const option of enumOptions) {
    const candidates = [option.value, ...(option.synonyms ?? [])];
    for (const candidate of candidates) {
      const normCandidate = normalizeForMatch(candidate);
      if (isEnumMatch(normRaw, normCandidate)) {
        return { ok: true, writes: [{ field: targetField, value: option.value }] };
      }
    }
  }
  return NOT_OK;
}

// ---------------------------------------------------------------------------
// BOOLEAN — solo tokens explícitos de sí/no, insensible a acentos/mayúsculas.
// ---------------------------------------------------------------------------
const TRUE_WORDS = ["si", "claro", "yes", "true", "1"];
const FALSE_WORDS = ["no", "false", "0"];

function hasWholeWord(norm: string, word: string): boolean {
  const re = new RegExp(`\\b${word}\\b`);
  return re.test(norm);
}

function coerceBoolean(targetField: string, raw: string): CaptureResult {
  const norm = normalizeForMatch(raw);
  if (TRUE_WORDS.some((w) => hasWholeWord(norm, w))) {
    return { ok: true, writes: [{ field: targetField, value: true }] };
  }
  if (FALSE_WORDS.some((w) => hasWholeWord(norm, w))) {
    return { ok: true, writes: [{ field: targetField, value: false }] };
  }
  return NOT_OK;
}

// ---------------------------------------------------------------------------
// NUMBER — un número plano (decimales/comas permitidas).
// ---------------------------------------------------------------------------
function coerceNumber(targetField: string, raw: string): CaptureResult {
  const match = raw.match(/-?\d[\d.,]*/);
  if (!match) return NOT_OK;
  const value = parseFloat(match[0].replace(/,/g, ""));
  if (Number.isNaN(value)) return NOT_OK;
  return { ok: true, writes: [{ field: targetField, value }] };
}

// ---------------------------------------------------------------------------
// FULL_NAME — siempre escribe firstName/lastName (ignora targetField).
// ---------------------------------------------------------------------------
function coerceFullName(raw: string): CaptureResult {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return NOT_OK;
  const firstName = tokens[0];
  const lastName = tokens.slice(1).join(" ");
  return {
    ok: true,
    writes: [
      { field: "firstName", value: firstName },
      { field: "lastName", value: lastName },
    ],
  };
}

// ---------------------------------------------------------------------------
// TEXT / ZONE — trim simple.
// ---------------------------------------------------------------------------
function coerceTrimmed(targetField: string, raw: string): CaptureResult {
  const trimmed = raw.trim();
  if (!trimmed) return NOT_OK;
  return { ok: true, writes: [{ field: targetField, value: trimmed }] };
}

export function coerceCapture(task: CaptureTask, raw: string): CaptureResult {
  switch (task.captureType) {
    case "TEXT":
      return coerceTrimmed(task.targetField, raw);
    case "FULL_NAME":
      return coerceFullName(raw);
    case "EMAIL":
      return coerceEmail(task.targetField, raw);
    case "PHONE":
      return coercePhone(task.targetField, raw);
    case "MONEY":
      return coerceMoney(task.targetField, raw);
    case "BUDGET_RANGE":
      return coerceBudgetRange(raw);
    case "ENUM":
      return coerceEnum(task.targetField, raw, task.enumOptions);
    case "ZONE":
      return coerceTrimmed(task.targetField, raw);
    case "BOOLEAN":
      return coerceBoolean(task.targetField, raw);
    case "NUMBER":
      return coerceNumber(task.targetField, raw);
    default:
      return NOT_OK;
  }
}
