# Vista de contactos duplicados (detectar + fusionar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Página admin `/duplicados` que detecta contactos duplicados (email / teléfono E.164) y permite fusionarlos (repuntar relaciones, enriquecer, soft-delete + linaje).

**Architecture:** Helper puro de agrupación (union-find) + server `findDuplicateGroups`/`mergeContacts` (transacción) + 2 API admin + página `/duplicados`. Sin migración (`Contact.mergedIntoId`/`mergedFrom` ya existen).

**Tech Stack:** Next.js 14.2, Prisma 6, vitest. Sin deps nuevas.

**Spec:** `docs/superpowers/specs/2026-06-16-contactos-duplicados-design.md`

**Rama:** `feat/crm-contactos-duplicados` apilada sobre `feat/crm-shortlist-v2`.

**Hechos verificados:**
- `Contact` (schema:653): `firstName,lastName,email?,phone(req),secondaryPhone?,leadSource,leadSourceDetail?,assignedToId?,createdAt,deletedAt,originalCreatedAt?,mergedIntoId?,mergedFrom[]`.
- `normalizePhoneE164(raw): string|null` en `src/lib/phone.ts`.
- Relaciones con `contactId` → repuntar: **N (no únicas):** `prisma.deal`, `prisma.activity`, `prisma.walkIn`, `prisma.message`, `prisma.slaTimer`, `prisma.connectorLeadLog`, `prisma.conversionEvent`, `prisma.shortlist`. **1:1 UNIQUE:** `prisma.contactDossier`, `prisma.adAttribution`, `prisma.webBehavior`, `prisma.conversation`.
- RBAC: `FULL_ACCESS_ROLES = ["ADMIN","DIRECTOR","DEVELOPER_EXT","MANTENIMIENTO"]` (patrón de `/api/contacts`). Auth `getServerSession`; `session.user.role`.
- Dedup de intake (consistencia): match exacto por `phone` E.164 o `email`, excluyendo `mergedIntoId!=null` y `deletedAt!=null` (`src/lib/intake/capture-lead.ts`).

---

### Task 1: Helper puro `buildDuplicateGroups` + test (TDD)

**Files:** Create `src/lib/contacts/duplicates.ts`, Test `src/lib/contacts/duplicates.test.ts`

- [ ] **Step 1: Test** `src/lib/contacts/duplicates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildDuplicateGroups } from "./duplicates";

const c = (id: string, email: string | null, phone: string | null) => ({ id, email, phone });

describe("buildDuplicateGroups", () => {
  it("agrupa por email compartido (case-insensitive)", () => {
    const groups = buildDuplicateGroups([c("1", "A@x.com", "111"), c("2", "a@x.com", "222")]);
    expect(groups).toEqual([["1", "2"]]);
  });
  it("agrupa por teléfono normalizado compartido (521→+52)", () => {
    const groups = buildDuplicateGroups([c("1", null, "9841234567"), c("2", null, "5219841234567")]);
    expect(groups).toEqual([["1", "2"]]);
  });
  it("transitividad: A~B por email, B~C por phone → un grupo", () => {
    const groups = buildDuplicateGroups([
      c("A", "j@x.com", "9841111111"),
      c("B", "j@x.com", "9842222222"),
      c("C", null, "9842222222"),
    ]);
    expect(groups[0].sort()).toEqual(["A", "B", "C"]);
    expect(groups).toHaveLength(1);
  });
  it("ignora singletons y email/phone vacíos", () => {
    expect(buildDuplicateGroups([c("1", "u@x.com", "111"), c("2", null, null), c("3", "", "")])).toEqual([]);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/lib/contacts/duplicates.test.ts` → FAIL.

- [ ] **Step 3: Implementar** `src/lib/contacts/duplicates.ts`:
```ts
import { normalizePhoneE164 } from "@/lib/phone";

export interface DupContact {
  id: string;
  email: string | null;
  phone: string | null;
}

/** Agrupa contactos que comparten email (lower) o teléfono E.164. Devuelve grupos de tamaño >= 2. */
export function buildDuplicateGroups(contacts: DupContact[]): string[][] {
  // union-find
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };

  for (const ct of contacts) parent.set(ct.id, ct.id);

  // índices por clave → primer id visto
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const ct of contacts) {
    const email = ct.email?.trim().toLowerCase();
    if (email) {
      const prev = byEmail.get(email);
      if (prev) union(prev, ct.id); else byEmail.set(email, ct.id);
    }
    const phone = normalizePhoneE164(ct.phone);
    if (phone) {
      const prev = byPhone.get(phone);
      if (prev) union(prev, ct.id); else byPhone.set(phone, ct.id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const ct of contacts) {
    const root = find(ct.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(ct.id);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}
```

