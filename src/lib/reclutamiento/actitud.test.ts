import { describe, it, expect, vi, beforeEach } from "vitest";

const askClaude = vi.fn();
vi.mock("@/lib/bot/claude", () => ({ askClaude: (...a: unknown[]) => askClaude(...a) }));

import { evaluarActitud, parsearActitud } from "./actitud";

beforeEach(() => askClaude.mockReset());

describe("parsearActitud", () => {
  it("acepta JSON limpio y con fences", () => {
    expect(parsearActitud('{"ejes":{"motivacion":4,"rechazo":3,"ambicion":5,"claridad":4},"razones":["clara"]}'))
      .toEqual({ puntos: 16, razones: ["clara"] });
    expect(parsearActitud('```json\n{"ejes":{"motivacion":1,"rechazo":1,"ambicion":1,"claridad":1},"razones":[]}\n```'))
      .toEqual({ puntos: 4, razones: [] });
  });
  it("recorta ejes fuera de 0-5 y rechaza basura", () => {
    expect(parsearActitud('{"ejes":{"motivacion":9,"rechazo":-2,"ambicion":5,"claridad":5},"razones":[]}')).toEqual({ puntos: 15, razones: [] });
    expect(parsearActitud("no es json")).toBeNull();
    expect(parsearActitud('{"ejes":{}}')).toBeNull();
  });
});

describe("evaluarActitud", () => {
  const respuestas = { actitud_1: "Me gusta vender", actitud_2: "Insistí con otra propuesta", actitud_3: "Cerrar 6 ventas" };
  it("llama a Claude con las tres respuestas y devuelve los puntos", async () => {
    askClaude.mockResolvedValue('{"ejes":{"motivacion":3,"rechazo":4,"ambicion":4,"claridad":3},"razones":["concreto"]}');
    const r = await evaluarActitud(respuestas, "claude-sonnet-5");
    expect(r).toEqual({ puntos: 14, razones: ["concreto"] });
    const args = askClaude.mock.calls[0][0] as { messages: { content: string }[]; model: string };
    expect(args.model).toBe("claude-sonnet-5");
    expect(args.messages[0].content).toContain("Insistí con otra propuesta");
  });
  it("sin respuestas de actitud no llama a Claude y devuelve null", async () => {
    expect(await evaluarActitud({}, "m")).toBeNull();
    expect(askClaude).not.toHaveBeenCalled();
  });
  it("Claude falla o responde basura → null, nunca lanza", async () => {
    askClaude.mockRejectedValueOnce(new Error("timeout"));
    expect(await evaluarActitud(respuestas, "m")).toBeNull();
    askClaude.mockResolvedValueOnce("sin json");
    expect(await evaluarActitud(respuestas, "m")).toBeNull();
  });
});
