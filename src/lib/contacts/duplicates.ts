import { normalizePhoneE164 } from "@/lib/phone";

export interface DupContact {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
}

export type DuplicateMatchType = "strong" | "name";

export interface DuplicateGroup {
  ids: string[];
  matchType: DuplicateMatchType;
}

function makeUnionFind() {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  return { parent, find, union };
}

// Normaliza a minúsculas, sin acentos y con espacios colapsados — mismo
// patrón que capture.ts/brand-linter.ts para matching tolerante.
function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const EXCLUDED_FIRST_NAMES = new Set(["instagram", "messenger", "whatsapp"]);

/** Guardas del name-matching débil: descarta placeholders de contactos DM-born sin identificar. */
function isExcludedFromNameMatch(ct: DupContact): boolean {
  const normFirst = normalizeName(ct.firstName ?? "");
  if (EXCLUDED_FIRST_NAMES.has(normFirst)) return true;
  const normFull = normalizeName(`${ct.firstName ?? ""} ${ct.lastName ?? ""}`);
  if (normFull.includes("por identificar")) return true;
  return false;
}

/**
 * Agrupa contactos duplicados por dos niveles de confianza:
 * - "strong": email (lower) o teléfono E.164 exactos compartidos.
 * - "name": nombre completo normalizado exacto (weak; solo si NO hay ya un
 *   match fuerte disponible para ese contacto), con guardas anti-placeholder.
 * Si un grupo mezcla ambos criterios (transitividad), gana "strong".
 * Devuelve grupos de tamaño >= 2.
 */
export function buildDuplicateGroups(contacts: DupContact[]): DuplicateGroup[] {
  const strongUF = makeUnionFind();
  const fullUF = makeUnionFind();
  for (const ct of contacts) {
    strongUF.parent.set(ct.id, ct.id);
    fullUF.parent.set(ct.id, ct.id);
  }

  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const ct of contacts) {
    const email = ct.email?.trim().toLowerCase();
    if (email) {
      const prev = byEmail.get(email);
      if (prev) {
        strongUF.union(prev, ct.id);
        fullUF.union(prev, ct.id);
      } else {
        byEmail.set(email, ct.id);
      }
    }
    const phone = normalizePhoneE164(ct.phone);
    if (phone) {
      const prev = byPhone.get(phone);
      if (prev) {
        strongUF.union(prev, ct.id);
        fullUF.union(prev, ct.id);
      } else {
        byPhone.set(phone, ct.id);
      }
    }
  }

  const byName = new Map<string, string>();
  for (const ct of contacts) {
    if (isExcludedFromNameMatch(ct)) continue;
    const name = normalizeName(`${ct.firstName ?? ""} ${ct.lastName ?? ""}`);
    if (!name) continue;
    const prev = byName.get(name);
    if (prev) fullUF.union(prev, ct.id);
    else byName.set(name, ct.id);
  }

  const groups = new Map<string, string[]>();
  for (const ct of contacts) {
    const root = fullUF.find(ct.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(ct.id);
  }

  const result: DuplicateGroup[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const isStrong = ids.some((a, i) =>
      ids.slice(i + 1).some((b) => strongUF.find(a) === strongUF.find(b))
    );
    result.push({ ids, matchType: isStrong ? "strong" : "name" });
  }
  return result;
}
