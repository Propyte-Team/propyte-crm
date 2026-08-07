import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// El espejo status↔isActive solo se sostiene si nadie más escribe isActive
// sobre User. Esto es un guardrail estructural, no una prueba de comportamiento:
// si falla, revisa el archivo que nombra — puede ser un falso positivo, pero
// nunca debe pasar inadvertido.
const ALLOWED = [join("src", "server", "users-lifecycle.ts")];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

describe("espejo isActive", () => {
  it("solo users-lifecycle.ts escribe isActive sobre User", () => {
    const offenders = walk("src")
      .filter((f) => !ALLOWED.some((a) => f.endsWith(a)))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        // Cada llamada a prisma/tx .user.update|updateMany y los 300 caracteres
        // siguientes: si ahí aparece isActive, ese archivo escribe el espejo.
        return src
          .split(/\b(?:prisma|tx)\.user\.update(?:Many)?\s*\(/)
          .slice(1)
          .some((chunk) => /isActive/.test(chunk.slice(0, 300)));
      });

    expect(offenders).toEqual([]);
  });
});
