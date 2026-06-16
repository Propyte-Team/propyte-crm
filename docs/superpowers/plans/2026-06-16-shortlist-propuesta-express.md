# Shortlist "Propuesta express" (v1 núcleo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un asesor arme una lista curada de unidades del Hub en un Contacto/Deal, genere un microsite público `/p/[token]` y vea aperturas/vistas.

**Architecture:** 3 tablas nuevas en `propyte_crm` (Shortlist/ShortlistItem/ShortlistView), capa server pura + orquestación con Prisma, API REST estilo `/api/quotes`, página pública clon de `/q/[id]`, panel UI B/N montado en contacto y deal. El CRM no posee inventario: solo referencias `hubUnitId` + snapshot congelado del Hub.

**Tech Stack:** Next.js 14.2 (App Router), Prisma 6 + Supabase Postgres (esquema `propyte_crm`), next-auth, vitest. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-06-16-shortlist-propuesta-express-design.md`

**Convención de tests del repo:** solo se testean funciones PURAS (ver `src/lib/activities/permissions.test.ts`). Las funciones que tocan Prisma/Hub se verifican por `next build` + smoke local, NO por unit test (no hay mocks de Prisma en el repo). El plan respeta eso: Task 2 testea helpers puros; el resto se cubre con build + smoke.

---

### Task 1: Schema Prisma + SQL de migración (additivo, NO aplicado)

**Files:**
- Modify: `prisma/schema.prisma` (agregar enum + 3 modelos + 3 relaciones inversas)
- Create: `prisma/migrations-manual/2026-06-16-shortlist.sql`

- [ ] **Step 1: Agregar enum y modelos al final del bloque de modelos de `prisma/schema.prisma`** (junto a `Quote`/`DealDocument`, antes del cierre del archivo):

```prisma
enum ShortlistStatus {
  DRAFT
  SENT
  OPENED

  @@schema("propyte_crm")
}

