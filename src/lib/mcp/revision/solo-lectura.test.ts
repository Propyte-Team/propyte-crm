import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El guardia de §4.2 del spec: esta puerta SOLO LEE, y la garantía es una prueba, no una
 * promesa en un comentario.
 *
 * El tipo `RevisionDb` ya impide escribir —no expone `create` ni `update`, así que un
 * handler que lo intente no compila—, pero un `as any`, un `$executeRaw` o un `fetch` con
 * POST se saltarían el tipo sin que nada avise. Esto cierra esa puerta.
 *
 * Importa porque el consumidor es un agente que corre solo, todos los días, sin que nadie
 * revise cada llamada.
 */

const DIR = join(__dirname);

const ESCRITURAS_PRISMA =
  /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/;
const RAW_PRISMA = /\$(executeRaw|queryRaw|executeRawUnsafe|queryRawUnsafe|transaction)/;
const FETCH_QUE_ESCRIBE = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/;

/** Archivos de prueba y sus utilerías no viajan al servidor. */
function esCodigoDeProduccion(nombre: string): boolean {
  return nombre.endsWith(".ts") && !nombre.endsWith(".test.ts") && !nombre.endsWith(".testutil.ts");
}

function archivosDeProduccion(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) out.push(...archivosDeProduccion(ruta));
    else if (esCodigoDeProduccion(entrada)) out.push(ruta);
  }
  return out;
}

describe("la puerta de revisión solo lee", () => {
  const archivos = archivosDeProduccion(DIR);

  it("encuentra el código que va a revisar", () => {
    // Sin esta comprobación, un cambio de rutas dejaría la lista vacía y las pruebas de
    // abajo pasarían sin mirar nada. Un guardia que no mide nada es peor que ninguno.
    expect(archivos.length).toBeGreaterThan(8);
  });

  it.each(archivosDeProduccion(DIR).map((f) => [f.slice(DIR.length + 1), f] as const))(
    "%s no escribe por Prisma",
    (_rel, ruta) => {
      const src = readFileSync(ruta, "utf8");
      const lineas = src.split("\n");
      const culpables = lineas
        .map((l, i) => ({ n: i + 1, l }))
        // Los comentarios nombran los métodos prohibidos a propósito, para explicar por
        // qué no están. No son código.
        .filter(({ l }) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
        .filter(({ l }) => ESCRITURAS_PRISMA.test(l) || RAW_PRISMA.test(l));

      expect(culpables.map((c) => `${c.n}: ${c.l.trim()}`)).toEqual([]);
    },
  );

  it.each(archivosDeProduccion(DIR).map((f) => [f.slice(DIR.length + 1), f] as const))(
    "%s no hace peticiones que escriban",
    (_rel, ruta) => {
      const src = readFileSync(ruta, "utf8");
      expect(FETCH_QUE_ESCRIBE.test(src), `${_rel} manda un verbo que escribe`).toBe(false);
    },
  );

  it("el tipo de base de datos no expone ni un modelo de escritura", () => {
    const tipos = readFileSync(join(DIR, "types.ts"), "utf8");
    const bloque = tipos.slice(tipos.indexOf("RevisionDb"));
    for (const prohibido of ["create", "update", "upsert", "delete"]) {
      expect(bloque.slice(0, bloque.indexOf(">;")).includes(`"${prohibido}`)).toBe(false);
    }
  });
});
