import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #753. `meetSlaTimers` cerraba TODOS los temporizadores RUNNING del contacto, sin
// filtrar por tipo. Para FIRST_TOUCH y RETRY eso es correcto —los dos miden «cuánto
// tardamos en contestarle» y un toque saliente es lo que los cumple—, pero el ORPHAN mide
// otra cosa: si el lead consiguió DUEÑO. Mandarle un mensaje no le asigna un asesor.
//
// Medido en producción el 2026-09-09: el único ORPHAN de la historia se marcó cumplido 11
// segundos después de abrirse, sobre un plazo de 24 horas, con un solo mensaje saliente, y
// ese contacto sigue sin dueño. La #732 acababa de sacar el Pond del denominador del
// cumplimiento para que un lead que nadie atendió no pudiera contar como atención
// cumplida; esto lo reintroducía por la otra puerta.
//
// Las dos primeras pruebas de este archivo FALLAN contra origin/main.

const timerUpdateMany = vi.fn();
const contactUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    slaTimer: { updateMany: (...a: unknown[]) => timerUpdateMany(...a) },
    contact: { update: (...a: unknown[]) => contactUpdate(...a) },
  },
}));

import { meetSlaTimers, cumplirOrphan } from "./sla";

const CONTACTO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** El `where` con el que se pidió la escritura. */
function whereDe(llamada = 0): Record<string, unknown> {
  return timerUpdateMany.mock.calls[llamada][0].where;
}

function datosDe(llamada = 0): Record<string, unknown> {
  return timerUpdateMany.mock.calls[llamada][0].data;
}

beforeEach(() => {
  timerUpdateMany.mockReset();
  contactUpdate.mockReset();
  timerUpdateMany.mockResolvedValue({ count: 1 });
  contactUpdate.mockResolvedValue({});
});

describe("meetSlaTimers — un mensaje saliente NO cierra el reloj del Pond (#753)", () => {
  it("filtra por tipo: solo FIRST_TOUCH y RETRY", async () => {
    await meetSlaTimers(CONTACTO);

    // Lo que el arreglo añade. Sin esto, el `where` era {contactId, status} a secas.
    expect(whereDe().type).toEqual({ in: ["FIRST_TOUCH", "RETRY"] });
  });

  it("el ORPHAN queda fuera del filtro, no dentro de una lista más larga", async () => {
    await meetSlaTimers(CONTACTO);

    const tipos = (whereDe().type as { in: string[] }).in;
    expect(tipos).not.toContain("ORPHAN");
    // Y no se cuela por la puerta de al lado: sigue siendo UNA escritura, no una por tipo.
    expect(timerUpdateMany).toHaveBeenCalledOnce();
  });

  it("sigue cerrando los relojes de atención, que es a lo que vino", async () => {
    timerUpdateMany.mockResolvedValue({ count: 2 });

    expect(await meetSlaTimers(CONTACTO)).toBe(2);
    expect(whereDe().contactId).toBe(CONTACTO);
    expect(whereDe().status).toBe("RUNNING");
    expect(datosDe().status).toBe("MET");
    expect(datosDe().metAt).toBeInstanceOf(Date);
  });

  it("sigue marcando actividad cuando cerró alguno, y no cuando no cerró ninguno", async () => {
    // Este es el comportamiento previo y el arreglo no lo toca: se fija aquí para que un
    // cambio futuro del filtro no se lleve por delante el bump de lastActivityAt.
    await meetSlaTimers(CONTACTO);
    expect(contactUpdate).toHaveBeenCalledOnce();

    contactUpdate.mockClear();
    timerUpdateMany.mockResolvedValue({ count: 0 });
    await meetSlaTimers(CONTACTO);
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});

describe("cumplirOrphan — el reloj del Pond se cumple con el DUEÑO (#753)", () => {
  it("cierra solo los ORPHAN corriendo de ese contacto", async () => {
    await cumplirOrphan(CONTACTO);

    expect(whereDe()).toEqual({ contactId: CONTACTO, status: "RUNNING", type: "ORPHAN" });
    expect(datosDe().status).toBe("MET");
    expect(datosDe().metAt).toBeInstanceOf(Date);
  });

  it("NO toca lastActivityAt", async () => {
    // Conseguir dueño no es actividad con el cliente. Bumpearlo haría parecer atendido a
    // un lead a quien nadie le ha escrito todavía — el mismo error que esta tarjeta arregla.
    await cumplirOrphan(CONTACTO);

    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("devuelve cuántos cerró, y 0 cuando no había ninguno", async () => {
    expect(await cumplirOrphan(CONTACTO)).toBe(1);

    timerUpdateMany.mockResolvedValue({ count: 0 });
    expect(await cumplirOrphan(CONTACTO)).toBe(0);
  });

  it("los dos caminos son disjuntos: ningún tipo lo cierran los dos", async () => {
    // El invariante que sostiene el arreglo. Si alguien añadiera "ORPHAN" al filtro de
    // meetSlaTimers, o quitara el `type` de cumplirOrphan, esta prueba lo dice.
    await meetSlaTimers(CONTACTO);
    await cumplirOrphan(CONTACTO);

    const atencion = (whereDe(0).type as { in: string[] }).in;
    const pond = whereDe(1).type;

    expect(atencion).not.toContain(pond);
    expect(pond).toBe("ORPHAN");
  });
});
