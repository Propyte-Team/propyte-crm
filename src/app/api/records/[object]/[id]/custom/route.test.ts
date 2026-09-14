import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #741. La mezcla de los campos personalizados se hacía en memoria:
// leer el `custom` fuera de toda transacción → `{ ...viejo, ...nuevo }` en JavaScript →
// escribir el objeto ENTERO. Dos personas editando campos distintos del mismo contacto
// perdían una de las dos ediciones, sin aviso y con `ok: true` para las dos.
//
// Ahora la mezcla la hace la base con `||` dentro del mismo UPDATE, que en READ COMMITTED
// reevalúa sobre la fila ya confirmada por el otro escritor.
//
// Las pruebas que fallan contra origin/main son las de los dos primeros describe. Las del
// último pasan en las dos versiones y se dicen así a propósito: son barandilla de lo que
// ya funcionaba (#711), no parte de este arreglo.

const session: { user: { id: string; role: string } | null } = {
  user: { id: "u1", role: "ADMIN" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const puedeTocar = vi.fn();
vi.mock("@/lib/rbac/record-access", () => ({
  puedeTocarRecord: (...a: unknown[]) => puedeTocar(...a),
}));

const CAMPOS = [
  { apiName: "presupuesto", label: "Presupuesto", fieldType: "NUMBER", isRequired: false, helpText: null, options: [] },
  { apiName: "zona_interes", label: "Zona", fieldType: "TEXT", isRequired: false, helpText: null, options: [] },
  { apiName: "solo_lectura", label: "Solo lectura", fieldType: "TEXT", isRequired: false, helpText: null, options: [] },
];

vi.mock("@/lib/metadata/registry", () => ({
  getActiveFields: async () => CAMPOS,
  visibleFields: () =>
    CAMPOS.map((field) => ({ field, canEdit: field.apiName !== "solo_lectura" })),
  // Validador de paso: lo que se prueba aquí es la mezcla, no el registro de campos.
  // El caso inválido se fuerza con `validadorFalla`.
  buildZodFromRegistry: () => ({
    safeParse: (v: unknown) =>
      validadorFalla
        ? { success: false, error: { flatten: () => ({ fieldErrors: { presupuesto: ["no"] } }) } }
        : { success: true, data: v },
  }),
}));
let validadorFalla = false;

const contactFindUnique = vi.fn();
const dealFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    deal: { findUnique: (...a: unknown[]) => dealFindUnique(...a) },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

// Las escrituras por el ORM dentro de la transacción. Si alguna se llama, la mezcla volvió
// a hacerse en memoria: es justo lo que este arreglo quita.
const txContactUpdate = vi.fn();
const txDealUpdate = vi.fn();
const txQueryRaw = vi.fn();

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (o: unknown, fn: (tx: unknown) => unknown) => {
    opcionesDelContexto = o;
    return fn({
      contact: { update: (...a: unknown[]) => txContactUpdate(...a) },
      deal: { update: (...a: unknown[]) => txDealUpdate(...a) },
      $queryRaw: (...a: unknown[]) => txQueryRaw(...a),
    });
  },
}));
let opcionesDelContexto: unknown = null;

import { PATCH } from "./route";

const ID = "c7216393-e0c6-49eb-bd44-f2eb477d9742";

/** El SQL que recibió `$queryRaw`, reconstruido del template etiquetado. */
function sqlDeLaLlamada(i = 0): string {
  const [trozos] = txQueryRaw.mock.calls[i] as [TemplateStringsArray];
  return trozos.join(" ? ");
}
function parametrosDeLaLlamada(i = 0): unknown[] {
  return (txQueryRaw.mock.calls[i] as unknown[]).slice(1);
}