// Propuesta express: lista curada de unidades del Hub enviable por link público.
// El CRM NO posee inventario — solo refs hubUnitId + snapshot congelado (P1, §5.11.4).
model Shortlist {
  id          String          @id @default(uuid())
  token       String          @unique
  contactId   String
  contact     Contact         @relation(fields: [contactId], references: [id])
  dealId      String?
  deal        Deal?           @relation(fields: [dealId], references: [id])
  createdById String
  createdBy   User            @relation("ShortlistsCreated", fields: [createdById], references: [id])
  title       String          @default("Propuesta de unidades")
  status      ShortlistStatus @default(DRAFT)
  sentAt      DateTime?
  openedAt    DateTime?
  expiresAt   DateTime?
  items       ShortlistItem[]
  views       ShortlistView[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  deletedAt   DateTime?

  @@index([contactId])
  @@index([dealId])
  @@map("shortlists")
  @@schema("propyte_crm")
}

model ShortlistItem {
  id          String    @id @default(uuid())
  shortlistId String
  shortlist   Shortlist @relation(fields: [shortlistId], references: [id], onDelete: Cascade)
  hubUnitId   String
  snapshot    Json      @default("{}")
  note        String?   @db.Text
  sortOrder   Int       @default(0)
  createdAt   DateTime  @default(now())

  @@index([shortlistId])
  @@map("shortlist_items")
  @@schema("propyte_crm")
}

model ShortlistView {
  id          String    @id @default(uuid())
  shortlistId String
  shortlist   Shortlist @relation(fields: [shortlistId], references: [id], onDelete: Cascade)
  viewedAt    DateTime  @default(now())
  userAgent   String?

  @@index([shortlistId])
  @@map("shortlist_views")
  @@schema("propyte_crm")
}
```

- [ ] **Step 2: Agregar relaciones inversas** en los modelos existentes `Contact`, `Deal`, `User`. Localiza cada modelo y agrega, junto a sus otras relaciones de listas:

En `model Contact { ... }`:
```prisma
  shortlists Shortlist[]
```
En `model Deal { ... }`:
```prisma
  shortlists Shortlist[]
```
En `model User { ... }` (junto a `quotesCreated`/relaciones nombradas existentes):
```prisma
  shortlistsCreated Shortlist[] @relation("ShortlistsCreated")
```

- [ ] **Step 3: Crear el SQL de migración** `prisma/migrations-manual/2026-06-16-shortlist.sql` (additivo + idempotente):

```sql
-- Shortlist "Propuesta express" v1 — additivo, idempotente. NO toca tablas existentes.
-- Aplicar SOLO con OK explícito de Luis ("aplica la migración shortlist").

DO $$ BEGIN
  CREATE TYPE propyte_crm."ShortlistStatus" AS ENUM ('DRAFT', 'SENT', 'OPENED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS propyte_crm.shortlists (
  id           text PRIMARY KEY,
  token        text NOT NULL UNIQUE,
  "contactId"  text NOT NULL REFERENCES propyte_crm.contacts(id),
  "dealId"     text REFERENCES propyte_crm.deals(id),
  "createdById" text NOT NULL REFERENCES propyte_crm.users(id),
  title        text NOT NULL DEFAULT 'Propuesta de unidades',
  status       propyte_crm."ShortlistStatus" NOT NULL DEFAULT 'DRAFT',
  "sentAt"     timestamp(3),
  "openedAt"   timestamp(3),
  "expiresAt"  timestamp(3),
  "createdAt"  timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"  timestamp(3) NOT NULL DEFAULT now(),
  "deletedAt"  timestamp(3)
);
CREATE INDEX IF NOT EXISTS "shortlists_contactId_idx" ON propyte_crm.shortlists("contactId");
CREATE INDEX IF NOT EXISTS "shortlists_dealId_idx" ON propyte_crm.shortlists("dealId");

CREATE TABLE IF NOT EXISTS propyte_crm.shortlist_items (
  id            text PRIMARY KEY,
  "shortlistId" text NOT NULL REFERENCES propyte_crm.shortlists(id) ON DELETE CASCADE,
  "hubUnitId"   text NOT NULL,
  snapshot      jsonb NOT NULL DEFAULT '{}',
  note          text,
  "sortOrder"   integer NOT NULL DEFAULT 0,
  "createdAt"   timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "shortlist_items_shortlistId_idx" ON propyte_crm.shortlist_items("shortlistId");

CREATE TABLE IF NOT EXISTS propyte_crm.shortlist_views (
  id            text PRIMARY KEY,
  "shortlistId" text NOT NULL REFERENCES propyte_crm.shortlists(id) ON DELETE CASCADE,
  "viewedAt"    timestamp(3) NOT NULL DEFAULT now(),
  "userAgent"   text
);
CREATE INDEX IF NOT EXISTS "shortlist_views_shortlistId_idx" ON propyte_crm.shortlist_views("shortlistId");
```

- [ ] **Step 4: Validar el schema y regenerar el cliente**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

Run: `npx prisma generate --no-engine`
Expected: `Generated Prisma Client` (el flag `--no-engine` evita el bloqueo de DLL en Windows; ver memoria).

- [ ] **Step 5: Commit** (la migración NO se aplica a la BD en este task)

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-06-16-shortlist.sql
git commit -m "feat(shortlist): schema Prisma + SQL aditivo (no aplicado)"
```

---

### Task 2: Helpers puros + tests (TDD)

**Files:**
- Create: `src/lib/shortlists/token.ts`
- Create: `src/lib/shortlists/snapshot.ts`
- Test: `src/lib/shortlists/shortlists-helpers.test.ts`

- [ ] **Step 1: Escribir el test que falla** `src/lib/shortlists/shortlists-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateShortlistToken } from "./token";
import { buildUnitSnapshot, nextSortOrder, shouldMarkOpened } from "./snapshot";
import type { HubUnit } from "@/lib/hub/types";

describe("generateShortlistToken", () => {
  it("genera tokens no vacíos y únicos", () => {
    const a = generateShortlistToken();
    const b = generateShortlistToken();
    expect(a.length).toBeGreaterThan(16);
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });
});

describe("buildUnitSnapshot", () => {
  it("congela los campos relevantes de la unidad del Hub", () => {
    const unit: HubUnit = {
      id: "u1", developmentId: "d1", numero: "101", titulo: "PH Azul",
      tipo: "Departamento", tipologia: "2R", recamaras: 2, banos: 2,
      m2Construccion: 95, m2Total: 110, precioMxn: 5200000, precioUsd: null,
      moneda: "MXN", status: "DISPONIBLE",
    };
    const snap = buildUnitSnapshot(unit);
    expect(snap.hubUnitId).toBe("u1");
    expect(snap.titulo).toBe("PH Azul");
    expect(snap.precioMxn).toBe(5200000);
    expect(snap.moneda).toBe("MXN");
  });
});

describe("nextSortOrder", () => {
  it("devuelve 0 para lista vacía y max+1 si hay items", () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 3 }])).toBe(4);
  });
});

describe("shouldMarkOpened", () => {
  it("true solo si openedAt es null", () => {
    expect(shouldMarkOpened({ openedAt: null })).toBe(true);
    expect(shouldMarkOpened({ openedAt: new Date() })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/shortlists/shortlists-helpers.test.ts`
Expected: FAIL — "Cannot find module './token'" / "./snapshot".

- [ ] **Step 3: Implementar `src/lib/shortlists/token.ts`**

```ts
import { randomBytes } from "crypto";

/** Token público de la shortlist (URL /p/[token]). 16 bytes → base64url. */
export function generateShortlistToken(): string {
  return randomBytes(16).toString("base64url");
}
```

- [ ] **Step 4: Implementar `src/lib/shortlists/snapshot.ts`**

```ts
import type { HubUnit } from "@/lib/hub/types";

/** Datos del Hub congelados al agregar la unidad a la shortlist. */
export interface UnitSnapshot {
  hubUnitId: string;
  developmentId: string | null;
  numero: string | null;
  titulo: string | null;
  tipo: string | null;
  tipologia: string | null;
  recamaras: number | null;
  banos: number | null;
  m2Construccion: number | null;
  m2Total: number | null;
  precioMxn: number | null;
  precioUsd: number | null;
  moneda: string;
  status: string | null;
}

export function buildUnitSnapshot(u: HubUnit): UnitSnapshot {
  return {
    hubUnitId: u.id,
    developmentId: u.developmentId,
    numero: u.numero,
    titulo: u.titulo,
    tipo: u.tipo,
    tipologia: u.tipologia,
    recamaras: u.recamaras,
    banos: u.banos,
    m2Construccion: u.m2Construccion,
    m2Total: u.m2Total,
    precioMxn: u.precioMxn,
    precioUsd: u.precioUsd,
    moneda: u.moneda,
    status: u.status,
  };
}

export function nextSortOrder(items: { sortOrder: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1;
}

export function shouldMarkOpened(shortlist: { openedAt: Date | null }): boolean {
  return shortlist.openedAt == null;
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/shortlists/shortlists-helpers.test.ts`
Expected: PASS (4 describes verdes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/shortlists/
git commit -m "feat(shortlist): helpers puros (token, snapshot, sortOrder) + tests"
```

---

### Task 3: Capa server `src/server/shortlists.ts`

**Files:**
- Create: `src/server/shortlists.ts`

- [ ] **Step 1: Implementar la capa server** `src/server/shortlists.ts`:

```ts
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getHubUnit } from "@/lib/hub/client";
import { generateShortlistToken } from "@/lib/shortlists/token";
import { buildUnitSnapshot, nextSortOrder, shouldMarkOpened } from "@/lib/shortlists/snapshot";

export async function createShortlist(input: {
  contactId: string;
  dealId?: string | null;
  createdById: string;
  title?: string;
}) {
  const shortlist = await prisma.shortlist.create({
    data: {
      token: generateShortlistToken(),
      contactId: input.contactId,
      dealId: input.dealId ?? null,
      createdById: input.createdById,
      ...(input.title ? { title: input.title } : {}),
    },
  });
  return { shortlist };
}

export async function addItem(input: {
  shortlistId: string;
  hubUnitId: string;
  note?: string | null;
}) {
  const unit = await getHubUnit(input.hubUnitId);
  if (!unit) return { error: "La unidad no existe en el Hub" as const };

  const existing = await prisma.shortlistItem.findMany({
    where: { shortlistId: input.shortlistId },
    select: { sortOrder: true },
  });

  const item = await prisma.shortlistItem.create({
    data: {
      shortlistId: input.shortlistId,
      hubUnitId: input.hubUnitId,
      snapshot: buildUnitSnapshot(unit) as unknown as Prisma.InputJsonValue,
      note: input.note ?? null,
      sortOrder: nextSortOrder(existing),
    },
  });
  return { item };
}

export async function removeItem(itemId: string) {
  await prisma.shortlistItem.delete({ where: { id: itemId } });
  return { ok: true as const };
}

export async function updateItemNote(itemId: string, note: string | null) {
  const item = await prisma.shortlistItem.update({ where: { id: itemId }, data: { note } });
  return { item };
}

export async function reorderItems(orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.shortlistItem.update({ where: { id }, data: { sortOrder: idx } })
    )
  );
  return { ok: true as const };
}

