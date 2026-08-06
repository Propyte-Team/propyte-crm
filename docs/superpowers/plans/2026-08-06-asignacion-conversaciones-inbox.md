# Asignación de conversaciones del Inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asignar/reclamar conversaciones del Inbox vía `Contact.assignedToId`, con auto-claim al responder, notificación in-app, y cierre de dos fugas de aislamiento (search y envío sin gate).

**Architecture:** Módulo puro `src/lib/inbox/assign.ts` con permisos adentro (mando vs claim), invocado por la acción `assign` de la ruta de acciones (resuelta ANTES del gate genérico, como `mark_spam`) y por el auto-claim del envío manual. Constantes de rol unificadas en `src/lib/inbox/roles.ts`. Cero migraciones (`Notification.type` es String; `Contact.assignedToId` ya existe).

**Tech Stack:** Next.js 14 App Router · Prisma · Vitest (mocks `vi.mock("@/lib/db")`) · zod

**Spec:** `docs/superpowers/specs/2026-08-06-asignacion-conversaciones-inbox-design.md`
**Worktree:** `.claude/worktrees/inbox-asignacion` (rama `feat/inbox-asignacion`, base `main@4010740`, baseline 1323 tests verdes)

**Convenciones del repo que DEBES seguir:**
- Comentarios y mensajes de error en español, concisos, explicando el porqué.
- Tests: mocks con `vi.fn()` capturados en consts fuera de `vi.mock` (ver `src/app/api/conversations/[id]/actions/route.test.ts:1-59` como plantilla).
- Side-effects post-escritura SIEMPRE en try/catch — jamás tumban la operación (lección 2026-07-24).
- Correr un test puntual: `npx vitest run <ruta> --reporter=dot` · suite completa: `npm test`.
- Commits en español, prefijo `feat(inbox):` / `fix(inbox):` / `test(inbox):`.

---

### Task 1: Constantes de rol — `src/lib/inbox/roles.ts`

**Files:**
- Create: `src/lib/inbox/roles.ts`
- Test: `src/lib/inbox/roles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/inbox/roles.test.ts
import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import { INBOX_FULL_VIEW, INBOX_MANAGERS, isInboxManager, hasInboxFullView } from "./roles";

describe("roles del inbox", () => {
  it("toda constante es subconjunto del enum UserRole (anti-typo)", () => {
    const valid = new Set(Object.values(UserRole));
    for (const r of [...INBOX_FULL_VIEW, ...INBOX_MANAGERS]) {
      expect(valid.has(r as UserRole), `rol desconocido: ${r}`).toBe(true);
    }
  });

  it("TEAM_LEADER es mando (reparte la cola) pero NO tiene vista completa", () => {
    expect(INBOX_MANAGERS).toContain("TEAM_LEADER");
    expect(INBOX_FULL_VIEW).not.toContain("TEAM_LEADER");
  });

  it("los tres roles de dirección están en ambos sets", () => {
    for (const r of ["ADMIN", "DIRECTOR", "GERENTE"]) {
      expect(INBOX_FULL_VIEW).toContain(r);
      expect(INBOX_MANAGERS).toContain(r);
    }
  });

  it("helpers", () => {
    expect(isInboxManager("TEAM_LEADER")).toBe(true);
    expect(isInboxManager("ASESOR_SR")).toBe(false);
    expect(hasInboxFullView("GERENTE")).toBe(true);
    expect(hasInboxFullView("TEAM_LEADER")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/inbox/roles.test.ts --reporter=dot`
Expected: FAIL — `Cannot find module './roles'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/inbox/roles.ts
// Roles del Inbox — DOS sets a propósito (no unificar):
// - FULL_VIEW: quién ve TODO el inbox en la lista. TEAM_LEADER queda FUERA
//   deliberadamente: sigue viendo solo sus hilos + sin asignar (cero ampliación
//   de alcance, lección del reorden RBAC de af41c4f).
// - MANAGERS: quién ejecuta acciones de mando (asignar/reasignar/quitar, takeover
//   de hilos ajenos). TEAM_LEADER SÍ está: reparte la cola "sin asignar" a su
//   equipo sin que se le amplíe la vista.
export const INBOX_FULL_VIEW = ["ADMIN", "DIRECTOR", "GERENTE"] as const;
export const INBOX_MANAGERS = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"] as const;

export function hasInboxFullView(role: string): boolean {
  return (INBOX_FULL_VIEW as readonly string[]).includes(role);
}

export function isInboxManager(role: string): boolean {
  return (INBOX_MANAGERS as readonly string[]).includes(role);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/inbox/roles.test.ts --reporter=dot`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox/roles.ts src/lib/inbox/roles.test.ts
