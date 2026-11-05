import { describe, it, expect, vi, beforeEach } from "vitest";

// #960: la lista de Contactos (y todos los buscadores que usan esta ruta: agenda, actividades,
// alta de negocio) encuentra a una persona por su nombre completo aunque el nombre y el apellido
// estén en campos distintos. Se evalúa el `where` que la ruta manda a la base contra contactos de
// ejemplo, con la semántica de Postgres (`contains`, `insensitive`).

const contactFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a), count: vi.fn(async () => 0) },
    user: { findMany: vi.fn(async () => []) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
vi.mock("@/lib/api/orden", () => ({ ordenValidado: () => ({ orderBy: undefined, error: null }) }));
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: vi.fn(async () => "ALL") }));

import { GET } from "./route";

type Fila = { firstName: string; lastName: string; email: string | null; phone: string; deletedAt: null };
type Where = Record<string, unknown>;

function cumple(fila: Fila, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "AND") return (v as Where[]).every((w) => cumple(fila, w));
    if (k === "OR") return (v as Where[]).some((w) => cumple(fila, w));
    if (v === null) return (fila as Record<string, unknown>)[k] === null;
    const { contains, mode } = v as { contains: string; mode?: string };
    const valor = String((fila as Record<string, unknown>)[k] ?? "");
    return mode === "insensitive" ? valor.toLowerCase().includes(contains.toLowerCase()) : valor.includes(contains);
  });
}

const CAMILO: Fila = { firstName: "Camilo René", lastName: "Aguilar Pino", email: null, phone: "+529841110000", deletedAt: null };
const CAMILA: Fila = { firstName: "Camila", lastName: "Aguirre", email: null, phone: "+529842220000", deletedAt: null };

async function encuentra(texto: string): Promise<Fila[]> {
  contactFindMany.mockClear();
  await GET(new Request(`https://x/api/contacts?search=${encodeURIComponent(texto)}`) as never);
  const where = contactFindMany.mock.calls[0][0].where as Where;
  return [CAMILO, CAMILA].filter((c) => cumple(c, where));
}

beforeEach(() => {
  contactFindMany.mockReset();
  contactFindMany.mockResolvedValue([]);
  getServerSession.mockResolvedValue({ user: { id: "adm", role: "ADMIN", plaza: "PDC" } });
});

describe("GET /api/contacts?search= — nombre completo (#960)", () => {
  it.each(["Camilo Aguilar", "Aguilar Camilo", "camilo rené aguilar"])("«%s» encuentra a Camilo René Aguilar Pino", async (t) => {
    expect(await encuentra(t)).toEqual([CAMILO]);
  });

  it("«Camilo Pérez» no encuentra a nadie", async () => {
    expect(await encuentra("Camilo Pérez")).toEqual([]);
  });

  it("una sola palabra sigue encontrando por nombre o apellido", async () => {
    expect(await encuentra("Agui")).toEqual([CAMILO, CAMILA]);
  });
});
