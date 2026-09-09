import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Tarjeta #716. Las páginas que ve el cliente no tenían frontera de error: un parpadeo de
// la base —el pooler de Supabase se reinicia con cierta frecuencia en este proyecto— le
// dejaba delante la pantalla blanca de Next, en inglés y con la traza.
//
// Esto se comprueba sobre los archivos porque es lo que Next resuelve por convención de
// carpetas: no hay función que importar. Una prueba de estructura es exactamente lo que
// detecta que alguien agregue una ruta pública nueva y se le olvide su error.tsx.

const APP = join(process.cwd(), "src", "app");

/** Segmentos de cara al cliente: sin sesión de asesor detrás. */
const RUTAS_PUBLICAS = [
  { dir: "q", que: "la cotización pública" },
  { dir: "p", que: "la propuesta de unidades" },
  { dir: "t", que: "la ficha pública del asesor" },
  { dir: "portal", que: "el portal de desarrolladores" },
];

describe("fronteras de error en las rutas públicas (#716)", () => {
  for (const { dir, que } of RUTAS_PUBLICAS) {
    it(`${que} tiene su error.tsx`, () => {
      expect(existsSync(join(APP, dir, "error.tsx"))).toBe(true);
    });

    it(`el error.tsx de ${que} es un componente de cliente con export por defecto`, () => {
      const fuente = readFileSync(join(APP, dir, "error.tsx"), "utf-8");
      // Next exige las dos cosas: sin "use client" el archivo no compila como boundary,
      // y sin export default no lo encuentra.
      expect(fuente.trimStart().startsWith('"use client"')).toBe(true);
      expect(fuente).toMatch(/export default function/);
    });
  }

  it("no queda ninguna ruta pública nueva sin frontera", () => {
    // Si alguien agrega src/app/<algo> de cara al cliente, esta lista se queda corta y la
    // prueba de arriba no lo cubre. Al menos que salte aquí para que se decida a mano.
    const reservados = new Set([
      "api", "login", "layout.tsx", "page.tsx", "globals.css", "favicon.ico",
      "global-error.tsx", "not-found.tsx", "error.tsx", "rutas-publicas.error.test.ts",
    ]);
    const segmentos = readdirSync(APP, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("(") && !reservados.has(e.name))
      .map((e) => e.name);

    expect(segmentos.sort()).toEqual(RUTAS_PUBLICAS.map((r) => r.dir).sort());
  });
});

describe("las páginas públicas no confunden 'falló la base' con 'no existe' (#716)", () => {
  const casos = [
    { archivo: join(APP, "q", "[id]", "page.tsx"), busqueda: "prisma.quote.findFirst" },
    { archivo: join(APP, "p", "[token]", "page.tsx"), busqueda: "getShortlistByToken(params.token)" },
  ];

  for (const { archivo, busqueda } of casos) {
    it(`${busqueda} no se traga el error`, () => {
      const fuente = readFileSync(archivo, "utf-8");
      const linea = fuente
        .split("\n")
        .find((l) => l.includes(busqueda) && !l.trimStart().startsWith("//"));

      expect(linea, `no se encontró la búsqueda ${busqueda}`).toBeDefined();
      // Un `.catch(() => null)` aquí convierte un fallo de la base en un 404: le dice al
      // cliente que su enlace no existe cuando sí existe. El tracking de apertura SÍ
      // puede seguir silenciado, y por eso la comprobación es por línea y no por archivo.
      expect(linea).not.toContain("catch");
    });
  }

  it("el tracking de apertura sigue silenciado: que falle no debe tapar la página", () => {
    const quote = readFileSync(join(APP, "q", "[id]", "page.tsx"), "utf-8");
    const shortlist = readFileSync(join(APP, "p", "[token]", "page.tsx"), "utf-8");

    expect(quote).toContain("catch(() => null)");
    expect(shortlist).toContain("recordView");
    expect(shortlist).toMatch(/recordView\([^)]*\)\.catch/);
  });
});
