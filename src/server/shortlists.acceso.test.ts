import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #711 · AUD-20260903 S-04.
//
// Ninguna de las funciones de mutación recibía al usuario. Cualquiera con sesión podía
// marcar como enviada la propuesta de otro asesor —con el enlace público ya en manos del
// cliente—, renombrarla, alterar las notas de sus unidades o borrarla. Y al tocar un ítem
// no se usaba el id de la propuesta de la URL: bastaba adivinar el id del ítem.

const shortlistFindFirst = vi.fn();
const shortlistUpdate = vi.fn();
const itemDeleteMany = vi.fn();
const itemUpdateMany = vi.fn();
const itemFindUnique = vi.fn();
const itemFindMany = vi.fn();
const itemCreate = vi.fn();
const dealFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    shortlist: {
      findFirst: (...a: unknown[]) => shortlistFindFirst(...a),
      update: (...a: unknown[]) => shortlistUpdate(...a),
    },
    shortlistItem: {
      deleteMany: (...a: unknown[]) => itemDeleteMany(...a),
      updateMany: (...a: unknown[]) => itemUpdateMany(...a),
      findUnique: (...a: unknown[]) => itemFindUnique(...a),
      findMany: (...a: unknown[]) => itemFindMany(...a),
      create: (...a: unknown[]) => itemCreate(...a),
    },
    deal: { findFirst: (...a: unknown[]) => dealFindFirst(...a) },
  },
}));

vi.mock("@/lib/hub/client", () => ({ getHubUnit: async () => ({ id: "u1", price: 1 }) }));

import {
  sendShortlist,
  updateShortlistTitle,
  softDeleteShortlist,
  removeItem,
  updateItemNote,
  addItem,
} from "./shortlists";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";

const SL = "sl-1";
const asesor = { id: "asesor-1", role: "ASESOR", plaza: "PDC" };

/** Propuesta de otro asesor, sin negocio asociado. */
function propuestaAjena() {
  shortlistFindFirst.mockResolvedValue({ id: SL, createdById: "otro-asesor", dealId: null });
}

beforeEach(() => {
  for (const m of [
    shortlistFindFirst, shortlistUpdate, itemDeleteMany, itemUpdateMany,
    itemFindUnique, itemFindMany, itemCreate, dealFindFirst,
  ]) m.mockReset();

  shortlistUpdate.mockResolvedValue({ id: SL });
  itemDeleteMany.mockResolvedValue({ count: 1 });
  itemUpdateMany.mockResolvedValue({ count: 1 });
  itemFindUnique.mockResolvedValue({ id: "it-1" });
  itemFindMany.mockResolvedValue([]);
  itemCreate.mockResolvedValue({ id: "it-1" });
});

describe("propuesta de otro asesor (#711)", () => {
  it("no se puede marcar como enviada", async () => {
    propuestaAjena();
    expect(await sendShortlist(SL, asesor)).toEqual({ error: FUERA_DE_ALCANCE });
    expect(shortlistUpdate).not.toHaveBeenCalled();
  });

  it("no se puede renombrar ni borrar", async () => {
    propuestaAjena();
    expect(await updateShortlistTitle(SL, "Otro título", asesor)).toEqual({ error: FUERA_DE_ALCANCE });
    expect(await softDeleteShortlist(SL, asesor)).toEqual({ error: FUERA_DE_ALCANCE });
    expect(shortlistUpdate).not.toHaveBeenCalled();
  });

  it("no se le pueden agregar, quitar ni renotar unidades", async () => {
    propuestaAjena();
    expect(await addItem({ shortlistId: SL, hubUnitId: "u1" }, asesor)).toEqual({ error: FUERA_DE_ALCANCE });
    expect(await removeItem("it-1", SL, asesor)).toEqual({ error: FUERA_DE_ALCANCE });
    expect(await updateItemNote("it-1", SL, "nota", asesor)).toEqual({ error: FUERA_DE_ALCANCE });
    expect(itemCreate).not.toHaveBeenCalled();
    expect(itemDeleteMany).not.toHaveBeenCalled();
    expect(itemUpdateMany).not.toHaveBeenCalled();
  });
});

describe("propuesta propia y alcance heredado (#711)", () => {
  it("quien la creó la maneja", async () => {
    shortlistFindFirst.mockResolvedValue({ id: SL, createdById: asesor.id, dealId: null });

    expect(await sendShortlist(SL, asesor)).toHaveProperty("shortlist");
    expect(await removeItem("it-1", SL, asesor)).toEqual({ ok: true });
  });

  it("dirección entra a cualquiera", async () => {
    propuestaAjena();
    const director = { id: "dir-1", role: "DIRECTOR", plaza: "PDC" };

    expect(await sendShortlist(SL, director)).toHaveProperty("shortlist");
  });

  it("si la propuesta cuelga de un negocio, hereda el alcance del negocio", async () => {
    shortlistFindFirst.mockResolvedValue({ id: SL, createdById: "otro-asesor", dealId: "deal-1" });
    // El negocio sí es del asesor: aunque la propuesta la creó otro, puede trabajarla.
    dealFindFirst.mockResolvedValue({
      id: "deal-1",
      assignedToId: asesor.id,
      assignedTo: { plaza: "PDC", teamLeaderId: null },
    });

    expect(await sendShortlist(SL, asesor)).toHaveProperty("shortlist");
  });
});

describe("los ítems quedan atados a su propuesta (#711)", () => {
  it("un ítem de otra propuesta no se borra aunque se adivine su id", async () => {
    shortlistFindFirst.mockResolvedValue({ id: SL, createdById: asesor.id, dealId: null });
    // El id existe, pero pertenece a otra propuesta: el deleteMany no encuentra nada.
    itemDeleteMany.mockResolvedValue({ count: 0 });

    expect(await removeItem("it-de-otra", SL, asesor)).toEqual({ error: FUERA_DE_ALCANCE });
    // Y la condición viajó en la consulta, no solo en la comprobación previa.
    expect(itemDeleteMany.mock.calls[0][0].where).toEqual({ id: "it-de-otra", shortlistId: SL });
  });
});