git commit -m "feat(inbox): constantes de rol INBOX_FULL_VIEW / INBOX_MANAGERS"
```

---

### Task 2: Módulo núcleo — `src/lib/inbox/assign.ts`

**Files:**
- Create: `src/lib/inbox/assign.ts`
- Test: `src/lib/inbox/assign.test.ts`

Reglas (spec §3): mando asigna/reasigna/quita a cualquier usuario activo sin email `.local`;
no-mando solo *claim* (a sí mismo, contacto libre). Escritura con lock optimista dentro de
`withChangeSource`. Side-effects (Activity + Notification) en try/catch.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/inbox/assign.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const userFindFirst = vi.fn();
const activityCreate = vi.fn();
const notificationCreate = vi.fn();
const txContactUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));

// withChangeSource: capturamos opts y corremos fn con un tx falso que expone contact.update
const changeSourceCalls: unknown[] = [];
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: async (opts: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    changeSourceCalls.push(opts);
    return fn({ contact: { update: (...a: unknown[]) => txContactUpdate(...a) } });
  },
}));

import { assignContact } from "./assign";

const MANDO = { id: "boss-1", role: "GERENTE" } as const;
const ASESOR = { id: "ase-1", role: "ASESOR_SR" } as const;
const CONTACTO_LIBRE = {
  id: "c1", assignedToId: null, updatedAt: new Date("2026-08-06T00:00:00Z"),
  firstName: "Ana", lastName: "López",
};
const USUARIO_OK = { id: "ase-2", name: "Pedro Ruiz", email: "pedro@propyte.com" };

beforeEach(() => {
  [contactFindFirst, userFindFirst, activityCreate, notificationCreate, txContactUpdate]
    .forEach((m) => m.mockReset());
  changeSourceCalls.length = 0;
  contactFindFirst.mockResolvedValue(CONTACTO_LIBRE);
  userFindFirst.mockResolvedValue(USUARIO_OK);
  txContactUpdate.mockResolvedValue({});
  activityCreate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
});

describe("assignContact — permisos", () => {
  it("mando asigna a un usuario válido: update + Notification + Activity", async () => {
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO, conversationId: "conv-1" });
    expect(r).toEqual({ ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" } });
    expect(txContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", updatedAt: CONTACTO_LIBRE.updatedAt }, // lock optimista
        data: { assignedToId: "ase-2" },
      })
    );
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "ase-2",
          type: "conversation_assigned",
          link: "/inbox?focus=conv-1",
        }),
      })
    );
    expect(activityCreate).toHaveBeenCalled();
  });

  it("mando reasigna un contacto que ya tenía dueño", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "otro" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r.ok).toBe(true);
  });

  it("mando quita la asignación (null): sin Notification", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "otro" });
    const r = await assignContact({ contactId: "c1", assigneeId: null, actor: MANDO });
    expect(r).toEqual({ ok: true, assignedTo: null });
    expect(txContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedToId: null } })
    );
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(userFindFirst).not.toHaveBeenCalled(); // no valida usuario al desasignar
  });

  it("asesor reclama contacto libre: ok y SIN Notification (es para sí mismo)", async () => {
    userFindFirst.mockResolvedValue({ id: "ase-1", name: "Luisa", email: "l@propyte.com" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r.ok).toBe(true);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("asesor reclama contacto ya asignado a OTRO → ya-asignado, sin update", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "otro" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r).toEqual({ ok: false, code: "ya-asignado" });
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("asesor reclama un contacto que YA es suyo → ok idempotente sin escribir", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "ase-1" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r.ok).toBe(true);
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("asesor intenta asignar a un tercero → sin-permiso", async () => {
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: ASESOR });
    expect(r).toEqual({ ok: false, code: "sin-permiso" });
  });

  it("asesor intenta desasignar → sin-permiso", async () => {
    const r = await assignContact({ contactId: "c1", assigneeId: null, actor: ASESOR });
    expect(r).toEqual({ ok: false, code: "sin-permiso" });
  });
});

describe("assignContact — validación del asignado", () => {
  it("usuario inexistente o inactivo → usuario-invalido", async () => {
    userFindFirst.mockResolvedValue(null);
    const r = await assignContact({ contactId: "c1", assigneeId: "nadie", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "usuario-invalido" });
  });

  it("usuario con email .local (QA) → usuario-invalido, también a mano (espíritu AUD-09)", async () => {
    userFindFirst.mockResolvedValue({ id: "qa-1", name: "QA", email: "qa-asesor@propyte.local" });
    const r = await assignContact({ contactId: "c1", assigneeId: "qa-1", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "usuario-invalido" });
  });
});

describe("assignContact — contacto y concurrencia", () => {
  it("contacto inexistente o borrado → no-existe (el findFirst filtra deletedAt)", async () => {
    contactFindFirst.mockResolvedValue(null);
    const r = await assignContact({ contactId: "cX", assigneeId: "ase-2", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "no-existe" });
    expect(contactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    );
  });

  it("update falla por lock optimista → conflicto", async () => {
    txContactUpdate.mockRejectedValue(new Error("P2025"));
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "conflicto" });
  });
});

describe("assignContact — cronología y side-effects", () => {
  it("usa source inbox_assign por default y el override inbox_autoclaim", async () => {
    await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(changeSourceCalls[0]).toEqual({ source: "inbox_assign", actorId: "boss-1" });

    userFindFirst.mockResolvedValue({ id: "ase-1", name: "Luisa", email: "l@propyte.com" });
    await assignContact({
      contactId: "c1", assigneeId: "ase-1",
      actor: ASESOR, source: "inbox_autoclaim",
    });
    expect(changeSourceCalls[1]).toEqual({ source: "inbox_autoclaim", actorId: "ase-1" });
  });

  it("si Notification o Activity revientan, la operación sigue siendo ok", async () => {
    notificationCreate.mockRejectedValue(new Error("boom"));
    activityCreate.mockRejectedValue(new Error("boom"));
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/inbox/assign.test.ts --reporter=dot`
Expected: FAIL — `Cannot find module './assign'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/inbox/assign.ts
// Asignación de conversaciones (spec 2026-08-06): el dueño vive en
// Contact.assignedToId — asignar en el inbox = asignar el contacto en todo el CRM.
// Permisos ADENTRO del módulo (la ruta solo mapea códigos a HTTP):
//   mando (INBOX_MANAGERS) → asigna / reasigna / quita a cualquier usuario válido
//   no-mando → solo claim: a sí mismo y solo si el contacto está libre
import prisma from "@/lib/db";
import { withChangeSource } from "@/lib/audit/change-context";
import { isInboxManager } from "./roles";

export const ASSIGN_NOTIFICATION_TYPE = "conversation_assigned";

export type AssignResult =
  | { ok: true; assignedTo: { id: string; name: string } | null }
  | { ok: false; code: "sin-permiso" | "ya-asignado" | "no-existe" | "usuario-invalido" | "conflicto" };

export async function assignContact(opts: {
  contactId: string;
  assigneeId: string | null;
  actor: { id: string; role: string };
  conversationId?: string | null;
  source?: "inbox_assign" | "inbox_autoclaim";
}): Promise<AssignResult> {
  const { contactId, assigneeId, actor } = opts;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    select: { id: true, assignedToId: true, updatedAt: true, firstName: true, lastName: true },
  });
  if (!contact) return { ok: false, code: "no-existe" };

  const manager = isInboxManager(actor.role);
  if (!manager) {
    // No-mando: solo claim a sí mismo sobre contacto libre.
    if (assigneeId !== actor.id) return { ok: false, code: "sin-permiso" };
    if (contact.assignedToId === actor.id) {
      // Ya era suyo: idempotente, sin escribir (cubre carreras del auto-claim).
      return { ok: true, assignedTo: { id: actor.id, name: "" } };
    }
    if (contact.assignedToId !== null) return { ok: false, code: "ya-asignado" };
  }

  // Validar al asignado: activo y sin email .local — los usuarios QA no reciben
  // leads ni a mano (espíritu del gate anti-test AUD-09 del routing).
  let assignee: { id: string; name: string } | null = null;
  if (assigneeId !== null) {
    const user = await prisma.user.findFirst({
      where: { id: assigneeId, isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (!user || user.email.endsWith(".local")) return { ok: false, code: "usuario-invalido" };
    assignee = { id: user.id, name: user.name };
  }

  // Escritura con lock optimista sobre el updatedAt leído: si el contacto cambió
  // entre lectura y update (otro claim ganó), el update no matchea → conflicto.
  try {
    await withChangeSource(
      { source: opts.source ?? "inbox_assign", actorId: actor.id },
      (tx) =>
        tx.contact.update({
          where: { id: contact.id, updatedAt: contact.updatedAt },
          data: { assignedToId: assigneeId },
        })
    );
  } catch {
    return { ok: false, code: "conflicto" };
  }

  // Side-effects: jamás tumban la operación (lección 2026-07-24).
  const contactName = `${contact.firstName} ${contact.lastName}`.trim();
  const subject =
    assigneeId === null
      ? "Quitó la asignación de la conversación"
      : assigneeId === actor.id
        ? "Reclamó la conversación"
        : `Asignó la conversación a ${assignee?.name ?? assigneeId}`;
  try {
    await prisma.activity.create({
      data: {
        contactId: contact.id,
        userId: actor.id,
        activityType: "NOTE",
        subject,
        status: "COMPLETADA",
        completedAt: new Date(),
      },
    });
  } catch { /* side-effect: silencioso */ }

  if (assignee && assignee.id !== actor.id) {
    try {
      await prisma.notification.create({
        data: {
          userId: assignee.id,
          type: ASSIGN_NOTIFICATION_TYPE,
          title: "Conversación asignada",
          message: `Te asignaron la conversación con ${contactName || "un contacto"}`,
          link: opts.conversationId ? `/inbox?focus=${opts.conversationId}` : "/inbox",
        },
      });
    } catch { /* side-effect: silencioso */ }
  }

  return { ok: true, assignedTo: assignee };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/inbox/assign.test.ts --reporter=dot`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox/assign.ts src/lib/inbox/assign.test.ts
