import { describe, it, expect } from "vitest";
import { buildDuplicateGroups } from "./duplicates";

const c = (
  id: string,
  email: string | null,
  phone: string | null,
  firstName = "X",
  lastName = "Y"
) => ({ id, email, phone, firstName, lastName });

describe("buildDuplicateGroups — coincidencia fuerte (email/phone), retrocompat", () => {
  it("agrupa por email compartido (case-insensitive) con matchType 'strong'", () => {
    const groups = buildDuplicateGroups([c("1", "A@x.com", "111"), c("2", "a@x.com", "222")]);
    expect(groups).toEqual([{ ids: ["1", "2"], matchType: "strong" }]);
  });

  it("agrupa por teléfono normalizado compartido (521→+52) con matchType 'strong'", () => {
    const groups = buildDuplicateGroups([c("1", null, "9841234567"), c("2", null, "5219841234567")]);
    expect(groups).toEqual([{ ids: ["1", "2"], matchType: "strong" }]);
  });

  it("transitividad: A~B por email, B~C por phone → un grupo strong", () => {
    const groups = buildDuplicateGroups([
      c("A", "j@x.com", "9841111111"),
      c("B", "j@x.com", "9842222222"),
      c("C", null, "9842222222"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].matchType).toBe("strong");
    expect(groups[0].ids.sort()).toEqual(["A", "B", "C"]);
  });

  it("ignora singletons y email/phone vacíos (sin nombres coincidentes tampoco)", () => {
    expect(
      buildDuplicateGroups([
        c("1", "u@x.com", "111", "Uno", "Apellido"),
        c("2", null, null, "Dos", "Otro"),
        c("3", "", "", "Tres", "Distinto"),
      ])
    ).toEqual([]);
  });
});

describe("buildDuplicateGroups — coincidencia débil por nombre (Caso 3)", () => {
  it("agrupa por nombre normalizado exacto (acentos/mayúsculas/espacios) sin email/phone compartido", () => {
    const groups = buildDuplicateGroups([
      c("1", "a@x.com", "111", "José", "Pérez"),
      c("2", "b@y.com", "222", "jose  ", "PÉREZ"),
    ]);
    expect(groups).toEqual([{ ids: ["1", "2"], matchType: "name" }]);
  });

  it("grupo puramente por nombre con 3+ contactos", () => {
    const groups = buildDuplicateGroups([
      c("1", "a@x.com", "111", "Carlos", "Ruiz"),
      c("2", "b@y.com", "222", "Carlos", "Ruiz"),
      c("3", "c@z.com", "333", "carlos", "ruiz"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].matchType).toBe("name");
    expect(groups[0].ids.sort()).toEqual(["1", "2", "3"]);
  });

  it("nombres distintos → no se agrupan por nombre", () => {
    const groups = buildDuplicateGroups([
      c("1", "a@x.com", "111", "Carlos", "Ruiz"),
      c("2", "b@y.com", "222", "Ana", "López"),
    ]);
    expect(groups).toEqual([]);
  });

  it("excluye contactos cuyo nombre completo contiene 'por identificar' (placeholder DM-born)", () => {
    const groups = buildDuplicateGroups([
      c("1", null, "", "Juan", "(por identificar)"),
      c("2", null, "", "Juan", "(por identificar)"),
    ]);
    expect(groups).toEqual([]);
  });

  it("excluye contactos cuyo firstName es exactamente instagram/messenger/whatsapp", () => {
    const groups = buildDuplicateGroups([
      c("1", null, "", "Instagram", "Genérico"),
      c("2", null, "", "instagram", "Genérico"),
      c("3", null, "", "Messenger", "Genérico"),
      c("4", null, "", "messenger", "Genérico"),
      c("5", null, "", "WhatsApp", "Genérico"),
      c("6", null, "", "whatsapp", "Genérico"),
    ]);
    expect(groups).toEqual([]);
  });

  it("strong gana: si el grupo mezcla coincidencia fuerte y débil, el matchType final es 'strong'", () => {
    // A~B por teléfono (strong); B~C solo por nombre (weak) → unión A,B,C con matchType strong.
    const groups = buildDuplicateGroups([
      c("A", "a@x.com", "9841111111", "Diferente", "Nombre"),
      c("B", "b@y.com", "9841111111", "Carlos", "Ruiz"),
      c("C", "c@z.com", "9843333333", "Carlos", "Ruiz"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].matchType).toBe("strong");
    expect(groups[0].ids.sort()).toEqual(["A", "B", "C"]);
  });

  it("no mezcla dos grupos de nombre distintos que no comparten ningún criterio", () => {
    const groups = buildDuplicateGroups([
      c("1", "a@x.com", "111", "Carlos", "Ruiz"),
      c("2", "b@y.com", "222", "Carlos", "Ruiz"),
      c("3", "c@z.com", "333", "María", "Gómez"),
      c("4", "d@w.com", "444", "María", "Gómez"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.matchType === "name")).toBe(true);
  });
});
