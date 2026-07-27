# Agenda Personal — Fase 2: ruta `/agenda` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al asesor una ruta `/agenda` donde capture tareas y notas personales sin inventar un contacto, y vea todos sus pendientes —personales y de CRM— en una sola lista agrupada por vencimiento, con completar en un clic.

**Architecture:** Un módulo puro de agrupación (`src/lib/agenda/grouping.ts`) que decide el bucket de cada pendiente en zona Cancún, un módulo de servidor (`src/server/agenda.ts`) que lee siempre con `userId` de sesión, una ruta HTTP nueva (`POST /api/agenda/activities`) que no acepta `contactId` por construcción, y una página servidor + vista cliente que reusan las convenciones de `/hoy`. Completar reusa el `PATCH /api/activities/[id]` que ya existe — no se crea endpoint nuevo.

**Tech Stack:** Next.js 15 (App Router), Prisma sobre Postgres/Supabase vía pooler, NextAuth (`getServerSession`), Zod, Vitest (`environment: "node"`), Tailwind + CSS custom properties del CRM, lucide-react.

---

## Contexto que el implementador necesita

**Estado de partida.** Fase 1 ya está en producción: `Activity.contactId` es nullable en base y en `prisma/schema.prisma:958`, y `createActivity()` en `src/server/activities.ts:183` acepta actividades sin contacto. Nada de eso se vuelve a tocar.

**El agujero que bloquea la Fase 2.** `POST /api/activities` (`src/app/api/activities/route.ts:24`) declara `contactId: z.string().uuid()` **obligatorio**, y además duplica la creación en línea en vez de llamar a `createActivity()`. Delegarlo a `createActivity()` cambiaría el status por defecto de los callers existentes (la ruta fuerza `PENDIENTE`; `createActivity` auto-completa los tipos de `AUTO_COMPLETED_TYPES`). Por eso **no se modifica esa ruta**: la agenda estrena su propio namespace `/api/agenda/*`, que es además el que el spec §8.2 ya reserva para el asistente.

**RBAC — por qué la agenda no usa los rolesets existentes.** En `src/server/activities.ts:113-123` el orden de evaluación es OWN → TEAM → FULL, y `ADMIN` está tanto en `FULL_ACCESS_ROLES` como en `TEAM_ACCESS_ROLES`, así que un ADMIN cae en la rama TEAM y se queda con su equipo. Es un bug preexistente y **no se arregla aquí**. La agenda lo esquiva por diseño: filtra siempre por `session.user.id`, sin ramas por rol, que es justo lo que pide el spec §4.4 ("todo query filtra por `userId` de la sesión"). Una agenda *personal* nunca debe mostrar pendientes ajenos, ni siquiera a un ADMIN.

**Zona horaria.** Agrupar por día es una decisión de calendario, no de instante. `src/lib/format-date.ts` ya fija `America/Cancun` por una razón documentada ahí: sin tz fija, servidor y navegador discrepan cerca de medianoche y React tira mismatch de hidratación (#418/#425). El módulo de agrupación usa la misma zona. Cancún es UTC−5 sin horario de verano.

**Tests.** `vitest.config.ts` declara `environment: "node"` global — no hay jsdom, así que **no se escriben tests de render**. Se testean el módulo puro, el módulo de servidor con Prisma mockeado y el handler de la ruta. La UI cliente se verifica con la receta de dos modalidades del spec §5.3 (Task 8), porque `tsc` no ve el JSON que un componente cliente tipa a mano.

**Traslape con `/hoy`, ya decidido.** `/hoy` sigue siendo el triage de pipeline. Su bucket de tareas (`src/server/today.ts:96`) muestra `TASK`+`CALL_TASK` con `dueDate <= hoy`, tope 6 — las tareas **sin fecha son invisibles ahí**, y la captura rápida permite justo eso. `/agenda` es la lista completa; `/hoy` enlaza hacia ella (Task 7).

**Sobre las notas (adición al spec).** §6 pide un toggle TASK/NOTE en la captura, pero define el listado como "pendientes". Una `NOTE` nace `COMPLETADA` (`src/server/activities.ts:205-208`), así que caería fuera del listado y desaparecería al capturarla. La Task 4 agrega una sección "Notas recientes" para cerrar ese hueco. Es lo único de este plan que va más allá de §6 — si se recorta, quitar Task 4 y el bloque de notas de Task 6, y el resto sigue en pie.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/agenda/grouping.ts` **(nuevo)** | Puro. Día en Cancún y bucket por vencimiento. Sin React, sin Prisma, sin `Date.now()` implícito — el `now` se inyecta. |
| `src/lib/agenda/grouping.test.ts` **(nuevo)** | Tests del módulo puro, incluida la frontera de tz. |
| `src/server/agenda.ts` **(nuevo)** | `getMyAgenda()` y `getMyRecentNotes()`. Único punto de lectura, siempre con `userId` de sesión. |
| `src/server/agenda.test.ts` **(nuevo)** | Prisma y sesión mockeados. Fija el scoping por usuario. |
| `src/app/api/agenda/activities/route.ts` **(nuevo)** | `POST` de captura rápida. Schema `.strict()` sin `contactId`. |
| `src/app/api/agenda/activities/route.test.ts` **(nuevo)** | Validación, rechazo de `contactId`, happy path. |
| `src/app/(dashboard)/agenda/page.tsx` **(nuevo)** | Componente de servidor: sesión, carga, serialización. |
| `src/components/agenda/agenda-view.tsx` **(nuevo)** | Cliente. Listado agrupado + completar + notas. |
| `src/components/agenda/quick-capture.tsx` **(nuevo)** | Cliente. Formulario de captura. |
| `src/components/layout/nav-config.ts` **(modificar)** | Item "Agenda" para todos los roles. |
| `src/components/today/today-view.tsx` **(modificar)** | Enlace permanente desde el bucket de tareas hacia `/agenda`. |

---

### Task 1: Módulo puro de agrupación

**Files:**
- Create: `src/lib/agenda/grouping.ts`
- Test: `src/lib/agenda/grouping.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/agenda/grouping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cancunDayKey, bucketFor, groupAgenda, type AgendaItem } from "./grouping";