git commit -m "feat(inbox): assignContact — asignar/reclamar con lock optimista, cronología y notificación"
```

---

### Task 3: Acción `assign` en la ruta de acciones

**Files:**
- Modify: `src/app/api/conversations/[id]/actions/route.ts`
- Test: `src/app/api/conversations/[id]/actions/route.test.ts` (agregar `describe` nuevo)

La acción se resuelve **ANTES del gate genérico owner|manager** (mismo patrón que `mark_spam`
y por la razón espejo: un hilo sin asignar no tiene dueño y el gate daría 403 al claim).
El permiso real lo decide `assignContact`. Tests en las 2 direcciones
(feedback_accion_destructiva_hereda_gate_ajeno).

- [ ] **Step 1: Write the failing tests** (agregar al final de `route.test.ts` existente; el mock de `@/lib/db` de ese archivo ya existe — solo agrega el mock del módulo nuevo junto a los otros `vi.mock` del top)

```ts
// junto a los otros vi.mock del top del archivo:
const assignContact = vi.fn();
vi.mock("@/lib/inbox/assign", () => ({
  assignContact: (...a: unknown[]) => assignContact(...a),
}));
// y agrega `assignContact` al array del mockReset() del beforeEach.

// al final del archivo:
describe("POST assign", () => {
  it("se resuelve ANTES del gate genérico: asesor NO dueño puede intentar claim", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    // hilo cuyo contacto es de OTRO — el gate genérico habría dado 403 antes de llegar
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: true, assignedTo: { id: "ase-1", name: "Luisa" } });
    const res = await POST(req({ action: "assign", assigneeId: "ase-1" }), PARAMS);
    expect(res.status).toBe(200);
    expect(assignContact).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c1",
        assigneeId: "ase-1",
        actor: { id: "ase-1", role: "ASESOR_SR" },
        conversationId: "conv-1",
      })
    );
  });

  it("la dirección contraria sigue cerrada: sin-permiso del módulo → 403", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: false, code: "sin-permiso" });
    const res = await POST(req({ action: "assign", assigneeId: "ase-9" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it.each([
    ["ya-asignado", 409],
    ["no-existe", 404],
    ["usuario-invalido", 422],
    ["conflicto", 409],
  ])("mapea %s → %i", async (code, status) => {
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: false, code });
    const res = await POST(req({ action: "assign", assigneeId: "ase-2" }), PARAMS);
    expect(res.status).toBe(status);
  });

  it("assigneeId ausente → 400 (null explícito sí es válido: desasignar)", async () => {
    const res = await POST(req({ action: "assign" }), PARAMS);
    expect(res.status).toBe(400);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("assigneeId null llega al módulo como null", async () => {
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: true, assignedTo: null });
    const res = await POST(req({ action: "assign", assigneeId: null }), PARAMS);
    expect(res.status).toBe(200);
    expect(assignContact).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: null }));
  });

  it("conversación inexistente → 404", async () => {
    convFindUnique.mockResolvedValue(null);
    const res = await POST(req({ action: "assign", assigneeId: "ase-2" }), PARAMS);
    expect(res.status).toBe(404);
  });
});
```

Nota: el `convFindUnique` de assign usa `select { id, contactId }` (no el `include` del gate
genérico) — el mock no distingue, pero la implementación abajo hace su PROPIO findUnique.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "src/app/api/conversations/[id]/actions/route.test.ts" --reporter=dot`
Expected: FAIL — zod rechaza `action: "assign"` (400 ≠ 200) en los tests nuevos; los viejos siguen verdes.

