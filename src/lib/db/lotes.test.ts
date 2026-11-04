import { describe, it, expect } from "vitest";
import { enLotes } from "./lotes";

describe("enLotes", () => {
  it("conserva orden y tipos de los resultados", async () => {
    const [a, b, c] = await enLotes([
      async () => 1,
      async () => "dos",
      async () => ({ tres: 3 }),
    ], 2);
    expect(a).toBe(1);
    expect(b).toBe("dos");
    expect(c.tres).toBe(3);
  });

  it("nunca corre más tareas a la vez que el tamaño del lote", async () => {
    let activas = 0;
    let maximo = 0;
    const tarea = (n: number) => async () => {
      activas++;
      maximo = Math.max(maximo, activas);
      await new Promise((r) => setTimeout(r, 5));
      activas--;
      return n;
    };
    const res = await enLotes(Array.from({ length: 10 }, (_, i) => tarea(i)), 4);
    expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(maximo).toBe(4);
  });

  it("propaga el error de una tarea", async () => {
    await expect(enLotes([async () => 1, async () => { throw new Error("boom"); }], 2)).rejects.toThrow("boom");
  });
});
