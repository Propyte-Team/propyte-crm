import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const userFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    auditLog: { create: () => Promise.resolve(null) },
  },
}));

const handler = vi.fn();
const resolveRoute = vi.fn();
vi.mock("@/lib/mcp/dispatch", () => ({ resolveRoute: (...a: unknown[]) => resolveRoute(...a) }));

import { GET, POST, PATCH, PUT } from "./route";

const ESCRITURA = "tok_escritura_0123456789";
const LECTURA = "tok_lectura_9876543210aa";

/**
 * El route solo toca `method`, `headers.get`, `json()` y `nextUrl.searchParams`. Un objeto
 * con esa forma alcanza y evita levantar Next entero para probar una guardia de permisos.
 */
function pedir(method: string, token: string | null, path = "automation/rules") {
  return {
    method,
    headers: { get: (h: string) => (h === "authorization" && token ? `Bearer ${token}` : null) },
    json: async () => ({}),
    nextUrl: new URL(`http://t/api/mcp/${path}`),
  } as never;
}

const params = { params: { path: ["automation", "rules"] } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRM_MCP_API_TOKEN = ESCRITURA;
  process.env.CRM_MCP_READONLY_TOKEN = LECTURA;
  userFindUnique.mockResolvedValue({ id: "u-mcp" });
  handler.mockResolvedValue({ ok: true });
  resolveRoute.mockReturnValue({ handler: (...a: unknown[]) => handler(...a), params: {} });
});

afterEach(() => {
  delete process.env.CRM_MCP_API_TOKEN;
  delete process.env.CRM_MCP_READONLY_TOKEN;
});

/**
 * #59 — hasta ahora existía UN solo token y autorizaba lo mismo leer que crear reglas de
 * automatización, conectores y campos. Cualquier sistema que solo quisiera consultar tenía
 * que portar la llave que también escribe.
 */
describe("pasarela MCP — token de solo lectura", () => {
  it("el token de lectura recibe 403 en POST /automation/rules", async () => {
    const r = await POST(pedir("POST", LECTURA), params);

    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/solo lectura/);
    // Lo que de verdad importa: el handler de escritura NO llegó a correr.
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["PATCH", "PUT"] as const)("y también en %s", async (metodo) => {
    const fn = metodo === "PATCH" ? PATCH : PUT;
    const r = await fn(pedir(metodo, LECTURA), params);

    expect(r.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("el token de lectura SÍ puede leer", async () => {
    const r = await GET(pedir("GET", LECTURA), params);

    expect(r.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  // Control de no-regresión: la credencial de siempre no pierde nada.
  it("el token de escritura sigue pudiendo escribir y leer", async () => {
    expect((await POST(pedir("POST", ESCRITURA), params)).status).toBe(201);
    expect((await GET(pedir("GET", ESCRITURA), params)).status).toBe(200);
  });

  /**
   * 403 y no 401: la credencial es válida, lo que falta es el permiso. Un 401 mandaría a
   * quien llama a rotar un token que está perfectamente bien.
   */
  it("un token desconocido es 401, no 403 — son diagnósticos distintos", async () => {
    expect((await POST(pedir("POST", "tok_inventado"), params)).status).toBe(401);
    expect((await POST(pedir("POST", null), params)).status).toBe(401);
  });

  it("sin CRM_MCP_READONLY_TOKEN configurado, nada cambia", async () => {
    delete process.env.CRM_MCP_READONLY_TOKEN;

    expect((await POST(pedir("POST", ESCRITURA), params)).status).toBe(201);
    // Y el que era token de lectura pasa a ser un desconocido cualquiera.
    expect((await GET(pedir("GET", LECTURA), params)).status).toBe(401);
  });

  /**
   * 🚨 El despliegue mal hecho: las dos variables con el mismo valor. Se ignora el de
   * lectura a propósito — conceder escritura bajo un nombre que dice «readonly» es peor
   * que no tener la variable, porque leer el `.env` sugeriría una separación que no existe.
   */
  it("si los dos tokens son iguales, el de lectura se ignora", async () => {
    process.env.CRM_MCP_READONLY_TOKEN = ESCRITURA;

    // Sigue siendo el token de escritura: escribe. Lo que NO pasa es que se degrade a 403.
    expect((await POST(pedir("POST", ESCRITURA), params)).status).toBe(201);
  });
});