- [ ] **Step 3: Implement** (en `route.ts`)

3a. Schema — reemplazar `actionSchema`:

```ts
const actionSchema = z.object({
  action: z.enum(["takeover", "release", "close", "snooze", "toggle_bot", "mark_spam", "assign"]),
  until: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
  // string = asignar/reclamar · null = quitar asignación · ausente solo válido si action ≠ assign
  assigneeId: z.string().min(1).nullable().optional(),
});
```

3b. Bloque `assign` — insertar DESPUÉS del bloque `mark_spam` (línea ~70) y ANTES del
`prisma.conversation.findUnique` del gate genérico:

```ts
  // assign se resuelve ANTES del gate genérico a propósito: un hilo sin asignar no
  // tiene dueño (el gate daría 403 al claim). El permiso real vive en assignContact.
  if (parsed.data.action === "assign") {
    if (parsed.data.assigneeId === undefined) {
      return NextResponse.json({ error: "Falta assigneeId (id de usuario o null)" }, { status: 400 });
    }
    const conv = await prisma.conversation.findUnique({
      where: { id: params.id },
      select: { id: true, contactId: true },
    });
    if (!conv) return NextResponse.json({ error: "No existe" }, { status: 404 });

    const { assignContact } = await import("@/lib/inbox/assign");
    const result = await assignContact({
      contactId: conv.contactId,
      assigneeId: parsed.data.assigneeId,
      actor: { id: session.user.id, role: session.user.role },
      conversationId: conv.id,
    });
    if (!result.ok) {
      const httpByCode = { "sin-permiso": 403, "ya-asignado": 409, "no-existe": 404, "usuario-invalido": 422, "conflicto": 409 } as const;
      const msgByCode = {
        "sin-permiso": "No tienes permiso para asignar este hilo",
        "ya-asignado": "El contacto ya está asignado a otro asesor",
        "no-existe": "No existe",
        "usuario-invalido": "El usuario elegido no está activo",
        "conflicto": "El hilo cambió, recarga",
      } as const;
      return NextResponse.json({ error: msgByCode[result.code] }, { status: httpByCode[result.code] });
    }
    return NextResponse.json({ data: { assignedTo: result.assignedTo } });
  }
```

