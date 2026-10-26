import { describe, it, expect } from "vitest";
import {
  nombreDeContacto,
  rbacPermiteContacto,
  separarReferidos,
  validarReferidoPor,
  tituloRegistros,
} from "./referidos";

describe("rbacPermiteContacto (#907: la regla que getContact y getContactAccessInfo copiaban)", () => {
  it("sin restricción de dueño (acceso total, o plaza vía OR): permite todo", () => {
    expect(rbacPermiteContacto("cualquiera", {})).toBe(true);
    expect(rbacPermiteContacto(null, {})).toBe(true);
    expect(rbacPermiteContacto("x", { OR: [{ assignedToId: { in: ["a"] } }, { assignedToId: null }] })).toBe(true);
  });

  it("alcance propio: solo los míos (un contacto sin dueño NO es mío)", () => {
    expect(rbacPermiteContacto("yo", { assignedToId: "yo" })).toBe(true);
    expect(rbacPermiteContacto("otro", { assignedToId: "yo" })).toBe(false);
    expect(rbacPermiteContacto(null, { assignedToId: "yo" })).toBe(false);
  });

  it("alcance de equipo: los del equipo y los sin dueño", () => {
    const equipo = { assignedToId: { in: ["tl", "a1"] } };
    expect(rbacPermiteContacto("a1", equipo)).toBe(true);
    expect(rbacPermiteContacto(null, equipo)).toBe(true);
    expect(rbacPermiteContacto("fuera", equipo)).toBe(false);
  });
});

describe("separarReferidos", () => {
  it("separa los que se pueden abrir y cuenta los demás, sin reordenar", () => {
    const r = separarReferidos([1, 2, 3, 4], (n) => n % 2 === 0);
    expect(r).toEqual({ visibles: [2, 4], ocultos: 2 });
  });
});

describe("validarReferidoPor", () => {
  const broker = { id: "b", contactType: "BROKER_EXTERNO" };

  it("broker válido → null", () => {
    expect(validarReferidoPor({ contactId: "c", referredById: "b", broker })).toBeNull();
    expect(validarReferidoPor({ contactId: null, referredById: "b", broker })).toBeNull();
  });

  it("el mismo contacto → mismo_contacto (gana sobre cualquier otro motivo)", () => {
    expect(validarReferidoPor({ contactId: "b", referredById: "b", broker })).toBe("mismo_contacto");
    expect(validarReferidoPor({ contactId: "b", referredById: "b", broker: null })).toBe("mismo_contacto");
  });

  it("no encontrado → no_existe; de otro tipo o sin tipo → no_es_broker", () => {
    expect(validarReferidoPor({ contactId: "c", referredById: "b", broker: null })).toBe("no_existe");
    expect(
      validarReferidoPor({ contactId: "c", referredById: "b", broker: { id: "b", contactType: "REFERIDOR" } }),
    ).toBe("no_es_broker");
    expect(
      validarReferidoPor({ contactId: "c", referredById: "b", broker: { id: "b", contactType: null } }),
    ).toBe("no_es_broker");
  });
});

describe("nombreDeContacto", () => {
  it("une nombre y apellido; sin ninguno dice «Sin nombre»", () => {
    expect(nombreDeContacto({ firstName: "Ana", lastName: "López" })).toBe("Ana López");
    expect(nombreDeContacto({ firstName: "Ana", lastName: null })).toBe("Ana");
    expect(nombreDeContacto({})).toBe("Sin nombre");
  });
});

describe("tituloRegistros (#929: antes «Referidos (N)»)", () => {
  it("singular con 1, plural con 0 o varios", () => {
    expect(tituloRegistros(1)).toBe("Registro de Broker (1)");
    expect(tituloRegistros(0)).toBe("Registros de Broker (0)");
    expect(tituloRegistros(3)).toBe("Registros de Broker (3)");
  });
});