// Cancún es UTC−5 sin horario de verano.
describe("cancunDayKey", () => {
  it("usa el día civil de Cancún, no el de UTC", () => {
    // 2026-07-27T02:00:00Z son las 21:00 del 26 de julio en Cancún.
    expect(cancunDayKey(new Date("2026-07-27T02:00:00Z"))).toBe("2026-07-26");
  });

  it("cruza al día siguiente a partir de las 05:00Z", () => {
    expect(cancunDayKey(new Date("2026-07-27T05:00:00Z"))).toBe("2026-07-27");
  });
});

describe("bucketFor", () => {
  // Cancún: 26 de julio, 21:00.
  const now = new Date("2026-07-27T02:00:00Z");

  it("sin fecha cae en sin_fecha", () => {
    expect(bucketFor(null, now)).toBe("sin_fecha");
  });

  it("una fecha anterior al día de hoy es vencida", () => {
    expect(bucketFor(new Date("2026-07-25T18:00:00Z"), now)).toBe("vencidas");
  });

  it("el mismo día civil de Cancún es hoy", () => {
    expect(bucketFor(new Date("2026-07-26T14:00:00Z"), now)).toBe("hoy");
  });

  it("no confunde el día de UTC con el de Cancún", () => {
    // 2026-07-27T10:00:00Z es el 27 en Cancún → mañana, no hoy.
    // Con lógica UTC ingenua ambos serían 2026-07-27 y esto diría "hoy".
    expect(bucketFor(new Date("2026-07-27T10:00:00Z"), now)).toBe("semana");
  });

  it("el sexto día por delante todavía es esta semana", () => {
    expect(bucketFor(new Date("2026-08-01T14:00:00Z"), now)).toBe("semana");
  });

  it("el séptimo día por delante ya es después", () => {
    expect(bucketFor(new Date("2026-08-02T14:00:00Z"), now)).toBe("despues");
  });
});

