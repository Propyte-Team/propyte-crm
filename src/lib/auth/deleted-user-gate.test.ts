import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Ninguno de estos cuatro gates revisaba deletedAt. Daba igual mientras nada
// escribiera esa columna; ahora softDeleteUser la escribe, así que un usuario
// eliminado cuyo isActive quedara en true podría entrar. Defensa en
// profundidad: no se confía en que el escritor haga su parte.
const GATES = [
  "src/lib/auth/options.ts",
  "src/app/api/auth/forgot-password/route.ts",
  "src/app/api/auth/request-code/route.ts",
  "src/app/api/auth/reset-password/route.ts",
];

describe("gates de autenticación", () => {
  it.each(GATES)("%s selecciona deletedAt y lo rechaza", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toMatch(/deletedAt:\s*true/);
    expect(src).toMatch(/\.deletedAt/);
  });
});