- [ ] **Step 4:** `npx vitest run src/lib/contacts/duplicates.test.ts` → PASS (4).

- [ ] **Step 5: Commit**
```bash
git add src/lib/contacts/
git commit -m "feat(dedup): helper buildDuplicateGroups (union-find email/phone) + test"
```

---

### Task 2: Server `src/server/contacts-dedup.ts`

**Files:** Create `src/server/contacts-dedup.ts`

- [ ] **Step 1: Implementar:**
```ts
import prisma from "@/lib/db";
import { buildDuplicateGroups } from "@/lib/contacts/duplicates";

export interface DupGroupContact {
  id: string; firstName: string; lastName: string;
  email: string | null; phone: string; createdAt: Date;
  assignedTo: { name: string | null } | null;
  _count: { deals: number; activities: number };
}

/** Grupos de contactos duplicados (>=2), ordenados por tamaño desc. */
export async function findDuplicateGroups(): Promise<DupGroupContact[][]> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null, mergedIntoId: null },
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true,
      assignedTo: { select: { name: true } },
      _count: { select: { deals: true, activities: true } },
    },
  });
  const byId = new Map(contacts.map((c) => [c.id, c as DupGroupContact]));
  const groups = buildDuplicateGroups(contacts.map((c) => ({ id: c.id, email: c.email, phone: c.phone })));
  return groups
    .map((ids) => ids.map((id) => byId.get(id)!).filter(Boolean))
    .sort((a, b) => b.length - a.length);
}

const N_RELATIONS = ["deal", "activity", "walkIn", "message", "slaTimer", "connectorLeadLog", "conversionEvent", "shortlist"] as const;
const ONE_TO_ONE = ["contactDossier", "adAttribution", "webBehavior", "conversation"] as const;

/** Fusiona loser→survivor: repunta relaciones, enriquece, soft-delete + linaje. Reversible. */
export async function mergeContacts(input: { survivorId: string; loserId: string }):
  Promise<{ error: string } | { survivorId: string }> {
  if (input.survivorId === input.loserId) return { error: "No se puede fusionar un contacto consigo mismo" };

  return prisma.$transaction(async (tx) => {
    const survivor = await tx.contact.findFirst({ where: { id: input.survivorId, deletedAt: null, mergedIntoId: null } });
    const loser = await tx.contact.findFirst({ where: { id: input.loserId, deletedAt: null, mergedIntoId: null } });
    if (!survivor || !loser) return { error: "Uno de los contactos no existe o ya fue fusionado/borrado" };

    // 2) Relaciones N (no únicas)
    for (const rel of N_RELATIONS) {
      await (tx as any)[rel].updateMany({ where: { contactId: input.loserId }, data: { contactId: input.survivorId } });
    }
    // 3) Relaciones 1:1 UNIQUE: repuntar solo si el survivor no tiene
    for (const rel of ONE_TO_ONE) {
      const survivorHas = await (tx as any)[rel].count({ where: { contactId: input.survivorId } });
      if (survivorHas === 0) {
        await (tx as any)[rel].updateMany({ where: { contactId: input.loserId }, data: { contactId: input.survivorId } });
      }
      // si el survivor ya tiene, se deja la del loser (colgada del loser soft-deleted)
    }
    // 4) Enriquecer campos vacíos del survivor desde el loser (sin sobrescribir)
    const enrich: Record<string, unknown> = {};
    if (!survivor.email && loser.email) enrich.email = loser.email;
    if (!survivor.secondaryPhone && loser.secondaryPhone) enrich.secondaryPhone = loser.secondaryPhone;
    if (!survivor.leadSourceDetail && loser.leadSourceDetail) enrich.leadSourceDetail = loser.leadSourceDetail;
    if (!survivor.originalCreatedAt) {
      enrich.originalCreatedAt = loser.originalCreatedAt ?? (loser.createdAt < survivor.createdAt ? loser.createdAt : survivor.createdAt);
    }
    if (Object.keys(enrich).length) await tx.contact.update({ where: { id: input.survivorId }, data: enrich });

    // 5) Marcar loser
    await tx.contact.update({ where: { id: input.loserId }, data: { mergedIntoId: input.survivorId, deletedAt: new Date() } });

    return { survivorId: input.survivorId };
  });
}
```