describe("groupAgenda", () => {
  const now = new Date("2026-07-27T02:00:00Z");

  const item = (id: string, dueDate: string | null): AgendaItem => ({
    id,
    subject: `Tarea ${id}`,
    activityType: "TASK",
    status: "PENDIENTE",
    dueDate,
    contactId: null,
    contactName: null,
  });

  it("reparte cada item en su bucket y conserva el orden de entrada", () => {
    const result = groupAgenda(
      [
        item("a", "2026-07-25T18:00:00Z"),
        item("b", "2026-07-26T14:00:00Z"),
        item("c", "2026-07-24T18:00:00Z"),
        item("d", null),
      ],
      now,
    );

    expect(result.vencidas.map((i) => i.id)).toEqual(["a", "c"]);
    expect(result.hoy.map((i) => i.id)).toEqual(["b"]);
    expect(result.semana).toEqual([]);
    expect(result.despues).toEqual([]);
    expect(result.sin_fecha.map((i) => i.id)).toEqual(["d"]);
  });

  it("devuelve los cinco buckets aunque estén vacíos", () => {
    const result = groupAgenda([], now);
    expect(Object.keys(result).sort()).toEqual(
      ["despues", "hoy", "semana", "sin_fecha", "vencidas"],
    );
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/agenda/grouping.test.ts`
Expected: FAIL — `Failed to resolve import "./grouping"`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/agenda/grouping.ts`:

```ts
// Agrupación de pendientes por vencimiento — módulo PURO (testeable en node, sin React ni Prisma).
// La zona horaria es fija (America/Cancun) por la misma razón que src/lib/format-date.ts:
// sin tz fija, servidor y navegador discrepan cerca de medianoche y React tira mismatch
// de hidratación. Cancún es UTC−5 sin horario de verano.
const TZ = "America/Cancun";

export type AgendaBucket = "vencidas" | "hoy" | "semana" | "despues" | "sin_fecha";

export interface AgendaItem {
  id: string;
  subject: string;
  activityType: string;
  status: string;
  dueDate: string | null; // ISO 8601, o null si no tiene fecha
  contactId: string | null;
  contactName: string | null;
}

export type AgendaBuckets = Record<AgendaBucket, AgendaItem[]>;

/** Día civil en Cancún como "YYYY-MM-DD". El formato ordena lexicográficamente igual que cronológicamente. */
export function cancunDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Aritmética de calendario sobre la clave de día, sin volver a tocar zonas horarias. */
function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function bucketFor(dueDate: Date | string | null, now: Date): AgendaBucket {
  if (!dueDate) return "sin_fecha";

  const dueKey = cancunDayKey(new Date(dueDate));
  const todayKey = cancunDayKey(now);

  if (dueKey < todayKey) return "vencidas";
  if (dueKey === todayKey) return "hoy";
  if (dueKey <= addDaysToKey(todayKey, 6)) return "semana";
  return "despues";
}

export function groupAgenda(items: AgendaItem[], now: Date): AgendaBuckets {
  const buckets: AgendaBuckets = {
    vencidas: [],
    hoy: [],
    semana: [],
    despues: [],
    sin_fecha: [],
  };

  for (const item of items) {
    buckets[bucketFor(item.dueDate, now)].push(item);
  }

  return buckets;
}

/** Orden de presentación y etiqueta visible de cada bucket. */
export const BUCKET_ORDER: AgendaBucket[] = ["vencidas", "hoy", "semana", "despues", "sin_fecha"];

export const BUCKET_LABEL: Record<AgendaBucket, string> = {
  vencidas: "Vencidas",
  hoy: "Hoy",
  semana: "Esta semana",
  despues: "Después",
  sin_fecha: "Sin fecha",
};

export const BUCKET_ACCENT: Record<AgendaBucket, string> = {
  vencidas: "#DC2626",
  hoy: "#D97706",
  semana: "#2563EB",
  despues: "#6B7280",
  sin_fecha: "#6B7280",
};
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/agenda/grouping.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/agenda/grouping.ts src/lib/agenda/grouping.test.ts
git commit -m "feat(agenda): módulo puro de agrupación de pendientes por vencimiento"
```

---

### Task 2: `getMyAgenda` en el módulo de servidor

**Files:**
- Create: `src/server/agenda.ts`
- Test: `src/server/agenda.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/server/agenda.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const activityFindMany = vi.fn();
// Mutable para poder simular la ausencia de sesión — misma convención que
// src/app/api/admin/automation/plans/route.test.ts:3.
let session: { user: { id: string; role: string } } | null = null;

vi.mock("@/lib/db", () => ({
  default: {
    activity: { findMany: (...a: unknown[]) => activityFindMany(...a) },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(session),
}));

import { getMyAgenda } from "./agenda";

beforeEach(() => {
  activityFindMany.mockReset();
  activityFindMany.mockResolvedValue([]);
  session = { user: { id: "user-1", role: "ASESOR" } };
});

describe("getMyAgenda — scoping", () => {
  it("filtra siempre por el userId de la sesión", async () => {
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    expect(activityFindMany.mock.calls[0][0].where.userId).toBe("user-1");
  });

  it("un ADMIN tampoco ve pendientes ajenos: la agenda es personal", async () => {
    session = { user: { id: "admin-9", role: "ADMIN" } };
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));

    const where = activityFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe("admin-9");
    // Sin ramas por rol: no hay `in`, no hay equipo.
    expect(typeof where.userId).toBe("string");
  });

  it("solo trae pendientes vivos", async () => {
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    const where = activityFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.status).toEqual({ in: ["PENDIENTE", "VENCIDA"] });
  });
});

describe("getMyAgenda — forma del resultado", () => {
  it("mapea la fila de Prisma a AgendaItem y la agrupa", async () => {
    activityFindMany.mockResolvedValue([
      {
        id: "act-1",
        subject: "Preparar propuesta",
        activityType: "TASK",
        status: "PENDIENTE",
        dueDate: new Date("2026-07-26T14:00:00Z"),
        contactId: null,
        contact: null,
      },
      {
        id: "act-2",
        subject: "Llamar a Ana",
        activityType: "CALL_TASK",
        status: "PENDIENTE",
        dueDate: new Date("2026-07-20T14:00:00Z"),
        contactId: "c-1",
        contact: { id: "c-1", firstName: "Ana", lastName: "Ruiz" },
      },
    ]);

    const result = await getMyAgenda(new Date("2026-07-27T02:00:00Z"));

    expect(result.total).toBe(2);
    expect(result.buckets.hoy[0]).toEqual({
      id: "act-1",
      subject: "Preparar propuesta",
      activityType: "TASK",
      status: "PENDIENTE",
      dueDate: "2026-07-26T14:00:00.000Z",
      contactId: null,
      contactName: null,
    });
    expect(result.buckets.vencidas[0].contactName).toBe("Ana Ruiz");
  });

  it("una actividad personal llega con contacto nulo, sin romper el mapeo", async () => {
    activityFindMany.mockResolvedValue([
      {
        id: "act-3",
        subject: "Renovar seguro del coche",
        activityType: "TASK",
        status: "PENDIENTE",
        dueDate: null,
        contactId: null,
        contact: null,
      },
    ]);

    const result = await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    expect(result.buckets.sin_fecha[0].contactName).toBeNull();
    expect(result.buckets.sin_fecha[0].dueDate).toBeNull();
  });

  it("lanza si no hay sesión", async () => {
    session = null;
    await expect(getMyAgenda(new Date("2026-07-27T02:00:00Z"))).rejects.toThrow("No autorizado");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/server/agenda.test.ts`
Expected: FAIL — `Failed to resolve import "./agenda"`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/server/agenda.ts`:

```ts
// ============================================================
// Agenda personal del asesor (spec §6, Fase 2)
// Lectura de pendientes propios. SIEMPRE con el userId de la sesión:
// una agenda personal no muestra pendientes ajenos ni a un ADMIN, y así
// además se esquiva el orden de rolesets de src/server/activities.ts:113.
// ============================================================

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { groupAgenda, type AgendaBuckets, type AgendaItem } from "@/lib/agenda/grouping";

// Topes SEPARADOS por tipo de pendiente, a propósito. En Postgres el ASC deja los
// NULL al final, así que un tope global sobre `dueDate asc` truncaría el bucket
// sin_fecha a cero de forma sistemática en cuanto el asesor acumule 200 pendientes
// con fecha — y las tareas sin fecha son justo el caso principal de la captura
// rápida. Con cupo propio, cada bucket sobrevive.
const AGENDA_TAKE_CON_FECHA = 200;
const AGENDA_TAKE_SIN_FECHA = 50;

/** Una sola fuente de verdad para las dos lecturas. */
const SELECT = {
  id: true,
  subject: true,
  activityType: true,
  status: true,
  dueDate: true,
  contactId: true,
  contact: { select: { id: true, firstName: true, lastName: true } },
} as const;

export interface MyAgenda {
  buckets: AgendaBuckets;
  /** Pendientes existentes en base, no los que alcanzó a traer el tope. */
  total: number;
  /** true si los topes recortaron algo — la UI puede avisar que no se ve todo. */
  truncated: boolean;
}

export async function getMyAgenda(now: Date = new Date()): Promise<MyAgenda> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const baseWhere = {
    userId: session.user.id,
    deletedAt: null,
    status: { in: ["PENDIENTE", "VENCIDA"] },
  };

  const [conFecha, sinFecha, total] = await Promise.all([
    prisma.activity.findMany({
      where: { ...baseWhere, dueDate: { not: null } },
      select: SELECT,
      orderBy: { dueDate: "asc" },
      take: AGENDA_TAKE_CON_FECHA,
    }),
    prisma.activity.findMany({
      where: { ...baseWhere, dueDate: null },
      select: SELECT,
      orderBy: { createdAt: "desc" },
      take: AGENDA_TAKE_SIN_FECHA,
    }),
    prisma.activity.count({ where: baseWhere }),
  ]);

  const items: AgendaItem[] = [...conFecha, ...sinFecha].map((r) => ({
    id: r.id,
    subject: r.subject,
    activityType: r.activityType,
    status: r.status,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    contactId: r.contactId,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
  }));

  return { buckets: groupAgenda(items, now), total, truncated: items.length < total };
}
```

Los tests deben fijar la **forma de la llamada a Prisma**, no solo el `where`: cada query con su `take` y su `orderBy`, `total` viniendo de `count` y no de `items.length`, y —el que importa— que con la query con-fecha devolviendo 200 filas el bucket `sin_fecha` **siga poblado**. Es la regresión que se está previniendo.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/server/agenda.test.ts`
Expected: PASS — 6 tests (11 tras endurecer los topes por bucket)

Si `tsc` se queja del literal de `status` contra el enum generado de Prisma, seguir el patrón que ya usa `src/server/today.ts:96` (`"PENDIENTE" as never`) en vez de inventar un cast nuevo.

- [ ] **Step 5: Commit**

```bash
git add src/server/agenda.ts src/server/agenda.test.ts
git commit -m "feat(agenda): getMyAgenda con scoping estricto al usuario de sesión"
```

---

### Task 3: Ruta de captura rápida

**Files:**
- Create: `src/app/api/agenda/activities/route.ts`
- Test: `src/app/api/agenda/activities/route.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/app/api/agenda/activities/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const createActivity = vi.fn();

vi.mock("@/server/activities", () => ({
  createActivity: (...a: unknown[]) => createActivity(...a),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/agenda/activities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  createActivity.mockReset();
  createActivity.mockResolvedValue({ id: "act-1", contactId: null });
});

describe("POST /api/agenda/activities", () => {
  it("crea una TASK personal y responde 201", async () => {
    const res = await POST(req({ activityType: "TASK", subject: "Preparar propuesta" }));

    expect(res.status).toBe(201);
    expect(createActivity).toHaveBeenCalledOnce();
    const arg = createActivity.mock.calls[0][0];
    expect(arg.activityType).toBe("TASK");
    expect(arg.subject).toBe("Preparar propuesta");
    // La captura es personal por construcción: contactId no existe en el input.
    expect(arg.contactId).toBeUndefined();
  });

  it("rechaza un contactId aunque venga en el body", async () => {
    const res = await POST(
      req({
        activityType: "TASK",
        subject: "Colar una actividad ajena",
        contactId: "11111111-1111-1111-1111-111111111111",
      }),
    );

    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza un tipo que no sea TASK o NOTE", async () => {
    const res = await POST(req({ activityType: "CALL_OUTBOUND", subject: "Llamada" }));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza un asunto demasiado corto", async () => {
    const res = await POST(req({ activityType: "TASK", subject: "ab" }));
    expect(res.status).toBe(400);
  });

  it("ancla una fecha sin hora a medianoche de Cancún, no de UTC", async () => {
    // <input type="date"> manda "2026-07-30". Con z.coerce.date() eso sería
    // medianoche UTC = 19:00 del 29 en Cancún, y la tarea caería un día antes
    // en la agenda. Medianoche de Cancún (UTC−5) son las 05:00Z.
    await POST(req({ activityType: "TASK", subject: "Junta del jueves", dueDate: "2026-07-30" }));

    const dueDate = createActivity.mock.calls[0][0].dueDate;
    expect(dueDate).toBeInstanceOf(Date);
    expect(dueDate.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  it("respeta un datetime completo tal cual viene", async () => {
    await POST(req({
      activityType: "TASK",
      subject: "Llamada de las 10",
      dueDate: "2026-07-30T16:00:00.000Z",
    }));
    expect(createActivity.mock.calls[0][0].dueDate.toISOString()).toBe("2026-07-30T16:00:00.000Z");
  });

  it("rechaza una fecha ilegible", async () => {
    const res = await POST(req({ activityType: "TASK", subject: "Fecha rota", dueDate: "no-es-fecha" }));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("traduce la falta de sesión a 401", async () => {
    createActivity.mockRejectedValue(new Error("No autorizado"));
    const res = await POST(req({ activityType: "TASK", subject: "Cualquier cosa" }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/app/api/agenda/activities/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/app/api/agenda/activities/route.ts`:

```ts
// ============================================================
// API Route: /api/agenda/activities
// POST - Captura rápida de la agenda personal (spec §6)
//
// No acepta contactId: una actividad capturada aquí es personal por
// construcción, igual que el asistente de §8.2 no deja que el modelo
// elija de quién es la agenda. Namespace propio para no alterar el
// comportamiento de /api/activities, que fuerza PENDIENTE por defecto.
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { createActivity } from "@/server/activities";

// Cancún es UTC−5 sin horario de verano.
const CANCUN_OFFSET = "-05:00";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El <input type="date"> del cliente manda "YYYY-MM-DD" sin hora. `z.coerce.date()`
 * lo interpretaría como medianoche UTC, que en Cancún son las 19:00 del día anterior:
 * una tarea fechada el 30 se guardaría el 29 y aparecería vencida un día antes.
 * Se ancla a medianoche de Cancún. Un datetime completo pasa sin tocarse.
 *
 * La regla vive SOLO aquí, en la frontera donde el string entra al sistema —
 * duplicarla en el módulo de agrupación la haría divergir.
 */
const dueDateSchema = z
  .union([z.string(), z.date()])
  .transform((v) =>
    typeof v === "string" && DATE_ONLY.test(v)
      ? new Date(`${v}T00:00:00${CANCUN_OFFSET}`)
      : new Date(v),
  )
  .refine((d) => !Number.isNaN(d.getTime()), { message: "Fecha inválida" });

const captureSchema = z
  .object({
    activityType: z.enum(["TASK", "NOTE"]),
    subject: z.string().min(3, "El asunto debe tener al menos 3 caracteres").max(200).trim(),
    description: z.string().max(5000).optional(),
    dueDate: dueDateSchema.optional(),
  })
  .strict(); // cualquier campo extra (contactId, dealId, userId) es un 400, no un silencio

function errToResponse(error: unknown) {
  const msg = error instanceof Error ? error.message : "";
  if (msg.includes("No autorizado")) return NextResponse.json({ error: msg }, { status: 401 });
  if (msg.includes("permiso")) return NextResponse.json({ error: msg }, { status: 403 });
  console.error("Error en /api/agenda/activities:", error);
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = captureSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validation.error.flatten() },
        { status: 400 },
      );
    }

    // createActivity toma el userId de la sesión — nunca del body.
    const activity = await createActivity(validation.data);

    return NextResponse.json({ data: activity }, { status: 201 });
  } catch (error) {
    return errToResponse(error);
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/app/api/agenda/activities/route.test.ts`
Expected: PASS — 8 tests (19 tras endurecer asunto y validación de calendario)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agenda/activities/route.ts src/app/api/agenda/activities/route.test.ts
git commit -m "feat(agenda): POST /api/agenda/activities para captura personal"
```

---

### Task 4: Notas recientes

> Adición al spec §6 — cierra el hueco de que una `NOTE` nace `COMPLETADA` y no aparecería en el listado de pendientes. Si se decide recortar, omitir esta task y el bloque de notas de la Task 6.

**Files:**
- Modify: `src/server/agenda.ts`
- Modify: `src/server/agenda.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Primero, ampliar el import de la línea 15 de `src/server/agenda.test.ts`:

```ts
import { getMyAgenda, getMyRecentNotes } from "./agenda";
```

Y agregar al final del archivo:

```ts
describe("getMyRecentNotes", () => {
  it("trae solo NOTE del usuario de sesión", async () => {
    activityFindMany.mockResolvedValue([]);

    await getMyRecentNotes();

    const where = activityFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe("user-1");
    expect(where.activityType).toBe("NOTE");
    expect(where.deletedAt).toBeNull();
  });

  it("mapea la nota con su fecha de creación en ISO", async () => {
    activityFindMany.mockResolvedValue([
      {
        id: "note-1",
        subject: "Idea para la campaña de Tulum",
        description: "Enfocar en preventa",
        createdAt: new Date("2026-07-26T14:00:00Z"),
        contactId: null,
        contact: null,
      },
    ]);

    const notes = await getMyRecentNotes();
    expect(notes).toEqual([
      {
        id: "note-1",
        subject: "Idea para la campaña de Tulum",
        description: "Enfocar en preventa",
        createdAt: "2026-07-26T14:00:00.000Z",
        contactId: null,
        contactName: null,
      },
    ]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/server/agenda.test.ts`
Expected: FAIL — `getMyRecentNotes is not a function`

- [ ] **Step 3: Escribir la implementación mínima**

Agregar al final de `src/server/agenda.ts`:

```ts
/** Tope de notas recientes en la vista. */
const NOTES_TAKE = 20;

export interface AgendaNote {
  id: string;
  subject: string;
  description: string | null;
  createdAt: string; // ISO 8601
  contactId: string | null;
  contactName: string | null;
}

/**
 * Notas del asesor. Una NOTE nace COMPLETADA (src/server/activities.ts:205),
 * así que queda fuera de getMyAgenda: sin esta lista, capturar una nota la
 * haría desaparecer de la vista.
 */
export async function getMyRecentNotes(): Promise<AgendaNote[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const rows = await prisma.activity.findMany({
    where: {
      userId: session.user.id,
      deletedAt: null,
      activityType: "NOTE",
    },
    select: {
      id: true,
      subject: true,
      description: true,
      createdAt: true,
      contactId: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: NOTES_TAKE,
  });

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
    contactId: r.contactId,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
  }));
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/server/agenda.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add src/server/agenda.ts src/server/agenda.test.ts
git commit -m "feat(agenda): getMyRecentNotes para que una nota capturada no desaparezca"
```

---

### Task 5: Componente de captura rápida

**Files:**
- Create: `src/components/agenda/quick-capture.tsx`

No lleva test: `vitest.config.ts` corre en `environment: "node"` y no hay jsdom. Se verifica en la Task 8.

- [ ] **Step 1: Escribir el componente**

Crear `src/components/agenda/quick-capture.tsx`:

```tsx
// Captura rápida de la agenda personal (spec §6): un input, un toggle TASK/NOTE
// y fecha opcional. Sin contacto — eso es lo que hace personal a la actividad.
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, StickyNote, Loader2, Plus } from "lucide-react";

type CaptureType = "TASK" | "NOTE";

export function QuickCapture() {
  const router = useRouter();
  const [type, setType] = React.useState<CaptureType>("TASK");
  const [subject, setSubject] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSubmit = subject.trim().length >= 3 && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/agenda/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityType: type,
          subject: subject.trim(),
          // Solo se manda dueDate si el usuario puso fecha: el schema es .strict()
          // y no acepta null, así que la clave se omite por completo.
          ...(type === "TASK" && dueDate ? { dueDate } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo guardar");
      }

      setSubject("");
      setDueDate("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="crm-card p-4">
      <div className="flex items-center gap-2 pb-3">
        {(["TASK", "NOTE"] as CaptureType[]).map((t) => {
          const active = type === t;
          const Icon = t === "TASK" ? CheckSquare : StickyNote;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              aria-pressed={active}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
              style={{
                background: active ? "var(--text-primary)" : "transparent",
                color: active ? "var(--text-inverse, #fff)" : "var(--text-secondary)",
                border: `1px solid ${active ? "var(--text-primary)" : "var(--border-subtle)"}`,
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {t === "TASK" ? "Tarea" : "Nota"}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={
            type === "TASK" ? "Preparar propuesta para la junta del jueves" : "Anotar una idea…"
          }
          maxLength={200}
          aria-label={type === "TASK" ? "Asunto de la tarea" : "Asunto de la nota"}
          className="min-w-0 flex-1 rounded-md px-3 py-2 text-[13px]"
          style={{
            background: "var(--bg-input, transparent)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
          }}
        />

        {type === "TASK" && (
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Fecha de vencimiento (opcional)"
            className="rounded-md px-3 py-2 text-[13px]"
            style={{
              background: "var(--bg-input, transparent)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
            }}
          />
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
          style={{ background: "var(--text-primary)", color: "var(--text-inverse, #fff)" }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Guardar
        </button>
      </div>

      {error && (
        <p role="alert" className="pt-2 text-[12px]" style={{ color: "#DC2626" }}>
          {error}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit 2>&1 | grep -F "src/components/agenda/quick-capture.tsx"`
Expected: sin salida (los 2 errores preexistentes de `src/lib/workflows/builder-model.test.ts` no cuentan)

- [ ] **Step 3: Commit**

```bash
git add src/components/agenda/quick-capture.tsx
git commit -m "feat(agenda): componente de captura rápida"
```

---

### Task 6: Vista de agenda y página

**Files:**
- Create: `src/components/agenda/agenda-view.tsx`
- Create: `src/app/(dashboard)/agenda/page.tsx`

- [ ] **Step 1: Escribir la vista**

Crear `src/components/agenda/agenda-view.tsx`:

```tsx
// Agenda personal (spec §6): captura arriba, pendientes agrupados por vencimiento,
// notas recientes al final. Reusa las convenciones visuales de /hoy (crm-card,
// variables CSS del tema, acento solo como señal de prioridad).
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, StickyNote, User } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import {
  BUCKET_ORDER,
  BUCKET_LABEL,
  BUCKET_ACCENT,
  type AgendaBucket,
  type AgendaBuckets,
  type AgendaItem,
} from "@/lib/agenda/grouping";
import type { AgendaNote } from "@/server/agenda";
import { QuickCapture } from "./quick-capture";

interface AgendaViewProps {
  buckets: AgendaBuckets;
  total: number;
  truncated: boolean;
  notes: AgendaNote[];
  firstName: string;
}

function ItemRow({ item, onDone, busy }: { item: AgendaItem; onDone: (id: string) => void; busy: boolean }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <button
        type="button"
        onClick={() => onDone(item.id)}
        disabled={busy}
        aria-label={`Completar: ${item.subject}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-40"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} />}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-[color:var(--text-primary)]">{item.subject}</p>
        {item.contactId && item.contactName && (
          <Link
            href={`/contacts/${item.contactId}`}
            className="flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:underline"
          >
            <User className="h-3 w-3" />
            {item.contactName}
          </Link>
        )}
      </div>

      {item.dueDate && (
        <span className="num shrink-0 text-[11px] text-[color:var(--text-tertiary)]">
          {formatDate(item.dueDate, { day: "2-digit", month: "short" })}
        </span>
      )}
    </li>
  );
}

export function AgendaView({ buckets, total, truncated, notes, firstName }: AgendaViewProps) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function complete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      // Reusa el endpoint que ya existe: PATCH delega en updateActivity, que
      // aplica RBAC y sella completedAt (src/server/activities.ts:273-278).
      const res = await fetch(`/api/activities/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "COMPLETADA" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo completar");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar");
    } finally {
      setBusyId(null);
    }
  }

  const nonEmpty = BUCKET_ORDER.filter((b) => buckets[b].length > 0);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-[18px] font-semibold text-[color:var(--text-primary)]">
          Agenda de {firstName}
        </h1>
        <p className="text-[13px] text-[color:var(--text-secondary)]">
          {total === 0
            ? "Sin pendientes."
            : `${total} pendiente${total === 1 ? "" : "s"}, personales y de CRM.`}
        </p>
        {truncated && (
          <p className="pt-1 text-[12px]" style={{ color: "#D97706" }}>
            Se muestran los más próximos. Tienes más pendientes de los que caben en esta vista.
          </p>
        )}
      </header>

      <QuickCapture />

      {error && (
        <p role="alert" className="text-[12px]" style={{ color: "#DC2626" }}>
          {error}
        </p>
      )}

      {nonEmpty.length === 0 ? (
        <div className="crm-card p-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
          Nada pendiente. Captura algo arriba para empezar.
        </div>
      ) : (
        nonEmpty.map((bucket: AgendaBucket) => (
          <section key={bucket} className="crm-card !p-0 overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">
                {BUCKET_LABEL[bucket]}
              </span>
              <span
                className="num min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold"
                style={{ background: BUCKET_ACCENT[bucket], color: "var(--text-inverse, #fff)" }}
              >
                {buckets[bucket].length}
              </span>
            </div>
            <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {buckets[bucket].map((item) => (
                <ItemRow key={item.id} item={item} onDone={complete} busy={busyId === item.id} />
              ))}
            </ul>
          </section>
        ))
      )}

      {notes.length > 0 && (
        <section className="crm-card !p-0 overflow-hidden">
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <StickyNote className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
            <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">
              Notas recientes
            </span>
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {notes.map((n) => (
              <li key={n.id} className="px-4 py-2.5">
                <p className="truncate text-[13px] text-[color:var(--text-primary)]">{n.subject}</p>
                <p className="num text-[11px] text-[color:var(--text-tertiary)]">
                  {formatDate(n.createdAt, { day: "2-digit", month: "short" })}
                  {n.contactName ? ` · ${n.contactName}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Escribir la página**

Crear `src/app/(dashboard)/agenda/page.tsx`:

```tsx
// Agenda personal del asesor (spec §6, Fase 2) — componente de servidor.
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getMyAgenda, getMyRecentNotes } from "@/server/agenda";
import { AgendaView } from "@/components/agenda/agenda-view";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const [agenda, notes] = await Promise.all([getMyAgenda(), getMyRecentNotes()]);
  const firstName = (session.user.name ?? "").split(" ")[0] || "asesor";

  return (
    <AgendaView
      buckets={agenda.buckets}
      total={agenda.total}
      truncated={agenda.truncated}
      notes={notes}
      firstName={firstName}
    />
  );
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit 2>&1 | grep -E "src/(app/\(dashboard\)/agenda|components/agenda)"`
Expected: sin salida

- [ ] **Step 4: Commit**

```bash
git add src/components/agenda/agenda-view.tsx "src/app/(dashboard)/agenda/page.tsx"
git commit -m "feat(agenda): ruta /agenda con listado agrupado y completar"
```

---

### Task 7: Navegación y enlace desde `/hoy`

**Files:**
- Modify: `src/components/layout/nav-config.ts:5-21` (import) y `:35-43` (grupo sin título)
- Modify: `src/components/today/today-view.tsx:26-36` (props de `Section`), `:85` (condición del enlace), `:118-125` (invocación de tareas)

- [ ] **Step 1: Agregar el item de navegación**

En `src/components/layout/nav-config.ts`, agregar `CalendarCheck` al import de `lucide-react` (la lista de las líneas 5-21, en orden alfabético junto a los demás):

```ts
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Kanban,
  Building2,
  DollarSign,
  BarChart3,
  TrendingUp,
  UserCheck,
  Settings,
  Sun,
  FileText,
  Target,
  CopyCheck,
  Plug,
  CalendarCheck,
} from "lucide-react"
```

Y agregar el item justo después de "Hoy" en el primer grupo:

```ts
  {
    title: null,
    items: [
      { label: "Hoy", href: "/hoy", icon: Sun, roles: TODOS },
      { label: "Agenda", href: "/agenda", icon: CalendarCheck, roles: TODOS },
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: TODOS },
      { label: "Inbox", href: "/inbox", icon: MessageSquare, roles: ["DIRECTOR", "GERENTE", "TEAM_LEADER", ...ASESORES, "MARKETING"] },
    ],
  },
```

- [ ] **Step 2: Correr el test de navegación**

Run: `npx vitest run src/components/layout/nav-config.test.ts`
Expected: PASS — el test fija que todo rol del enum vea al menos 1 item; `TODOS` no lo rompe y ADMIN ve todo por la regla de `visibleNavItems`.

- [ ] **Step 3: Hacer que el enlace de `/hoy` siempre se muestre**

El enlace "Ver todos" de `Section` solo aparece cuando `count > items.length` (`src/components/today/today-view.tsx:85`), así que un asesor con 3 tareas nunca vería el camino a `/agenda`. Agregar una prop para forzarlo.

En la interfaz `SectionProps` (líneas 26-33), agregar la prop después de `viewAllHref`:

```ts
interface SectionProps {
  title: string;
  icon: LucideIcon;
  count: number;
  items?: TodayMini[];
  accent?: string;
  emptyText: string;
  viewAllHref?: string;
  viewAllAlways?: boolean;
  renderAction?: (item: TodayMini) => React.ReactNode;
}
```

En la firma de `Section` (línea 36), desestructurarla:

```ts
function Section({ title, icon: Icon, count, items = [], accent, emptyText, viewAllHref, viewAllAlways, renderAction }: SectionProps) {
```

En la condición del enlace (línea 85), aceptar el forzado:

```tsx
      {viewAllHref && (viewAllAlways || count > items.length) && (
        <Link href={viewAllHref} className="flex items-center justify-center gap-1 px-4 py-2 text-[12px] text-[color:var(--text-secondary)] hover:underline" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          {count > items.length ? `Ver todos (${count})` : "Ver mi agenda"} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
```

- [ ] **Step 4: Apuntar el bucket de tareas a `/agenda`**

Reemplazar la invocación de las líneas 118-125:

```tsx
        <Section title="Tareas de hoy y vencidas" icon={CheckSquare} count={data.tasks.count} items={data.tasks.items}
          accent="#D97706" emptyText="Sin tareas pendientes."
          viewAllHref="/agenda" viewAllAlways
          renderAction={(item) =>
            item.activityType === "CALL_TASK" && item.contactPhone && item.contactId
              ? <CallButton phone={item.contactPhone} contactId={item.contactId} userId={userId} />
              : null
          }
        />
```

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit 2>&1 | grep -E "nav-config|today-view"`
Expected: sin salida

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/nav-config.ts src/components/today/today-view.tsx
git commit -m "feat(agenda): item de navegación y enlace desde /hoy"
```

---

### Task 8: Gates y audit de dos modalidades

**Files:** ninguno nuevo — verificación.

El spec §5.3 documenta por qué `tsc` no basta: un componente cliente que consume una API route tipa el JSON a mano y es invisible al compilador. En la Fase 1 un bug real se escapó por ahí. Esta task lo cubre a mano.

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: PASS — **911 tests** (los 865 de partida más 46: 13 de agrupación, 14 del módulo de servidor, 19 de la ruta). Cero fallos.

- [ ] **Step 2: Typecheck — cero errores nuevos**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `2` — exactamente los dos preexistentes de `src/lib/workflows/builder-model.test.ts`. Cualquier número mayor es un fallo del gate.

Para confirmar que son esos dos y no otros:

Run: `npx tsc --noEmit 2>&1 | grep "error TS"`
Expected: ambas líneas apuntan a `src/lib/workflows/builder-model.test.ts`

- [ ] **Step 3: Build**

Run: `npx next build`
Expected: build verde, con `/agenda` listado en la tabla de rutas como dinámica (ƒ).

- [ ] **Step 4: Audit modalidad A — contratos servidor↔cliente**

Revisar a mano que cada campo que la UI lee exista en lo que el servidor manda. `tsc` sí cubre `AgendaView` porque importa los tipos de `@/lib/agenda/grouping` y `@/server/agenda`, pero **no** cubre los `fetch`:

- `quick-capture.tsx` hace `POST /api/agenda/activities` con `{ activityType, subject, dueDate? }`. Confirmar contra `captureSchema`: es `.strict()`, así que cualquier campo de más es 400. Verificar que cuando no hay fecha la clave `dueDate` se **omite** y no se manda `""` ni `null` — el `.refine()` de `dueDateSchema` convertiría `""` en un 400.
- El `<input type="date">` manda `"YYYY-MM-DD"`. Confirmar que `dueDateSchema` lo ancla a medianoche de Cancún (`T00:00:00-05:00` → `05:00Z`) y no a medianoche UTC. Si esto se rompe, una tarea capturada para mañana aparece hoy en la agenda y nadie lo nota hasta que un asesor se queja.
- `agenda-view.tsx` hace `PATCH /api/activities/${id}` con `{ status: "COMPLETADA" }`. Confirmar contra `updateActivitySchema` en `src/app/api/activities/[id]/route.ts:11-18`: `status` es un enum que incluye `COMPLETADA`.
- Ambos leen `body.error` en el camino de fallo. Confirmar que las dos rutas responden `{ error: string }` en 400/401/403/500.

- [ ] **Step 5: Audit modalidad B — click-through en la app real**

Correr `npm run dev` y recorrer, sesión de asesor:

1. `/agenda` carga sin error de hidratación en consola (la tz fija de `formatDate` y `cancunDayKey` es justo para esto).
2. Capturar una tarea **sin fecha** → aparece en "Sin fecha". Confirmar que **no** aparece en `/hoy` — es el comportamiento esperado, `today.ts:96` filtra por `dueDate <= hoy`.
3. Capturar una tarea **con fecha de ayer** → aparece en "Vencidas" y también en `/hoy`.
3b. Capturar una tarea **con la fecha de mañana** → cae en "Esta semana", **no** en "Hoy". Es la comprobación de que el anclaje a medianoche de Cancún funciona: si se hubiera usado medianoche UTC, la tarea aparecería un día antes.
4. Capturar una **nota** → aparece en "Notas recientes", no en los pendientes.
5. Completar una tarea → desaparece del listado tras el `router.refresh()`.
6. Intentar guardar con asunto de 2 caracteres → el botón está deshabilitado.
7. En `/hoy`, el bloque de tareas muestra el enlace a la agenda **aunque haya menos de 6 tareas**.
8. Sidebar: "Agenda" visible.

> Los pasos que escriben a producción los corre Luis — el clasificador de permisos bloquea esas operaciones desde aquí.

- [ ] **Step 6: Commit del plan ejecutado**

```bash
git add docs/superpowers/plans/2026-07-27-agenda-personal-fase2-ruta-agenda.md
git commit -m "docs(agenda): marcar Fase 2 como ejecutada"
```

---

## Fuera de alcance en esta fase

- **Vincular a contacto/deal/desarrollo vía `RecordLink`** — es Fase 3 (spec §6 último bullet, §10.3).
- **Grafo** — Fase 4 (§7).
- **Asistente Claude** — Fase 5 (§8). El namespace `/api/agenda/*` que estrena la Task 3 es donde vivirá `/api/agenda/chat`.
- **Calendario Google** — GW-2, fuera del spec (§9).
- **El orden de rolesets de `src/server/activities.ts:113`** — bug preexistente que deja a un ADMIN con vista de equipo. La agenda lo esquiva; arreglarlo toca `getActivities`, `getOverdueTasks` y `/api/activities`, con radio de impacto propio.
- **Reprogramar y cancelar desde `/agenda`** — `updateActivity` ya lo soporta, pero §6 solo pide completar.

---

## Registro de ejecución — 2026-07-27

Ejecutado con subagentes, revisión de spec y de calidad por task. **911/911 tests**, `tsc` con solo los 2 errores preexistentes de `builder-model.test.ts`, `next build` verde con `/agenda` como ruta dinámica.

### Defectos que el plan original traía y se corrigieron durante la ejecución

1. **`dueDate` sin hora se guardaba un día antes.** El plan usaba `z.coerce.date()`, que lee `"2026-07-30"` del `<input type="date">` como medianoche UTC — las 19:00 del 29 en Cancún. Se ancla explícitamente a medianoche de Cancún, con el offset derivado del identificador IANA en runtime en vez de escrito a mano.
2. **Fechas de calendario imposibles pasaban con rollover silencioso.** `"2026-02-30"` terminaba en el 2 de marzo. Se valida la parte `YYYY-MM-DD` contra un calendario real, **antes** y con independencia del anclaje de zona — porque "el 30 de febrero no existe" es cierto en toda zona horaria.
3. **El bucket `sin_fecha` se truncaba sistemáticamente.** El plan leía con un `take` único sobre `orderBy dueDate asc`; en Postgres los NULL van al final, así que un asesor con 200 pendientes con fecha nunca vería sus tareas sin fecha — justo el caso principal de la captura rápida. Se separó en dos queries con cupo propio, más un `count` real para que `total` no sea un número truncado disfrazado.
4. **`subject` admitía espacios en blanco.** `.min(3).max(200).trim()` validaba antes de recortar: `"   "` pasaba y se guardaba con asunto vacío. Corregido el orden.
5. **Una fecha ilegible tumbaba toda la agrupación.** `bucketFor` propagaba el `RangeError`; ahora degrada ese ítem a `sin_fecha` sin arrastrar a los demás.
6. **Un solo `busyId` para todos los completados.** Con dos clics rápidos el spinner mentía y admitía PATCH duplicados. Se rastrea cada petición en vuelo por separado.
7. **La zona horaria estaba declarada tres veces.** `format-date.ts`, `grouping.ts` y la ruta de captura tenían cada uno su literal. Se consolidó en `CANCUN_TZ`, exportada desde `format-date.ts`.

### Addendum: unificación del parseo de `dueDate` (mismo día, a petición)

El hallazgo de que otros productores de `Activity.dueDate` no anclaban a Cancún se persiguió hasta el final y destapó un bug mayor.

**Bug A — fecha sin hora.** `new Date("2026-07-30")` da medianoche UTC = 19:00 del 29 en Cancún.

**Bug B, el grave — datetime local sin offset.** `<input type="datetime-local">` produce `"2026-07-30T14:30"`, sin zona. `new Date()` lo interpreta según la zona **del proceso**:

| | `TZ=UTC` (servidor) | `TZ=America/Mexico_City` (dev) |
|---|---|---|
| `"2026-07-30T14:30"` | `14:30Z` | `20:30Z` |

El mismo input producía instantes distintos en desarrollo y en producción. Una junta puesta a las 14:30 quedaba guardada como 09:30 hora Cancún en el servidor. `src/components/pipeline/stage-transition-dialog.tsx:115,139` manda ese formato crudo.

**Regla implementada**, en `src/lib/due-date.ts` como fuente única: *si el string no trae información de zona, es hora de pared de Cancún; si la trae, se respeta*. Los formatos que no son ISO estricto se **rechazan con 400** en vez de adivinar — un primer intento los dejaba caer al parser legacy de `new Date()`, que reintroducía el Bug B justo en el webhook de Zapier, el único endpoint con entrada externa no controlada.

Aplicada en: `/api/agenda/activities`, `/api/activities`, `/api/activities/[id]` y `/api/webhooks/zapier/activities`. Las tres últimas no tenían tests; ahora sí.

Radio de impacto verificado: `activity-form.tsx` y `activity-log-form.tsx` ya mandaban `.toISOString()` y no cambian. El único flujo cuyo comportamiento se corrige es el de `stage-transition-dialog.tsx`.

### Hallazgo abierto — toca dinero

`Deal.expectedCloseDate` y `Deal.actualCloseDate` tienen el **Bug A sin corregir**: reciben `"YYYY-MM-DD"` de un `<input type="date">` y lo parsean con `z.coerce.date()`.

- `src/app/api/deals/route.ts:43`
- `src/app/api/deals/[id]/route.ts:50`

`actualCloseDate` alimenta el cálculo de comisiones. Quedó deliberadamente fuera de este trabajo: es otro modelo, otras rutas, y el radio de impacto incluye dinero ya pagado. Necesita su propia ficha.
