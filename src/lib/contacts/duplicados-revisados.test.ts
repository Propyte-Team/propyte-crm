import { describe, it, expect } from "vitest";
import { idsDeFirma, leerRevisados, quitarRevisado, recientes } from "./duplicados-revisados";

describe("duplicados-revisados", () => {
  it("quita la firma y avisa si estaba", () => {
    expect(quitarRevisado(["a|b", "c|d"], "a|b")).toEqual({ lista: ["c|d"], estaba: true });
    expect(quitarRevisado(["a|b"], "x|y")).toEqual({ lista: ["a|b"], estaba: false });
  });
  it("lee tolerante y separa ids", () => {
    expect(leerRevisados(null)).toEqual([]);
    expect(leerRevisados(["a|b", 3, null])).toEqual(["a|b"]);
    expect(idsDeFirma("a|b|c")).toEqual(["a", "b", "c"]);
  });
  it("recientes: últimas primero", () => {
    expect(recientes(["1", "2", "3"], 2)).toEqual(["3", "2"]);
  });
});
