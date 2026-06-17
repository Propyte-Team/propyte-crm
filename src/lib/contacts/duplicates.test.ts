import { describe, it, expect } from "vitest";
import { buildDuplicateGroups } from "./duplicates";

const c = (id: string, email: string | null, phone: string | null) => ({ id, email, phone });

describe("buildDuplicateGroups", () => {
  it("agrupa por email compartido (case-insensitive)", () => {
    const groups = buildDuplicateGroups([c("1", "A@x.com", "111"), c("2", "a@x.com", "222")]);
    expect(groups).toEqual([["1", "2"]]);
  });
  it("agrupa por teléfono normalizado compartido (521→+52)", () => {
    const groups = buildDuplicateGroups([c("1", null, "9841234567"), c("2", null, "5219841234567")]);
    expect(groups).toEqual([["1", "2"]]);
  });
  it("transitividad: A~B por email, B~C por phone → un grupo", () => {
    const groups = buildDuplicateGroups([
      c("A", "j@x.com", "9841111111"),
      c("B", "j@x.com", "9842222222"),
      c("C", null, "9842222222"),
    ]);
    expect(groups[0].sort()).toEqual(["A", "B", "C"]);
    expect(groups).toHaveLength(1);
  });
  it("ignora singletons y email/phone vacíos", () => {
    expect(buildDuplicateGroups([c("1", "u@x.com", "111"), c("2", null, null), c("3", "", "")])).toEqual([]);
  });
});