3c. Unificar el set de mando: reemplazar la constante local
`const MANAGER_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];` por

```ts
import { INBOX_MANAGERS } from "@/lib/inbox/roles";
```

y usar `INBOX_MANAGERS.includes(session.user.role as never)` donde se usaba `MANAGER_ROLES`
(o `(INBOX_MANAGERS as readonly string[]).includes(session.user.role)` — elegir la forma que
tsc acepte sin `any`). El set es idéntico → cero cambio de comportamiento.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "src/app/api/conversations/[id]/actions/route.test.ts" --reporter=dot`
Expected: PASS (todos, viejos + 9 nuevos)

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/conversations/[id]/actions/route.ts" "src/app/api/conversations/[id]/actions/route.test.ts"
git commit -m "feat(inbox): acción assign en la ruta de acciones, resuelta antes del gate genérico"
```

---

### Task 4: Gate de envío + auto-claim en messages

**Files:**
- Modify: `src/app/api/conversations/[id]/messages/route.ts`
- Test: `src/app/api/conversations/[id]/messages/route.test.ts` (agregar `describe` nuevo)

Único cambio de comportamiento existente (aprobado por Luis): enviar en un hilo asignado a
OTRO siendo no-mando → 403. Notas internas ni gatean ni reclaman. Mando no auto-reclama.

- [ ] **Step 1: Write the failing tests** (agregar al test existente; revisa sus mocks actuales — ya mockea `@/lib/db`, `@/lib/auth/session` y `@/lib/messaging/dispatcher`; agrega el mock de assign)

```ts
// junto a los otros vi.mock del top:
const assignContact = vi.fn();
vi.mock("@/lib/inbox/assign", () => ({
  assignContact: (...a: unknown[]) => assignContact(...a),
}));
// agrega assignContact al mockReset del beforeEach y por default:
// assignContact.mockResolvedValue({ ok: true, assignedTo: null });

// El conv mockeado necesita contact.assignedToId — actualiza el fixture base del archivo
// para incluirlo (null por default) SIN romper los tests viejos.

describe("gate de asignación + auto-claim", () => {
  it("403 si el contacto es de OTRO y el remitente no es mando", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue(convWith({ assignedToId: "otro" }));
    const res = await POST(req({ body: "hola" }), PARAMS);
    expect(res.status).toBe(403);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("mando escribe en hilo ajeno sin reclamarlo", async () => {
    getServerSession.mockResolvedValue({ user: { id: "boss-1", role: "GERENTE" } });
    convFindUnique.mockResolvedValue(convWith({ assignedToId: "otro" }));
    const res = await POST(req({ body: "hola" }), PARAMS);
    expect(res.status).toBe(201);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("mando en hilo LIBRE tampoco reclama (triagea sin quedarse el lead)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "boss-1", role: "GERENTE" } });
    convFindUnique.mockResolvedValue(convWith({ assignedToId: null }));
    const res = await POST(req({ body: "hola" }), PARAMS);
    expect(res.status).toBe(201);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("asesor en hilo libre: envía Y auto-reclama con source inbox_autoclaim", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue(convWith({ assignedToId: null }));
    const res = await POST(req({ body: "hola" }), PARAMS);
    expect(res.status).toBe(201);
    expect(assignContact).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: "ase-1",
        source: "inbox_autoclaim",
      })
    );
  });

  it("nota interna en hilo ajeno: ni gate ni claim", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue(convWith({ assignedToId: "otro" }));
    const res = await POST(req({ body: "nota", internalNote: true }), PARAMS);
    expect(res.status).toBe(201);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("claim fallido NO revierte el envío (201 igual)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue(convWith({ assignedToId: null }));
    assignContact.mockRejectedValue(new Error("boom"));
    const res = await POST(req({ body: "hola" }), PARAMS);
    expect(res.status).toBe(201);
  });
});
```

