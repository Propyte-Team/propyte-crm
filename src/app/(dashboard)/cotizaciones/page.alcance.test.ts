import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";

// tsconfig usa `jsx: preserve`: en vitest el JSX de la página sale como React.createElement.
vi.stubGlobal("React", React);

// #867: la página cargaba TODAS las cotizaciones con cualquier sesión. Esta prueba falla
// contra el código anterior (el `where` era solo `{ deletedAt: null }`).

const quoteFindMany = vi.fn();
vi.mock("@/lib/db", () => ({ default: { quote: { findMany: (...a: unknown[]) => quoteFindMany(...a) } } }));
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: async () => "ALL" }));
vi.mock("@/components/quotes/quotes-global-view", () => ({ QuotesGlobalView: () => null }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
let sesion: { user: { id: string; role: string; plaza: string } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

import CotizacionesPage from "./page";

beforeEach(() => {
  quoteFindMany.mockReset();
  quoteFindMany.mockResolvedValue([]);
});

describe("/cotizaciones — alcance por rol (#867)", () => {
  it("un ASESOR solo consulta las suyas", async () => {
    sesion = { user: { id: "asesor-1", role: "ASESOR_SR", plaza: "PDC" } };
    await CotizacionesPage();
    expect(quoteFindMany.mock.calls[0][0].where).toEqual({
      AND: [
        { deletedAt: null },
        { OR: [{ createdById: "asesor-1" }, { deal: { assignedToId: "asesor-1" } }] },
      ],
    });
  });

  it("un TEAM_LEADER consulta su equipo, no la plaza", async () => {
    sesion = { user: { id: "tl-1", role: "TEAM_LEADER", plaza: "PDC" } };
    await CotizacionesPage();
    const or = quoteFindMany.mock.calls[0][0].where.AND[1].OR;
    expect(or).toContainEqual({ deal: { assignedTo: { teamLeaderId: "tl-1" } } });
    expect(JSON.stringify(or)).not.toContain("plaza");
  });

  it("un ADMIN consulta todas", async () => {
    sesion = { user: { id: "admin-1", role: "ADMIN", plaza: "TULUM" } };
    await CotizacionesPage();
    expect(quoteFindMany.mock.calls[0][0].where).toEqual({ AND: [{ deletedAt: null }, {}] });
  });
});
