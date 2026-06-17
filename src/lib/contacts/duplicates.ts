import { normalizePhoneE164 } from "@/lib/phone";

export interface DupContact {
  id: string;
  email: string | null;
  phone: string | null;
}

/** Agrupa contactos que comparten email (lower) o teléfono E.164. Devuelve grupos de tamaño >= 2. */
export function buildDuplicateGroups(contacts: DupContact[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };

  for (const ct of contacts) parent.set(ct.id, ct.id);

  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const ct of contacts) {
    const email = ct.email?.trim().toLowerCase();
    if (email) {
      const prev = byEmail.get(email);
      if (prev) union(prev, ct.id); else byEmail.set(email, ct.id);
    }
    const phone = normalizePhoneE164(ct.phone);
    if (phone) {
      const prev = byPhone.get(phone);
      if (prev) union(prev, ct.id); else byPhone.set(phone, ct.id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const ct of contacts) {
    const root = find(ct.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(ct.id);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}