`convWith(overrides)` es un helper local del describe que clona el fixture base del archivo
y mezcla `contact: { ...base.contact, ...overrides }`. Escríbelo según el shape real del
fixture existente en ese archivo (léelo primero).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "src/app/api/conversations/[id]/messages/route.test.ts" --reporter=dot`
Expected: FAIL — el gate no existe (201 donde se espera 403) y `assignContact` nunca se llama.

- [ ] **Step 3: Implement** (en `messages/route.ts`)

3a. El `select` del contacto (línea ~37) agrega `assignedToId`:

```ts
    include: { contact: { select: { id: true, phone: true, doNotContact: true, assignedToId: true } } },
```

3b. Import arriba:

```ts
import { isInboxManager } from "@/lib/inbox/roles";
```

3c. Gate — insertar DESPUÉS del bloque de nota interna (que retorna temprano, línea ~60)
y ANTES del check `doNotContact`:

```ts
  // Aislamiento: un hilo asignado a otro asesor no acepta envíos de no-mando.
  // La lista nunca le mostró este hilo; esto cierra el acceso por URL directa.
  const esMando = isInboxManager(session.user.role);
  if (conv.contact.assignedToId && conv.contact.assignedToId !== session.user.id && !esMando) {
    return NextResponse.json({ error: "El contacto está asignado a otro asesor" }, { status: 403 });
  }
```

3d. Auto-claim — insertar DESPUÉS del bloque de takeover suave (`if (conv.status === "BOT")...`, línea ~87)
y ANTES del `return` final:

```ts
  // Auto-claim: el primer no-mando que responde un hilo libre se queda el contacto.
  // Post-envío y best-effort: si el claim pierde una carrera, el mensaje ya salió
  // y el siguiente envío re-evalúa. Mando NO reclama (triagea sin quedarse leads).
  if (!conv.contact.assignedToId && !esMando) {
    try {
      const { assignContact } = await import("@/lib/inbox/assign");
      await assignContact({
        contactId: conv.contact.id,
        assigneeId: session.user.id,
        actor: { id: session.user.id, role: session.user.role },
        conversationId: conv.id,
        source: "inbox_autoclaim",
      });
    } catch { /* best-effort */ }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "src/app/api/conversations/[id]/messages/route.test.ts" --reporter=dot`
Expected: PASS (viejos + 6 nuevos)

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/conversations/[id]/messages/route.ts" "src/app/api/conversations/[id]/messages/route.test.ts"
git commit -m "feat(inbox): gate de envío por dueño + auto-claim al responder hilo libre"
```

---

### Task 5: Fix de la fuga del search en la lista

**Files:**
- Modify: `src/app/api/conversations/route.ts`
- Test: Create `src/app/api/conversations/route.test.ts`

Bug actual (líneas 39-48): el search hace `where.contact = { ...(where.contact), OR: [búsqueda] }`
— pisa el `OR` del aislamiento por rol → un asesor que busca ve hilos ajenos. Fix: componer
con `AND`. Los filtros `mine`/`unassigned` también entran al `AND` (hoy REEMPLAZAN el scope).

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/conversations/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const convFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { conversation: { findMany: (...a: unknown[]) => convFindMany(...a) } },
}));

import { GET } from "./route";

function req(qs = "") {
  return { nextUrl: new URL(`http://x/api/conversations${qs}`) } as never;
}

beforeEach(() => {
  [getServerSession, convFindMany].forEach((m) => m.mockReset());
  convFindMany.mockResolvedValue([]);
});

const ASESOR = { user: { id: "ase-1", role: "ASESOR_SR" } };
const GERENTE = { user: { id: "boss-1", role: "GERENTE" } };

function whereUsed() {
  return convFindMany.mock.calls[0][0].where;
}