- [ ] **Step 2: Typecheck.** Run `npx tsc --noEmit` → sin errores en este archivo. Si algún modelo no expone `contactId` en `updateMany` (p. ej. `conversation` tiene unique compuesto), o un nombre de accessor difiere, verifícalo en `prisma/schema.prisma` y corrige (el `(tx as any)[rel]` evita fricción de tipos, pero confirma que los 12 modelos tienen el campo `contactId`). Si `originalCreatedAt`/`secondaryPhone`/`leadSourceDetail` no existen exactamente con ese nombre, ajusta el enrich a los campos reales (quita los que no existan).

- [ ] **Step 3: Commit**
```bash
git add src/server/contacts-dedup.ts
git commit -m "feat(dedup): findDuplicateGroups + mergeContacts (transacción, soft-delete + linaje)"
```

---

### Task 3: API `/api/contacts/duplicates` + `/api/contacts/merge`

**Files:** Create `src/app/api/contacts/duplicates/route.ts`, `src/app/api/contacts/merge/route.ts`

- [ ] **Step 1:** `src/app/api/contacts/duplicates/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { findDuplicateGroups } from "@/server/contacts-dedup";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const data = await findDuplicateGroups();
  return NextResponse.json({ data });
}
```

- [ ] **Step 2:** `src/app/api/contacts/merge/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { mergeContacts } from "@/server/contacts-dedup";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (!body?.survivorId || !body?.loserId) {
      return NextResponse.json({ error: "survivorId y loserId son requeridos" }, { status: 400 });
    }
    const result = await mergeContacts({ survivorId: body.survivorId, loserId: body.loserId });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ data: result });
  } catch (e) {
    console.error("[POST /api/contacts/merge]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → sin errores.

- [ ] **Step 4: Commit**
```bash
git add src/app/api/contacts/duplicates/ src/app/api/contacts/merge/
git commit -m "feat(dedup): API duplicates (GET) + merge (POST), admin-only"
```

---

### Task 4: Página `/duplicados` + sidebar

**Files:** Create `src/app/(dashboard)/duplicados/page.tsx`, `src/components/contacts/duplicados-client.tsx`; Modify sidebar.

- [ ] **Step 1: Server page** `src/app/(dashboard)/duplicados/page.tsx`:
```tsx
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { DuplicadosClient } from "@/components/contacts/duplicados-client";

export const dynamic = "force-dynamic";
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];

export default async function DuplicadosPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) redirect("/dashboard");
  return <DuplicadosClient />;
}
```

- [ ] **Step 2: Client** `src/components/contacts/duplicados-client.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

interface Ct {
  id: string; firstName: string; lastName: string; email: string | null; phone: string;
  createdAt: string; assignedTo: { name: string | null } | null;
  _count: { deals: number; activities: number };
}

