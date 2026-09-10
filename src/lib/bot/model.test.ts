import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveBotModel, DEFAULT_BOT_MODEL, ALLOWED_MODELS } from "./model";

// Auditoría 2026-09-10: `lib/agents/runner.ts` resolvía el modelo con
// `process.env.BOT_MODEL ?? "claude-sonnet-4-6"`. Los tres casos que rompían eso —cadena
// vacía, salto de línea pegado, y valor fuera del allowlist— son los tres primeros
// bloques de aquí abajo.

const ORIGINAL = process.env.BOT_MODEL;

beforeEach(() => {
  delete process.env.BOT_MODEL;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BOT_MODEL;
  else process.env.BOT_MODEL = ORIGINAL;
  vi.restoreAllMocks();
});

describe("resolveBotModel", () => {
  it("BOT_MODEL vacía cae al default — `??` la dejaba pasar como modelo en blanco", () => {
    process.env.BOT_MODEL = "";
    expect(resolveBotModel()).toBe(DEFAULT_BOT_MODEL);
  });

  it("sólo espacios o un salto de línea también caen al default", () => {
    process.env.BOT_MODEL = "  \n ";
    expect(resolveBotModel()).toBe(DEFAULT_BOT_MODEL);
  });

  it("recorta el salto de línea pegado en vez de pedir un modelo inexistente", () => {
    process.env.BOT_MODEL = "claude-haiku-4-5\n";
    expect(resolveBotModel()).toBe("claude-haiku-4-5");
  });

  it("un modelo fuera del allowlist se descarta con aviso y NO se manda a la API", () => {
    process.env.BOT_MODEL = "gpt-4";
    expect(resolveBotModel()).toBe(DEFAULT_BOT_MODEL);
    expect(console.warn).toHaveBeenCalled();
  });

  it("sin nada configurado, el default es la generación vigente", () => {
    expect(resolveBotModel()).toBe("claude-sonnet-5");
  });

  it("el argumento de quien llama gana sobre la variable de entorno", () => {
    process.env.BOT_MODEL = "claude-sonnet-5";
    expect(resolveBotModel("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  it("un argumento inválido no tumba la llamada: cae a BOT_MODEL, que sí vale", () => {
    process.env.BOT_MODEL = "claude-haiku-4-5";
    expect(resolveBotModel("modelo-que-no-existe")).toBe("claude-haiku-4-5");
  });

  it("acepta los tres modelos del allowlist tal cual", () => {
    for (const m of ALLOWED_MODELS) expect(resolveBotModel(m)).toBe(m);
  });
});
