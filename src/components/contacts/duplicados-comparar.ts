// Lógica pura de Duplicados: filtro por asesor y vista comparativa lado a lado.

export interface ContactoComparable {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  createdAt: string;
  assignedTo: { name: string | null } | null;
  instagramId: string | null;
  messengerPsid: string | null;
  _count: { deals: number; activities: number };
}

export const SIN_ASESOR = "__sin_asesor__";

const nombreAsesor = (c: ContactoComparable): string | null => c.assignedTo?.name?.trim() || null;

/** Asesores presentes en los grupos (orden alfabético) y si hay contactos sin asesor. */
export function asesoresDeGrupos(grupos: Array<{ contacts: ContactoComparable[] }>): { nombres: string[]; haySinAsesor: boolean } {
  const nombres = new Set<string>();
  let haySinAsesor = false;
  for (const g of grupos) {
    for (const c of g.contacts) {
      const n = nombreAsesor(c);
      if (n) nombres.add(n); else haySinAsesor = true;
    }
  }
  return { nombres: [...nombres].sort((a, b) => a.localeCompare(b, "es")), haySinAsesor };
}

/** Deja los grupos donde AL MENOS un contacto tiene ese asesor ("" = todos; SIN_ASESOR = sin asignar). */
export function filtrarGruposPorAsesor<G extends { contacts: ContactoComparable[] }>(grupos: G[], filtro: string): G[] {
  if (!filtro) return grupos;
  return grupos.filter((g) =>
    g.contacts.some((c) => {
      const n = nombreAsesor(c);
      return filtro === SIN_ASESOR ? n === null : n === filtro;
    }),
  );
}

export interface FilaComparativa {
  clave: string;
  etiqueta: string;
  /** Un valor por contacto, en el mismo orden que los contactos. */
  valores: string[];
  /** true si los contactos no coinciden en este campo. */
  difiere: boolean;
}

const VACIO = "—";

function canal(c: ContactoComparable): string {
  if (c.instagramId) return "Instagram";
  if (c.messengerPsid) return "Messenger";
  return VACIO;
}

function fecha(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? VACIO : d.toISOString().slice(0, 10);
}

/** Campos clave en filas, un contacto por columna; marca las filas donde hay diferencias. */
export function armarComparativa(contactos: ContactoComparable[]): FilaComparativa[] {
  const defs: Array<[string, string, (c: ContactoComparable) => string]> = [
    ["nombre", "Nombre", (c) => `${c.firstName} ${c.lastName}`.trim() || VACIO],
    ["correo", "Correo", (c) => c.email?.trim() || VACIO],
    ["telefono", "Teléfono", (c) => c.phone?.trim() || VACIO],
    ["asesor", "Asesor", (c) => nombreAsesor(c) ?? "Sin asesor"],
    ["canal", "Canal de chat", canal],
    ["negocios", "Negocios", (c) => String(c._count.deals)],
    ["actividades", "Actividades", (c) => String(c._count.activities)],
    ["creado", "Creado el", (c) => fecha(c.createdAt)],
  ];
  return defs.map(([clave, etiqueta, f]) => {
    const valores = contactos.map(f);
    const norm = valores.map((v) => v.toLowerCase().replace(/\s+/g, " "));
    return { clave, etiqueta, valores, difiere: new Set(norm).size > 1 };
  });
}