describe("GET /api/conversations — aislamiento", () => {
  it("asesor sin search: scope suyos + sin asignar", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req());
    expect(whereUsed().contact).toEqual({
      AND: [{ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] }],
    });
  });

  it("REGRESIÓN fuga: asesor CON search conserva el scope (AND de ambos OR)", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?q=ana"));
    const contact = whereUsed().contact;
    expect(contact.AND).toHaveLength(2);
    expect(contact.AND[0]).toEqual({ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] });
    expect(contact.AND[1].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ firstName: expect.anything() }),
        expect.objectContaining({ phone: expect.anything() }),
      ])
    );
  });

  it("gerente con search: solo la condición de búsqueda, sin scope", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET(req("?q=ana"));
    expect(whereUsed().contact.AND).toHaveLength(1);
  });

  it("gerente sin filtros: contact queda undefined", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET(req());
    expect(whereUsed().contact).toBeUndefined();
  });

  it("TEAM_LEADER NO tiene vista completa: lleva scope", async () => {
    getServerSession.mockResolvedValue({ user: { id: "tl-1", role: "TEAM_LEADER" } });
    await GET(req());
    expect(whereUsed().contact.AND[0]).toEqual({
      OR: [{ assignedToId: "tl-1" }, { assignedToId: null }],
    });
  });

  it("filtro mine compone con el scope del asesor", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?filter=mine"));
    expect(whereUsed().contact.AND).toEqual(
      expect.arrayContaining([{ assignedToId: "ase-1" }])
    );
  });

  it("filtro unassigned + search componen (3 condiciones para asesor)", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?filter=unassigned&q=ana"));
    expect(whereUsed().contact.AND).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/conversations/route.test.ts --reporter=dot`
Expected: FAIL — el shape actual no usa `AND` (y el test de regresión expone la fuga).

- [ ] **Step 3: Implement** — en `route.ts` reemplazar el bloque de construcción del `where`
(líneas 18-48) por:

```ts
import { hasInboxFullView } from "@/lib/inbox/roles";
// (reemplaza la constante local MANAGER_ROLES, que se elimina)

  const where: Prisma.ConversationWhereInput = { status: { not: "CLOSED" } };

  // El where.contact se COMPONE con AND — nunca sobreescribir: el search pisaba
  // el OR del aislamiento y un asesor buscando veía hilos ajenos (fuga, ago-2026).
  const contactConds: Prisma.ContactWhereInput[] = [];

  // Alcance por rol: asesores (y TEAM_LEADER) ven sus contactos + sin asignar
  if (!hasInboxFullView(session.user.role)) {
    contactConds.push({ OR: [{ assignedToId: session.user.id }, { assignedToId: null }] });
  }

  if (filter === "mine") {
    contactConds.push({ assignedToId: session.user.id });
  } else if (filter === "unassigned") {
    contactConds.push({ assignedToId: null });
  } else if (filter === "bot") {
    where.status = "BOT";
  } else if (filter === "human") {
    where.status = "HUMAN";
  } else if (filter === "unread") {
    where.unreadCount = { gt: 0 };
  }

  if (search) {
    contactConds.push({
      OR: [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    });
  }

  if (contactConds.length > 0) where.contact = { AND: contactConds };
```

- [ ] **Step 4: Run tests + suite completa**

Run: `npx vitest run src/app/api/conversations/route.test.ts --reporter=dot` → PASS (7 tests)
Run: `npm test` → PASS (nada más se rompió)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/conversations/route.ts src/app/api/conversations/route.test.ts
git commit -m "fix(inbox): el search componía sobre el scope por rol y lo pisaba — fuga de hilos ajenos"
```

---

### Task 6: UI — chip de asignación en el hilo + badge en la lista

**Files:**
- Create: `src/components/inbox/assign-control.tsx`
- Modify: `src/components/inbox/inbox-view.tsx`

Sin tests de render (el repo no tiene; se verifica con gates + smoke). ANTES de tocar
`inbox-view.tsx` lee el archivo completo — es grande y tiene tipos locales (`Thread`,
`ConversationListItem` o similares) que hay que extender con `assignedTo`.

- [ ] **Step 1: Crear el componente**

```tsx
// src/components/inbox/assign-control.tsx
// Chip de asignación del hilo. El dueño vive en Contact.assignedToId:
//   mando → menú con usuarios activos + "Quitar asignación"
//   no-mando → "Reclamar" si el hilo está libre; chip informativo si es suyo
"use client";

import { useEffect, useRef, useState } from "react";
import { UserPlus, ChevronDown } from "lucide-react";
import { isInboxManager } from "@/lib/inbox/roles";

interface AssignControlProps {
  assignedTo: { id: string; name: string } | null;
  userId: string;
  userRole: string;
  onAssign: (assigneeId: string | null) => Promise<void>;
}

export function AssignControl({ assignedTo, userId, userRole, onAssign }: AssignControlProps) {
  const manager = isInboxManager(userRole);
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cargar usuarios solo al abrir el menú (lazy) — /api/users ya scopea por rol
  useEffect(() => {
    if (!open || users !== null) return;
    fetch("/api/users?basic=true&isActive=true")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setUsers((d.data ?? d.users ?? []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))))
      .catch(() => setUsers([]));
  }, [open, users]);

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function pick(assigneeId: string | null) {
    setBusy(true);
    try {
      await onAssign(assigneeId);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  // No-mando
  if (!manager) {
    if (!assignedTo) {
      return (
        <button className="btn-secondary !py-1.5 !px-3 text-[12px]" disabled={busy} onClick={() => pick(userId)}>
          <UserPlus className="h-3.5 w-3.5" /> Reclamar
        </button>
      );
    }
    return (
      <span className="badge badge-neutral whitespace-nowrap" title="Dueño del contacto">
        {assignedTo.id === userId ? "Asignado a ti" : `Asignado a ${assignedTo.name}`}
      </span>
    );
  }

  // Mando: chip que abre menú
  return (
    <div className="relative" ref={ref}>
      <button
        className="btn-secondary !py-1.5 !px-3 text-[12px]"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title="Asignar la conversación"
      >
        <UserPlus className="h-3.5 w-3.5" />
        {assignedTo ? `Asignado a ${assignedTo.name}` : "Sin asignar"}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg py-1 shadow-lg"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
        >
          {users === null && (
            <p className="px-3 py-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>Cargando…</p>
          )}
          {users?.map((u) => (
            <button
              key={u.id}
              className="block w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:opacity-80"
              style={{ color: "var(--text-primary)", fontWeight: u.id === assignedTo?.id ? 700 : 400 }}
              onClick={() => pick(u.id)}
            >
              {u.name}
            </button>
          ))}
          {assignedTo && (
            <button
              className="block w-full px-3 py-1.5 text-left text-[12px]"
              style={{ color: "var(--color-error)", borderTop: "1px solid var(--border-subtle)" }}
              onClick={() => pick(null)}
            >
              Quitar asignación
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

⚠ Ajusta el shape de la respuesta de `/api/users?basic=true` a lo que la ruta devuelve DE
VERDAD (léela: `src/app/api/users/route.ts`, modo `basic`) — el `d.data ?? d.users` de arriba
es defensivo pero fija el campo correcto y elimina el otro.

- [ ] **Step 2: Integrar en `inbox-view.tsx`**

2a. Tipos: agrega `assignedTo: { id: string; name: string } | null` al tipo del `contact`
del hilo Y de los items de la lista (ambas APIs ya lo devuelven — verifícalo en los tipos
locales del archivo y NO dupliques si ya existe).

2b. Handler junto a `doAction` (línea ~344):

```tsx
  async function doAssign(assigneeId: string | null) {
    if (!selectedId) return;
    const res = await fetch(`/api/conversations/${selectedId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", assigneeId }),
    });
    if (res.ok) {
      await loadThread(selectedId);
      await loadList();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "No se pudo asignar");
    }
  }
```

2c. Render en la banda de estado del hilo — dentro del `div` de acciones
(`className="flex items-center gap-1.5"`, línea ~537), ANTES del botón "Tomar control":

```tsx
                <AssignControl
                  assignedTo={thread.contact.assignedTo ?? null}
                  userId={userId}
                  userRole={userRole}
                  onAssign={doAssign}
                />
```

(+ `import { AssignControl } from "./assign-control";` arriba.)

2d. Badge en la lista — en el item (junto al badge del canal, línea ~497):

```tsx
                    {!c.contact.assignedTo && (
                      <span className="badge badge-warning !text-[10px] !py-0 whitespace-nowrap">Sin asignar</span>
                    )}
```

⚠ Verifica que la clase `badge-warning` exista en `globals.css`; si no, usa `badge-neutral`
(el rediseño B/N solo permite color en etiquetas de etapa — ver memoria del rediseño jun-2026).

- [ ] **Step 3: Gates de compilación**

Run: `npx tsc --noEmit` → cero errores nuevos
Run: `npm test` → PASS
Expected: verde en ambos.

- [ ] **Step 4: Commit**

```bash
git add src/components/inbox/assign-control.tsx src/components/inbox/inbox-view.tsx
git commit -m "feat(inbox): chip de asignación en el hilo + badge Sin asignar en la lista"
```

---

### Task 7: Gates finales

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa** — `npm test` → todos verdes (esperados: 1323 base + ~36 nuevos)
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → cero errores nuevos
- [ ] **Step 3: Lint** — `npm run lint` → 0 errores (los 2 warnings de `react-hooks/exhaustive-deps` preexistentes se quedan)
- [ ] **Step 4: Build** — `npm run build` → exit 0
- [ ] **Step 5: Commit final si hubo ajustes**

```bash
git add -u && git commit -m "chore(inbox): ajustes de gates (tsc/lint/build)"
```

**NO pushear ni mergear a main** — el push es el deploy (auto-deployment de Hostinger);
lo decide Luis. Ofrecer al cierre: merge `--no-ff` a main local + checklist de smoke manual
(claim como asesor, asignación como gerente, 403 en hilo ajeno, badge en lista, notificación
in-app al asignado, cronología del contacto muestra `inbox_assign`/`inbox_autoclaim`).

---

## Self-review del plan (hecho)

- **Cobertura del spec:** §3→Task 2 · §4→Task 1 · §5→Task 3 · §6→Task 4 · §7→Task 5 · §8→Task 6 · §9→tests por task + Task 7. Sin huecos.
- **Placeholders:** ninguno — todo step tiene código o comando exacto. Los dos ⚠ de Task 6 son verificaciones contra el código real, no TODOs.
- **Consistencia de tipos:** `assignContact` (Task 2) se usa con la misma firma en Tasks 3-4; `AssignResult.assignedTo` viaja igual en la respuesta de la ruta (Task 3) y en la UI (Task 6); `withChangeSource({source, actorId}, fn)` calza con `change-context.ts:24`.
