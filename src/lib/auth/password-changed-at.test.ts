import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Tarjeta #699, defecto 1. `passwordChangedAt` existe en el esquema y estaba NULA en el
// 100% de las cuentas, porque ninguna de las vías que cambian la contraseña la escribía.
// Se pagó al cerrar la #650 —contraseña de una cuenta ADMIN expuesta desde mayo—: hubo que
// dar la rotación por buena con `updatedAt` y la palabra del operador, en vez de con el
// campo que existe justamente para eso.
//
// ESTA PRUEBA NO MIRA COMPORTAMIENTO, MIRA EL CÓDIGO FUENTE, y es deliberado. El riesgo
// real no es que las tres vías de hoy se rompan: es que mañana aparezca una CUARTA que
// escriba el hash y se olvide de la fecha. Un campo que se llena en tres de cuatro vías es
// peor que uno vacío, porque un nulo ya no significa «nunca cambió» sino «quién sabe».
// Una prueba de comportamiento sobre las tres vías actuales no atraparía a la cuarta;
// esta sí.

const RAIZ = join(process.cwd(), "src");

/**
 * Escribir el hash, no leerlo. `passwordHash` como PROPIEDAD de un objeto —`passwordHash,`
 * o `passwordHash: …`— es una escritura; `user.passwordHash`, `compare(…, user.passwordHash)`
 * y la cadena "passwordHash" de un registro de auditoría, no.
 */
const ESCRIBE_HASH = /(?<![.\w"'])passwordHash\s*[,:]/;
/** `select: { passwordHash: true }` es una LECTURA aunque use dos puntos. */
const ES_SELECT = /passwordHash:\s*true/;

function archivosTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) archivosTs(ruta, acc);
    else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) acc.push(ruta);
  }
  return acc;
}

/** Ficheros de `src/` que ESCRIBEN el hash de contraseña. */
function archivosQueEscribenElHash(): string[] {
  return archivosTs(RAIZ).filter((ruta) => {
    const lineas = readFileSync(ruta, "utf8").split("\n");
    return lineas.some((l) => ESCRIBE_HASH.test(l) && !ES_SELECT.test(l));
  });
}

function rel(ruta: string) {
  return ruta.slice(process.cwd().length + 1).replace(/\\/g, "/");
}

describe("passwordChangedAt se escribe SIEMPRE junto al hash (#699)", () => {
  it("toda vía de src/ que escribe passwordHash escribe también passwordChangedAt", () => {
    const sinFecha = archivosQueEscribenElHash().filter(
      (ruta) => !readFileSync(ruta, "utf8").includes("passwordChangedAt"),
    );

    expect(
      sinFecha.map(rel),
      "Estos archivos cambian la contraseña sin dejar constancia de CUÁNDO. " +
        "Añade `passwordChangedAt: new Date()` en la misma escritura que `passwordHash`. " +
        "Si de verdad hay un caso que no debe anotarla, dilo en un comentario y añádelo " +
        "aquí a propósito — no borres la prueba.",
    ).toEqual([]);
  });

  it("la prueba SIRVE: reconoce las tres vías que existen hoy", () => {
    // Si un refactor mueve estas vías de sitio, esto falla y avisa de que el rastreo de
    // arriba dejó de mirar donde debe — en vez de pasar en verde sobre una lista vacía.
    const rutas = archivosQueEscribenElHash().map(rel).sort();

    expect(rutas).toEqual([
      "src/app/api/auth/reset-password/route.ts", // el usuario se la cambia con su código
      "src/server/admin.ts", // alta con contraseña inicial + reseteo por un administrador
    ]);
  });

  it("no confunde LEER el hash con escribirlo", () => {
    // `lib/auth/options.ts` compara el hash al iniciar sesión y no debe exigir la fecha.
    // Sin esta prueba, un rastreo demasiado goloso obligaría a «arreglar» un archivo que
    // no tiene nada que arreglar.
    expect(archivosQueEscribenElHash().map(rel)).not.toContain("src/lib/auth/options.ts");
  });
});

describe("el rastreo distingue escritura de lectura (#699)", () => {
  const casos: Array<[string, boolean]> = [
    ["      passwordHash,", true],
    ["    data: { passwordHash, passwordChangedAt: new Date() },", true],
    ["        passwordHash: await hash(pw, 12),", true],
    ["  const passwordHash = await hash(validated.password, 12);", false],
    ["    const passwordValid = await compare(credentials.password, user.passwordHash);", false],
    ["          if (!user.passwordHash) {", false],
    ["      select: { id: true, passwordHash: true },", false],
    ['      changes: { field: "passwordHash", reset: true },', false],
  ];

  for (const [linea, esEscritura] of casos) {
    it(`${esEscritura ? "escritura" : "lectura  "}: ${linea.trim().slice(0, 52)}`, () => {
      expect(ESCRIBE_HASH.test(linea) && !ES_SELECT.test(linea)).toBe(esEscritura);
    });
  }
});
