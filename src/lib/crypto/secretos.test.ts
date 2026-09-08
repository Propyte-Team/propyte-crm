import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Tarjeta #736 · AUD-20260903 S-09 (ampliado de 3 a 10 sitios en el repaso del 2026-09-08).

import { secretosIguales, secretosIgualesRecortados, buscarPorSecreto } from "./secretos";

describe("secretosIguales (#736)", () => {
  it("iguales sí, distintos no", () => {
    expect(secretosIguales("s3cr3to", "s3cr3to")).toBe(true);
    expect(secretosIguales("s3cr3to", "s3cr3tO")).toBe(false);
  });

  it("distinta longitud no revienta, devuelve false", () => {
    // `timingSafeEqual` lanza si los buffers miden distinto: por eso el helper resuelve la
    // longitud antes. Sin eso, un token de otro largo sería una excepción 500 y no un 401.
    expect(() => secretosIguales("corto", "muchísimo más largo")).not.toThrow();
    expect(secretosIguales("corto", "muchísimo más largo")).toBe(false);
  });

  it("cualquiera de los dos ausente es false, nunca true", () => {
    // Esto es lo que evita el bug clásico: un secreto sin configurar en el servidor y una
    // cabecera ausente en la petición, comparados con `===`, daban `undefined === undefined`.
    expect(secretosIguales(undefined, undefined)).toBe(false);
    expect(secretosIguales(null, null)).toBe(false);
    expect(secretosIguales("", "")).toBe(false);
    expect(secretosIguales("algo", undefined)).toBe(false);
    expect(secretosIguales(undefined, "algo")).toBe(false);
  });

  it("no recorta por su cuenta: para eso está la variante", () => {
    expect(secretosIguales("s3cr3to\n", "s3cr3to")).toBe(false);
    expect(secretosIgualesRecortados("s3cr3to\n", "  s3cr3to  ")).toBe(true);
  });

  it("compara bytes, no caracteres: los acentos y emojis no lo rompen", () => {
    expect(secretosIguales("contraseñá", "contraseñá")).toBe(true);
    expect(secretosIguales("contraseña", "contraseñá")).toBe(false);
  });
});

describe("buscarPorSecreto (#736)", () => {
  const conectores = [
    { id: "a", secreto: "aaa" },
    { id: "b", secreto: "bbb" },
    { id: "c", secreto: null as string | null },
  ];

  it("encuentra el que coincide, esté al principio o al final", () => {
    expect(buscarPorSecreto(conectores, "aaa", (c) => c.secreto)?.id).toBe("a");
    expect(buscarPorSecreto(conectores, "bbb", (c) => c.secreto)?.id).toBe("b");
  });

  it("null si ninguno coincide, o si el secreto recibido está vacío", () => {
    expect(buscarPorSecreto(conectores, "zzz", (c) => c.secreto)).toBeNull();
    expect(buscarPorSecreto(conectores, "", (c) => c.secreto)).toBeNull();
    expect(buscarPorSecreto(conectores, null, (c) => c.secreto)).toBeNull();
  });

  it("un conector sin secreto no coincide con nada", () => {
    expect(buscarPorSecreto(conectores, null as unknown as string, (c) => c.secreto)).toBeNull();
    expect(buscarPorSecreto([conectores[2]], "", (c) => c.secreto)).toBeNull();
  });

  it("recorre TODOS: no se corta en el primer acierto", () => {
    // El corte temprano revelaba cuántos conectores se revisaron antes de acertar, que es
    // una fuga de tiempo igual que la del `===`.
    const vistos: string[] = [];
    buscarPorSecreto(conectores, "aaa", (c) => {
      vistos.push(c.id);
      return c.secreto;
    });

    expect(vistos).toEqual(["a", "b", "c"]);
  });

  it("una lista vacía no revienta", () => {
    expect(buscarPorSecreto([], "aaa", (c: { secreto: string }) => c.secreto)).toBeNull();
  });
});

// ------------------------------------------------------------------
// La red de seguridad: barrer el código en busca del patrón viejo.
// ------------------------------------------------------------------
//
// El riesgo real de esta tarjeta no era arreglar los diez sitios: era **olvidar uno**, o
// que el patrón volviera a entrar en el siguiente webhook que alguien escriba. De ahí esta
// prueba, que lee el árbol de rutas y falla si aparece un `===`/`!==` entre algo que se
// llama secreto/token/llave y otra variable.

const RAIZ = join(process.cwd(), "src", "app", "api");

/** Comparación con === o !== donde ALGÚN lado parece un secreto y NINGUNO es literal. */
const COMPARACION_SOSPECHOSA =
  /([A-Za-z_$][\w$.?\[\]"']*)\s*([=!]==)\s*([A-Za-z_$][\w$.?()\[\]"']*)/g;
const PARECE_SECRETO = /(secret|token|webhookkey|verifykey|apikey|api_key|password|passwd)/i;

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta));
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** Las líneas de código —sin comentarios— que comparan un secreto con ===/!==. */
function comparacionesCrudas(contenido: string): string[] {
  const hallazgos: string[] = [];

  for (const linea of contenido.split("\n")) {
    const codigo = linea.trim();
    if (codigo.startsWith("//") || codigo.startsWith("*") || codigo.startsWith("/*")) continue;

    for (const m of codigo.matchAll(COMPARACION_SOSPECHOSA)) {
      const [, izq, , der] = m;
      if (!PARECE_SECRETO.test(izq) && !PARECE_SECRETO.test(der)) continue;
      hallazgos.push(codigo);
    }
  }

  return hallazgos;
}

describe("ningún secreto se compara con === en las rutas (#736)", () => {
  it("el barrido del árbol de rutas sale limpio", () => {
    const sucios: string[] = [];

    for (const ruta of archivosTs(RAIZ)) {
      const hallazgos = comparacionesCrudas(readFileSync(ruta, "utf8"));
      for (const linea of hallazgos) {
        sucios.push(`${ruta.replace(process.cwd() + "/", "")}: ${linea}`);
      }
    }

    expect(
      sucios,
      "Compara secretos con secretosIguales de @/lib/crypto/secretos, no con ===:\n" +
        sucios.join("\n")
    ).toEqual([]);
  });

  it("el barrido de verdad detecta el patrón (si no, no prueba nada)", () => {
    // Un barrido que nunca encuentra nada pasaría igual estando roto. Esto lo verifica.
    expect(comparacionesCrudas('if (secret !== expected) return null;')).toHaveLength(1);
    expect(comparacionesCrudas('if (creds.webhookSecret === provided) return c;')).toHaveLength(1);
    expect(comparacionesCrudas('const ok = token === process.env.CRON_SECRET;')).toHaveLength(1);

    // Y NO se queja de lo que no es una comparación de secretos.
    expect(comparacionesCrudas('if (connector.provider === "GOOGLE_ADS") return;')).toEqual([]);
    expect(comparacionesCrudas('if (mode !== "subscribe") return;')).toEqual([]);
    expect(comparacionesCrudas('// if (secret !== expected) — así estaba antes')).toEqual([]);
  });
});
