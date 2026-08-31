import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rechazoCron, veredictoCron } from "./auth";

/**
 * #665 — el secreto de los crons se podía mandar en la URL (`?key=<secreto>`).
 *
 * Un secreto en la URL queda copiado en el log de accesos del servidor, en el del proxy y en
 * cualquier cosa que guarde direcciones visitadas. El tick corre CADA MINUTO: 1.440 copias al
 * día. Mientras esa vía siguiera abierta, rotar el secreto —que es lo que pide #328 desde
 * mayo— solo reiniciaba el reloj.
 *
 * Medido antes de cerrarla (crontab de root del VPS, 2026-08-31): los cuatro crons del CRM
 * mandan el secreto en la cabecera. Ninguno usaba `?key=`, así que cerrarla no deja fuera a
 * ningún llamador vivo.
 */

const SECRETO = "secreto_largo_de_prueba_0123456789";

function pedir(opts: { cabecera?: string; key?: string; path?: string } = {}) {
  const url = new URL(`http://t${opts.path ?? "/api/cron/workflows"}`);
  if (opts.key !== undefined) url.searchParams.set("key", opts.key);
  return {
    headers: { get: (h: string) => (h === "x-cron-secret" ? opts.cabecera ?? null : null) },
    nextUrl: url,
  } as never;
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRETO;
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("veredictoCron", () => {
  it("la cabecera correcta pasa", () => {
    expect(veredictoCron(pedir({ cabecera: SECRETO }))).toBe("ok");
  });

  // 🚨 El corazón de la tarjeta: aunque el valor sea EL BUENO, por la URL no entra.
  it("el secreto correcto por query string NO autoriza", () => {
    expect(veredictoCron(pedir({ key: SECRETO }))).toBe("por_query_string");
  });

  it("un `key` cualquiera tampoco, y se distingue del 401 genérico", () => {
    expect(veredictoCron(pedir({ key: "loquesea" }))).toBe("por_query_string");
    expect(veredictoCron(pedir({}))).toBe("invalido");
    expect(veredictoCron(pedir({ cabecera: "otro" }))).toBe("invalido");
  });

  // Sin la variable no se autoriza a nadie: un secreto vacío no puede coincidir con nada.
  it("sin CRON_SECRET configurado no entra ni la cabecera vacía", () => {
    delete process.env.CRON_SECRET;
    expect(veredictoCron(pedir({ cabecera: "" }))).toBe("sin_configurar");
    expect(veredictoCron(pedir({ cabecera: SECRETO }))).toBe("sin_configurar");
  });

  // La comparación es en tiempo constante y por eso exige longitud exacta: un prefijo bueno
  // no debe acercarse más que un valor cualquiera.
  it("un prefijo del secreto no pasa", () => {
    expect(veredictoCron(pedir({ cabecera: SECRETO.slice(0, -1) }))).toBe("invalido");
  });
});

describe("rechazoCron", () => {
  it("autorizado devuelve null: el route sigue", () => {
    expect(rechazoCron(pedir({ cabecera: SECRETO }))).toBeNull();
  });

  it("por query string responde 401 diciendo QUÉ pasó", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = rechazoCron(pedir({ key: SECRETO }))!;
    const body = await r.json();

    expect(r.status).toBe(401);
    expect(body.detalle).toMatch(/cabecera/);
    expect(body.detalle).toMatch(/logs de acceso/);
    warn.mockRestore();
  });

  /**
   * El aviso NO puede llevar el valor: el punto entero de la tarjeta es que el secreto deje
   * de aparecer en registros. Un log de rechazo que lo imprima reintroduce la fuga por la
   * puerta de atrás.
   */
  it("ni el aviso ni la respuesta repiten el secreto", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = rechazoCron(pedir({ key: SECRETO }))!;
    const body = JSON.stringify(await r.json());

    expect(body).not.toContain(SECRETO);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRETO);
    warn.mockRestore();
  });

  it("sin credencial responde el 401 genérico, sin detalle", async () => {
    const r = rechazoCron(pedir({}))!;
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
  });
});

/**
 * El guardia del guardia. Las cuatro rutas de cron llevaban su propia copia del chequeo, y
 * por eso TRES se quedaron con el `?key=` cuando alguien penso que lo estaba quitando de
 * una. Esto falla si aparece una quinta ruta que se lo vuelva a escribir a mano.
 */
describe("ninguna ruta de cron se escribe su propio guardia", () => {
  const rutas = [
    "src/app/api/cron/connectors/linkedin/route.ts",
    "src/app/api/cron/connectors/tiktok/route.ts",
    "src/app/api/cron/google/gmail-sync/route.ts",
    "src/app/api/cron/workflows/route.ts",
  ];

  it.each(rutas)("%s usa la guardia compartida", async (ruta) => {
    const { readFileSync } = await import("fs");
    const fuente = readFileSync(ruta, "utf8");
    expect(fuente).toContain("@/lib/cron/auth");
  });

  /** El literal exacto que había en las cuatro rutas. Sin regex: los paréntesis de
   *  `get("key")` convierten un `toMatch` descuidado en un aserto que no comprueba nada. */
  const LECTURA_DE_URL = 'searchParams.get("key")';

  it.each(rutas)("%s no lee el secreto de la URL", async (ruta) => {
    const { readFileSync } = await import("fs");
    const fuente = readFileSync(ruta, "utf8");
    expect(fuente).not.toContain(LECTURA_DE_URL);
    expect(fuente).not.toContain("process.env.CRON_SECRET");
  });

  /**
   * Validar el medidor antes de confiar en él: si el literal que buscamos no fuera el que
   * de verdad aparecía en el código, los cuatro asertos de arriba pasarían sin comprobar
   * nada. Este caso confirma que el patrón SÍ detecta la forma que se quitó.
   */
  it("el patrón buscado detecta la forma que tenían las rutas", () => {
    const comoEstaba = 'const query = req.nextUrl.searchParams.get("key")?.trim();';
    expect(comoEstaba).toContain(LECTURA_DE_URL);
  });
});