export async function updateShortlistTitle(id: string, title: string) {
  const shortlist = await prisma.shortlist.update({ where: { id }, data: { title } });
  return { shortlist };
}

export async function sendShortlist(id: string) {
  const shortlist = await prisma.shortlist.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date() },
  });
  return { shortlist };
}

export async function getShortlistsFor(filter: { contactId?: string; dealId?: string }) {
  return prisma.shortlist.findMany({
    where: {
      deletedAt: null,
      ...(filter.contactId ? { contactId: filter.contactId } : {}),
      ...(filter.dealId ? { dealId: filter.dealId } : {}),
    },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      _count: { select: { views: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getShortlistByToken(token: string) {
  return prisma.shortlist.findFirst({
    where: { token, deletedAt: null },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      contact: { select: { firstName: true, lastName: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
}

export async function recordView(shortlistId: string, userAgent?: string | null) {
  const sl = await prisma.shortlist.findUnique({
    where: { id: shortlistId },
    select: { openedAt: true, status: true },
  });
  await prisma.shortlistView.create({ data: { shortlistId, userAgent: userAgent ?? null } });
  if (sl && shouldMarkOpened(sl)) {
    await prisma.shortlist.update({
      where: { id: shortlistId },
      data: { openedAt: new Date(), ...(sl.status === "SENT" ? { status: "OPENED" } : {}) },
    });
  }
  return { ok: true as const };
}

export async function softDeleteShortlist(id: string) {
  await prisma.shortlist.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true as const };
}
```

- [ ] **Step 2: Typecheck del módulo vía build parcial** (no hay test unit por convención del repo)

Run: `npx tsc --noEmit`
Expected: sin errores en `src/server/shortlists.ts`. (Si `tsc` no está como script, usa `npx vitest run` que también typechequea los imports del helper test; el typecheck completo se hace en Task 7 con `next build`.)

- [ ] **Step 3: Commit**

```bash
git add src/server/shortlists.ts
git commit -m "feat(shortlist): capa server (CRUD items, send, tracking de vistas)"
```

---

### Task 4: API REST `/api/shortlists`

**Files:**
- Create: `src/app/api/shortlists/route.ts`
- Create: `src/app/api/shortlists/[id]/route.ts`
- Create: `src/app/api/shortlists/[id]/items/route.ts`
- Create: `src/app/api/shortlists/[id]/items/[itemId]/route.ts`

- [ ] **Step 1: `src/app/api/shortlists/route.ts`** (listar + crear):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { createShortlist, getShortlistsFor } from "@/server/shortlists";

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const contactId = request.nextUrl.searchParams.get("contactId") ?? undefined;
  const dealId = request.nextUrl.searchParams.get("dealId") ?? undefined;
  if (!contactId && !dealId) {
    return NextResponse.json({ error: "contactId o dealId es requerido" }, { status: 400 });
  }
  const data = await getShortlistsFor({ contactId, dealId });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!body?.contactId) return NextResponse.json({ error: "contactId es requerido" }, { status: 400 });
    const { shortlist } = await createShortlist({
      contactId: body.contactId,
      dealId: body.dealId ?? null,
      createdById: session.user.id,
      title: body.title,
    });
    return NextResponse.json({ data: shortlist }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/shortlists]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
```

- [ ] **Step 2: `src/app/api/shortlists/[id]/route.ts`** (enviar / renombrar / borrar). `params` SÍNCRONO (convención del repo):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { sendShortlist, updateShortlistTitle, softDeleteShortlist } from "@/server/shortlists";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (body?.action === "send") {
      const { shortlist } = await sendShortlist(params.id);
      return NextResponse.json({ data: shortlist });
    }
    if (typeof body?.title === "string") {
      const { shortlist } = await updateShortlistTitle(params.id, body.title);
      return NextResponse.json({ data: shortlist });
    }
    return NextResponse.json({ error: "Acción no soportada" }, { status: 400 });
  } catch (e) {
    console.error("[PATCH /api/shortlists/[id]]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  await softDeleteShortlist(params.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `src/app/api/shortlists/[id]/items/route.ts`** (agregar unidad):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { addItem } from "@/server/shortlists";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!body?.hubUnitId) return NextResponse.json({ error: "hubUnitId es requerido" }, { status: 400 });
    const result = await addItem({ shortlistId: params.id, hubUnitId: body.hubUnitId, note: body.note ?? null });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ data: result.item }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/shortlists/[id]/items]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
```

- [ ] **Step 4: `src/app/api/shortlists/[id]/items/[itemId]/route.ts`** (nota / borrar item):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { removeItem, updateItemNote } from "@/server/shortlists";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const { item } = await updateItemNote(params.itemId, body?.note ?? null);
  return NextResponse.json({ data: item });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  await removeItem(params.itemId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/shortlists/
git commit -m "feat(shortlist): API REST (crear/listar/enviar/items)"
```

---

### Task 5: Página pública `/p/[token]`

**Files:**
- Create: `src/app/p/[token]/page.tsx`

> Nota: el matcher del middleware (`src/middleware.ts`) NO incluye `/p`, así que la ruta es pública por defecto (igual que `/q`). No hay que tocar el middleware.

- [ ] **Step 1: Implementar la landing pública** `src/app/p/[token]/page.tsx` (clon del patrón de `/q/[id]`):

```tsx
// Microsite público de la propuesta express (§5.11.4). Sin auth (fuera del matcher del
// middleware). Registra una vista al abrir. Clon del patrón de /q/[id].
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getShortlistByToken, recordView } from "@/server/shortlists";
import type { UnitSnapshot } from "@/lib/shortlists/snapshot";

export const dynamic = "force-dynamic";

function money(n: number | null | undefined, currency = "MXN") {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export default async function PublicShortlistPage({ params }: { params: { token: string } }) {
  const shortlist = await getShortlistByToken(params.token).catch(() => null);
  if (!shortlist) notFound();

  // Tracking de apertura (no debe romper el render si falla).
  const ua = headers().get("user-agent");
  await recordView(shortlist.id, ua).catch(() => null);

  const contactName = shortlist.contact
    ? `${shortlist.contact.firstName} ${shortlist.contact.lastName}`
    : "Cliente";
  const advisor = shortlist.createdBy;

  return (
    <main style={{ background: "#FAFAFA", minHeight: "100vh", color: "#0A0A0A", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #E5E5E5", paddingBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>Propyte</div>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>Propuesta</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#888" }}>
            <div>Para: {contactName}</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 24 }}>{shortlist.title}</h1>

        <section style={{ marginTop: 16, display: "grid", gap: 16 }}>
          {shortlist.items.map((item) => {
            const s = (item.snapshot && typeof item.snapshot === "object" ? item.snapshot : {}) as Partial<UnitSnapshot>;
            const currency = s.moneda ?? "MXN";
            const price = currency === "USD" ? s.precioUsd : s.precioMxn;
            const specs = [
              s.tipo,
              s.recamaras ? `${s.recamaras} rec` : null,
              s.banos ? `${s.banos} baños` : null,
              s.m2Construccion ? `${s.m2Construccion} m²` : null,
            ].filter(Boolean).join(" · ");
            return (
              <article key={item.id} style={{ border: "1px solid #E5E5E5", borderRadius: 8, padding: 16, background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{s.titulo ?? s.numero ?? "Unidad"}</div>
                    <div style={{ color: "#555", fontSize: 14, marginTop: 2 }}>{specs || "—"}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap" }}>{money(price, currency)}</div>
                </div>
                {item.note && <p style={{ marginTop: 10, fontSize: 13, color: "#444" }}>{item.note}</p>}
              </article>
            );
          })}
          {shortlist.items.length === 0 && (
            <div style={{ color: "#888", fontSize: 14 }}>Esta propuesta aún no tiene unidades.</div>
          )}
        </section>

        {advisor && (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`Hola, me interesa la propuesta "${shortlist.title}".`)}`}
            style={{ display: "inline-block", marginTop: 24, background: "#0A0A0A", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none", fontSize: 14, fontWeight: 600 }}
          >
            Hablar con mi asesor por WhatsApp
          </a>
        )}

        <footer style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #E5E5E5", fontSize: 11, color: "#aaa" }}>
          {advisor && <div style={{ marginBottom: 6 }}>Tu asesor: {advisor.name}{advisor.email ? ` · ${advisor.email}` : ""}</div>}
          Documento informativo sin valor contractual. Precios y disponibilidad sujetos a cambio y a confirmación del desarrollador. Propyte.
        </footer>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/p/
git commit -m "feat(shortlist): microsite público /p/[token] con tracking de vistas"
```

---

### Task 6: Panel UI `ShortlistPanel` + montaje en contacto y deal

**Files:**
- Create: `src/components/shortlists/shortlist-panel.tsx`
- Modify: `src/components/contacts/contact-detail.tsx` (montar el panel donde está `ActivityLog`)
- Modify: `src/components/pipeline/deal-detail-client.tsx` (montar el panel donde está `ActivityLog`)

- [ ] **Step 1: Implementar `src/components/shortlists/shortlist-panel.tsx`** (client component, B/N, optimistic en agregar/quitar):

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

interface HubUnitLite {
  id: string;
  titulo: string | null;
  numero: string | null;
  tipo: string | null;
  precioMxn: number | null;
  moneda: string;
}
interface ShortlistItemLite {
  id: string;
  hubUnitId: string;
  note: string | null;
  snapshot: { titulo?: string | null; numero?: string | null; tipo?: string | null; precioMxn?: number | null; moneda?: string };
}
interface ShortlistLite {
  id: string;
  token: string;
  title: string;
  status: "DRAFT" | "SENT" | "OPENED";
  openedAt: string | null;
  items: ShortlistItemLite[];
  _count?: { views: number };
}

function money(n: number | null | undefined, currency = "MXN") {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export function ShortlistPanel({ contactId, dealId }: { contactId: string; dealId?: string }) {
  const [lists, setLists] = useState<ShortlistLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ShortlistLite | null>(null);

  // Buscador de unidades del Hub.
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<HubUnitLite[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams(dealId ? { dealId } : { contactId });
    const res = await fetch(`/api/shortlists?${qs.toString()}`);
    const json = await res.json();
    setLists(json.data ?? []);
    setLoading(false);
  }, [contactId, dealId]);

  useEffect(() => { load(); }, [load]);

  async function createList() {
    const res = await fetch("/api/shortlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, dealId: dealId ?? null }),
    });
    const json = await res.json();
    if (json.data) { setActive({ ...json.data, items: [], _count: { views: 0 } }); await load(); }
  }

  async function searchUnits(q: string) {
    setSearch(q);
    if (q.trim().length < 2) { setResults([]); return; }
    const res = await fetch(`/api/hub/units?search=${encodeURIComponent(q)}&onlyAvailable=true&limit=20`);
    const json = await res.json();
    setResults(json.data ?? json.units ?? []);
  }

  async function addUnit(u: HubUnitLite) {
    if (!active) return;
    // Optimistic.
    const optimistic: ShortlistItemLite = {
      id: `tmp-${u.id}`, hubUnitId: u.id, note: null,
      snapshot: { titulo: u.titulo, numero: u.numero, tipo: u.tipo, precioMxn: u.precioMxn, moneda: u.moneda },
    };
    setActive({ ...active, items: [...active.items, optimistic] });
    const res = await fetch(`/api/shortlists/${active.id}/items`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hubUnitId: u.id }),
    });
    if (!res.ok) { setActive((a) => a && { ...a, items: a.items.filter((i) => i.id !== optimistic.id) }); return; }
    await refreshActive(active.id);
  }

  async function removeUnit(itemId: string) {
    if (!active) return;
    const prev = active.items;
    setActive({ ...active, items: active.items.filter((i) => i.id !== itemId) });
    const res = await fetch(`/api/shortlists/${active.id}/items/${itemId}`, { method: "DELETE" });
    if (!res.ok) setActive((a) => a && { ...a, items: prev });
  }

  async function refreshActive(id: string) {
    const qs = new URLSearchParams(dealId ? { dealId } : { contactId });
    const res = await fetch(`/api/shortlists?${qs.toString()}`);
    const json = await res.json();
    const found = (json.data ?? []).find((s: ShortlistLite) => s.id === id);
    if (found) setActive(found);
    setLists(json.data ?? []);
  }

  async function generateLink() {
    if (!active) return;
    await fetch(`/api/shortlists/${active.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send" }),
    });
    const url = `${window.location.origin}/p/${active.token}`;
    await navigator.clipboard.writeText(url).catch(() => null);
    alert(`Link copiado:\n${url}`);
    await load();
    await refreshActive(active.id);
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">Propuestas express</h3>
        <button className="btn-secondary text-xs" onClick={createList}>Nueva propuesta</button>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">Cargando…</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {lists.map((s) => (
            <li key={s.id}>
              <button
                className="flex w-full items-center justify-between rounded border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--bg)]"
                onClick={() => refreshActive(s.id)}
              >
                <span>{s.title} <span className="text-[var(--text-muted)]">· {s.items.length} unidades</span></span>
                <span className="text-xs text-[var(--text-muted)]">
                  {s.status === "DRAFT" ? "Borrador" : s.status === "SENT" ? "Enviada" : "Abierta"}
                  {s._count ? ` · ${s._count.views} vistas` : ""}
                </span>
              </button>
            </li>
          ))}
          {lists.length === 0 && <li className="text-sm text-[var(--text-muted)]">Aún no hay propuestas.</li>}
        </ul>
      )}

      {active && (
        <div className="mt-4 rounded border border-[var(--border)] p-3">
          <div className="flex items-center justify-between">
            <strong className="text-sm">{active.title}</strong>
            <button className="btn-primary text-xs" onClick={generateLink}>Generar y copiar link</button>
          </div>

          <ul className="mt-3 space-y-1">
            {active.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between text-sm">
                <span>{i.snapshot?.titulo ?? i.snapshot?.numero ?? "Unidad"} · {money(i.snapshot?.precioMxn, i.snapshot?.moneda ?? "MXN")}</span>
                <button className="text-xs text-[var(--text-muted)] hover:underline" onClick={() => removeUnit(i.id)}>Quitar</button>
              </li>
            ))}
          </ul>

          <div className="mt-3">
            <input
              className="form-input w-full text-sm"
              placeholder="Buscar unidad del Hub…"
              value={search}
              onChange={(e) => searchUnits(e.target.value)}
            />
            {results.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                {results.map((u) => (
                  <li key={u.id}>
                    <button
                      className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-[var(--bg)]"
                      onClick={() => addUnit(u)}
                    >
                      <span>{u.titulo ?? u.numero ?? "Unidad"} · {u.tipo ?? ""}</span>
                      <span className="text-[var(--text-muted)]">{money(u.precioMxn, u.moneda)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Montar en `contact-detail.tsx`** — localiza dónde se monta `<ActivityLog ...>` y agrega justo después:

```tsx
import { ShortlistPanel } from "@/components/shortlists/shortlist-panel";
// ...
<ShortlistPanel contactId={contact.id} />
```

- [ ] **Step 3: Montar en `deal-detail-client.tsx`** — localiza dónde se monta `<ActivityLog ...>` y agrega justo después (pasa contacto + deal):

```tsx
import { ShortlistPanel } from "@/components/shortlists/shortlist-panel";
// ...
<ShortlistPanel contactId={deal.contactId} dealId={deal.id} />
```

> Verifica el nombre real de la prop del contacto en el deal (p. ej. `deal.contactId` o `deal.contact.id`) leyendo el componente; usa el que exista.

- [ ] **Step 4: Verificar que las clases B/N existen** (`form-input`, `btn-primary`, `btn-secondary`, vars `--border`/`--bg`/`--bg-elevated`/`--text-muted`). Si alguna var no existe en `globals.css`, sustitúyela por la equivalente que sí use `ActivityLog` (abre `activity-log.tsx` y copia las clases que usa).

- [ ] **Step 5: Commit**

```bash
git add src/components/shortlists/ src/components/contacts/contact-detail.tsx src/components/pipeline/deal-detail-client.tsx
git commit -m "feat(shortlist): ShortlistPanel + montaje en contacto y deal"
```

---

### Task 7: Verificación + gate de migración + smoke local

**Files:** ninguno (verificación)

- [ ] **Step 1: Suite completa de tests**

Run: `npx vitest run`
Expected: todo verde (los ~85 previos + los 4 nuevos del helper).

- [ ] **Step 2: Build limpio**

Run: `npm run build`
Expected: build exit 0, sin errores de tipo. (Compila aunque la migración no esté aplicada — los tipos vienen de `prisma generate`, no de la BD.)

- [ ] **Step 3: GATE — pedir a Luis autorización para aplicar la migración**

NO aplicar nada todavía. Mensaje a Luis:
> "Build + tests verdes. Para probar en local necesito crear las 3 tablas en la Supabase compartida (`2026-06-16-shortlist.sql`, additivo, riesgo nulo). ¿Aplico la migración shortlist?"

Esperar el "aplica la migración shortlist".

- [ ] **Step 4: Aplicar migración (sólo tras OK) vía MCP Supabase**

Aplicar el contenido de `prisma/migrations-manual/2026-06-16-shortlist.sql` en el proyecto `oaijxdpevakashxshhvm` (MCP `apply_migration` o `execute_sql`). Luego:

Run: `npx prisma generate --no-engine`

- [ ] **Step 5: Smoke local**

Run: `npm run dev` (puerto local, p. ej. 3001).
Manualmente: abrir un Contacto → "Nueva propuesta" → buscar y agregar 2 unidades → "Generar y copiar link" → abrir `/p/[token]` en incógnito → volver al panel y confirmar que `vistas` subió y el estado pasó a "Abierta".
Expected: el flujo completo funciona; la apertura no dispara workflows (las tablas nuevas no tienen automation_rules).

- [ ] **Step 6: Commit final / actualizar memoria** (si aplica, vía /save al cierre).

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** §4 modelo → Task 1. §5 server → Task 3. §6 API → Task 4. §7 página pública → Task 5. §8 UI → Task 6. §9 pruebas → Task 2 (puras) + Task 7 (build/smoke). Gate de migración (§4/§10) → Task 7 Step 3-4. ✅
- **Fuera de alcance v1 (PDF, promover-a-Quote, intro IA, matching) explícitamente no incluido** — coherente con la decisión del usuario.
- **Consistencia de tipos:** `buildUnitSnapshot`/`nextSortOrder`/`shouldMarkOpened` definidos en Task 2 y usados con la misma firma en Task 3. `UnitSnapshot` reusado en Task 5. `getShortlistByToken`/`recordView` definidos en Task 3 y consumidos en Task 5. Rutas API consumidas por el panel en Task 6 coinciden con Task 4. ✅
- **Reorder:** `reorderItems` existe en server (Task 3) pero la UI v1 no lo expone — follow-up consciente, no bloquea el núcleo.