export function DuplicadosClient() {
  const [groups, setGroups] = useState<Ct[][]>([]);
  const [loading, setLoading] = useState(true);
  const [survivors, setSurvivors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/contacts/duplicates");
    const json = await res.json();
    setGroups(json.data ?? []);
    // default: el de más actividad (deals+activities), luego el más antiguo
    const def: Record<number, string> = {};
    (json.data ?? []).forEach((g: Ct[], idx: number) => {
      const best = [...g].sort((a, b) =>
        (b._count.deals + b._count.activities) - (a._count.deals + a._count.activities) ||
        (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()))[0];
      def[idx] = best.id;
    });
    setSurvivors(def);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function mergeGroup(idx: number, group: Ct[]) {
    const survivorId = survivors[idx];
    if (!survivorId) return;
    const losers = group.filter((c) => c.id !== survivorId);
    if (!window.confirm(`Fusionar ${losers.length} contacto(s) en el seleccionado? Esto es reversible (soft-delete).`)) return;
    setBusy(true);
    for (const l of losers) {
      const res = await fetch("/api/contacts/merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivorId, loserId: l.id }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Error al fusionar"); break; }
    }
    setBusy(false);
    await load();
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Contactos duplicados</h1>
        <p className="text-[13px] text-[color:var(--text-tertiary)]">Agrupados por email o teléfono. Elige el sobreviviente y fusiona.</p>
      </div>

      {loading ? (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">No se detectaron duplicados.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g, idx) => (
            <div key={idx} className="rounded-lg border p-4" style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[color:var(--text-secondary)]">{g.length} posibles duplicados</span>
                <button className="btn-primary text-xs disabled:opacity-40" disabled={busy} onClick={() => mergeGroup(idx, g)}>Fusionar en el seleccionado</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 rounded border p-2 text-[13px]" style={{ borderColor: "var(--border-subtle)" }}>
                    <input type="radio" name={`surv-${idx}`} checked={survivors[idx] === c.id} onChange={() => setSurvivors((s) => ({ ...s, [idx]: c.id }))} className="mt-1" />
                    <span>
                      <span className="font-medium text-[color:var(--text-primary)]">{c.firstName} {c.lastName}</span>
                      <span className="block text-[color:var(--text-tertiary)]">{c.email ?? "sin email"} · {c.phone}</span>
                      <span className="block text-[color:var(--text-tertiary)]">{c._count.deals} deals · {c._count.activities} act. · {c.assignedTo?.name ?? "sin asesor"}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Sidebar.** Agregar item a `/duplicados` ("Duplicados", icono lucide `Users` o `Copy`) en el grupo admin/Dirección, replicando la estructura existente; con `roles: ["ADMIN","DIRECTOR"]` (los que ven la utilidad). Si el sidebar filtra por roles, úsalo; ADMIN ya pasa.

- [ ] **Step 4:** `npx tsc --noEmit` → sin errores. Confirmar clases B/N reales (`crm-card`/`btn-primary`/vars) como en los otros componentes.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(dashboard)/duplicados/" src/components/contacts/duplicados-client.tsx <sidebar>
git commit -m "feat(dedup): página /duplicados (detección + fusión) + nav"
```

---

### Task 5: Verificación + smoke

- [ ] **Step 1:** `npx vitest run` → verde (previos + 4 nuevos).
- [ ] **Step 2:** `npm run build` → exit 0; aparecen `/duplicados`, `/api/contacts/duplicates`, `/api/contacts/merge`.
- [ ] **Step 3: Smoke local con CONTACTOS DE PRUEBA** (NO datos reales): crear 2 contactos con el mismo email (o teléfono); abrir `/duplicados` → aparece el grupo; agregar un Deal/Activity al loser; elegir sobreviviente; Fusionar → confirmar que el Deal/Activity quedó repuntado al sobreviviente y el loser tiene `deletedAt`+`mergedIntoId` (vía Prisma Studio o una query). Verificar que el loser desaparece de la lista de contactos.
- [ ] **Step 4:** Limpiar los contactos de prueba.

---

## Self-Review
- Cobertura §5.10.2: detección → Task 1+2; vista → Task 4; fusión → Task 2 (mergeContacts) + Task 3 (API) + Task 4 (UI). ✅
- Sin migración (mergedIntoId/mergedFrom existen). ✅
- Tipos: `buildDuplicateGroups` (Task 1) usado en Task 2; `findDuplicateGroups`/`mergeContacts` (Task 2) consumidos por API (Task 3) y UI (Task 4). Payload merge coincide. ✅
- 1:1 UNIQUE: repunte condicional (skip si survivor ya tiene) evita violar unique. Documentado.
- Reversibilidad: soft-delete + mergedIntoId. Smoke solo con datos de prueba. Recomendar review de Luis antes de uso real.
- A confirmar en impl.: los 12 modelos exponen `contactId` en updateMany; nombres reales de campos enrich (originalCreatedAt/secondaryPhone/leadSourceDetail) — instruido en Task 2 Step 2.