function req(body: unknown) {
  return new Request(`http://localhost/api/records/contact/${ID}/custom`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const params = (object = "contact") => ({ params: { object, id: ID } });

/** Lo que la base devuelve en el RETURNING, o sea lo que quedó GUARDADO. */
function baseDevuelve(custom: unknown) {
  txQueryRaw.mockResolvedValue([{ custom }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  validadorFalla = false;
  opcionesDelContexto = null;
  session.user = { id: "u1", role: "ADMIN" };
  puedeTocar.mockResolvedValue(true);
  contactFindUnique.mockResolvedValue({ id: ID, custom: { presupuesto: 100 } });
  dealFindUnique.mockResolvedValue({ id: ID, custom: {} });
  baseDevuelve({ presupuesto: 100, zona_interes: "Tulum" });
});

describe("la mezcla la hace la BASE, no la memoria (#741)", () => {
  it("no escribe el objeto entero con el ORM: usa un UPDATE que mezcla en SQL", async () => {
    // El invariante del arreglo. `contact.update({ data: { custom: mezclaCompleta } })` es
    // la forma exacta del defecto: pisa el JSON entero con la copia que este request leyó.
    const res = await PATCH(req({ zona_interes: "Tulum" }), params());

    expect(res.status).toBe(200);
    expect(txContactUpdate).not.toHaveBeenCalled();
    expect(txDealUpdate).not.toHaveBeenCalled();
    expect(txQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("el UPDATE mezcla con `||` sobre la fila que él mismo lee", async () => {
    // Fija la forma que resuelve la carrera. Releer dentro de la transacción y volver a
    // mezclar en JavaScript también pasaría las otras pruebas y NO arreglaría nada: en
    // READ COMMITTED las dos transacciones pueden leer la misma versión. Lo que lo
    // resuelve es que la fila vieja la lea el propio UPDATE.
    await PATCH(req({ zona_interes: "Tulum" }), params());

    const sql = sqlDeLaLlamada();
    expect(sql).toMatch(/UPDATE\s+propyte_crm\.contacts/i);
    expect(sql).toContain("||");
    expect(sql).toMatch(/RETURNING\s+custom/i);
    // Y no hay un SELECT previo dentro de la transacción: una sola consulta.
    expect(txQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("los valores nuevos van como parámetro, no pegados al SQL", async () => {
    await PATCH(req({ zona_interes: "'; drop table contacts; --" }), params());

    const [json, id] = parametrosDeLaLlamada();
    expect(JSON.parse(json as string)).toEqual({ zona_interes: "'; drop table contacts; --" });
    expect(id).toBe(ID);
    expect(sqlDeLaLlamada()).not.toContain("drop table");
  });

  it("protege el caso en que `custom` no sea un objeto", async () => {
    // `'null'::jsonb || '{"a":1}'` NO falla: devuelve el array [null, {"a":1}] y dejaría el
    // registro corrupto en silencio. Comprobado contra la base el 2026-09-14. Hoy son 0
    // filas de 111 contactos, pero «hoy son cero» es el argumento que caducó en la #682.
    await PATCH(req({ zona_interes: "Tulum" }), params());

    expect(sqlDeLaLlamada()).toMatch(/jsonb_typeof\s*\(\s*custom\s*\)/i);
  });

  it("mueve `updatedAt`, que un UPDATE crudo no mueve solo", async () => {
    // `@updatedAt` lo aplica Prisma, no la base. Al cambiar el ORM por SQL crudo se perdía
    // sin que nada fallara, y el contacto habría quedado con fecha de modificación vieja.
    await PATCH(req({ zona_interes: "Tulum" }), params());

    expect(sqlDeLaLlamada()).toMatch(/"updatedAt"\s*=/);
  });

  it("sigue corriendo dentro del contexto de auditoría, con su actor", async () => {
    await PATCH(req({ zona_interes: "Tulum" }), params());

    expect(opcionesDelContexto).toEqual({ source: "ui", actorId: "u1" });
  });

  it("un deal va a su tabla y no a la de contactos", async () => {
    await PATCH(req({ zona_interes: "Tulum" }), params("deal"));

    expect(sqlDeLaLlamada()).toMatch(/UPDATE\s+propyte_crm\.deals/i);
  });
});

describe("la respuesta dice lo que quedó GUARDADO (#741)", () => {
  it("incluye lo que escribió el otro editor, no solo lo de este request", async () => {
    // Esta es la que documenta el daño. Alguien más guardó `zona_interes` mientras este
    // request tenía en la mano un `custom` que solo traía `presupuesto`. Antes la respuesta
    // se armaba con esa copia vieja, así que la pantalla borraba de la vista el trabajo del
    // otro aunque en la base estuviera. Ahora se devuelve el RETURNING.
    contactFindUnique.mockResolvedValue({ id: ID, custom: { presupuesto: 100 } });
    baseDevuelve({ presupuesto: 250, zona_interes: "Tulum" });

    const res = await PATCH(req({ presupuesto: 250 }), params());
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ presupuesto: 250, zona_interes: "Tulum" });
  });

  it("si el record desaparece entre el permiso y el UPDATE, es 404 y no `ok: true`", async () => {
    txQueryRaw.mockResolvedValue([]);

    const res = await PATCH(req({ zona_interes: "Tulum" }), params());

    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBeUndefined();
  });
});

describe("barandilla: lo que ya funcionaba y no debe romperse (#711)", () => {
  it("sin sesión, 401 y no se toca la base", async () => {
    session.user = null;

    const res = await PATCH(req({ zona_interes: "Tulum" }), params());

    expect(res.status).toBe(401);
    expect(txQueryRaw).not.toHaveBeenCalled();
  });

  it("sin acceso al record, 404 y no se escribe", async () => {
    puedeTocar.mockResolvedValue(false);

    const res = await PATCH(req({ zona_interes: "Tulum" }), params());

    expect(res.status).toBe(404);
    expect(txQueryRaw).not.toHaveBeenCalled();
  });

  it("un campo que el rol no puede editar es 403, antes de escribir", async () => {
    const res = await PATCH(req({ solo_lectura: "x" }), params());

    expect(res.status).toBe(403);
    expect(txQueryRaw).not.toHaveBeenCalled();
  });

  it("un objeto no soportado es 404", async () => {
    const res = await PATCH(req({ zona_interes: "Tulum" }), params("unidad"));

    expect(res.status).toBe(404);
    expect(txQueryRaw).not.toHaveBeenCalled();
  });

  it("valores que no validan son 422, antes de escribir", async () => {
    validadorFalla = true;

    const res = await PATCH(req({ presupuesto: "no es un numero" }), params());

    expect(res.status).toBe(422);
    expect(txQueryRaw).not.toHaveBeenCalled();
  });
});
