# MAKE_CALL real (tarea de llamada + click-to-call) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la acción de workflow `MAKE_CALL` cree una tarea de llamada (`ActivityType.CALL_TASK`) + notificación para el asesor asignado, y que el asesor pueda marcar con 1 clic (dialer Twilio existente) desde la ficha del contacto y desde Hoy.

**Architecture:** Migración aditiva al enum `ActivityType` (+`CALL_TASK`). El runner `MAKE_CALL` en `actions.ts` crea una `Activity` CALL_TASK + `Notification` (espejo de CREATE_TASK/NOTIFY). La UI reutiliza el `CallButton` existente (`useVoice().startCall`): se muestra en filas CALL_TASK pendientes de la lista de actividades del contacto y en la lista de tareas de Hoy (que se amplía para incluir CALL_TASK + teléfono).

**Tech Stack:** TypeScript, Next.js 14, Prisma (Postgres/Supabase), Twilio Voice (existente), Vitest.

**Convenciones (leer antes):**
- Worktree `.claude/worktrees/crm-call-task` (rama `feat/crm-call-task` desde `origin/main` `563ad61`). Rutas relativas a la raíz.
- Vitest `npx vitest run <ruta>`. Typecheck `npx tsc --noEmit`. Build `npm run build`.
- Si faltan `node_modules`/cliente Prisma: `npm install` + `npx prisma generate`. **GOTCHA:** tras CUALQUIER cambio a `schema.prisma` o `npm install`, correr `npx prisma generate` (si no, TS no conoce el nuevo valor de enum). 2 errores tsc PRE-existentes en `builder-model.test.ts` — NO tuyos.
- Autor commits `Propyte-Luis` (ya configurado); verificar con `git config user.name`, NO cambiar.
- Infra existente: `CallButton` en `src/components/voice/call-button.tsx` (`{phone, contactId, userId, doNotContact}` → `useVoice().startCall`; ya devuelve null si el Device no está `ready`). Runner helpers en `actions.ts`: `ownerUserId(contact)`, patrón `CREATE_TASK` (crea `Activity` activityType TASK) y `NOTIFY` (crea `Notification`). `ActivityLog` (`src/components/activities/activity-log.tsx`) ya importa+usa `CallButton` en su header y tiene `isPendingTask` (línea ~282). Hoy: `src/app/(dashboard)/hoy/page.tsx` → `getTodayView(userId, role)` en `src/server/today.ts` → `TodayView` en `src/components/today/today-view.tsx`.

---

## File Structure

**Modificar:**
- `prisma/schema.prisma` — `+CALL_TASK` en `enum ActivityType`.
- `prisma/migrations-manual/2026-06-26-activitytype-call-task.sql` (crear) — el `ALTER TYPE` (lo aplica Luis vía MCP).
- `src/lib/workflows/actions.ts` — reemplazar el case `MAKE_CALL` no-op.
- `src/components/activities/activity-log.tsx` — reconocer CALL_TASK como tarea pendiente + CallButton por-fila en CALL_TASK.
- `src/server/today.ts` — incluir CALL_TASK + `phone`/`activityType` en la query de tasks.
- `src/components/today/today-view.tsx` — botón Llamar en items CALL_TASK (recibe `userId`).
- `src/app/(dashboard)/hoy/page.tsx` — pasar `session.user.id` a `TodayView`.
- (Si existe un mapa de labels de `ActivityType`) agregar etiqueta "Llamada pendiente" para CALL_TASK.

---

## Task 1: Migración aditiva `ActivityType += CALL_TASK`

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations-manual/2026-06-26-activitytype-call-task.sql`.

- [ ] **Step 1: Editar el enum** — en `prisma/schema.prisma`, dentro de `enum ActivityType`, agregar `CALL_TASK` (junto a `CALL_OUTBOUND`/`CALL_INBOUND`; el orden no importa, ponlo tras `CALL_INBOUND`):

```prisma
enum ActivityType {
  CALL_OUTBOUND
  CALL_INBOUND
  CALL_TASK
  // … resto sin cambios
}
```

- [ ] **Step 2: Regenerar cliente** — `npx prisma generate`. Expected: OK. (Ahora TS conoce `ActivityType.CALL_TASK`.)

- [ ] **Step 3: Escribir el SQL de migración** — `prisma/migrations-manual/2026-06-26-activitytype-call-task.sql`:

```sql
-- Fase 3 E2: tarea de llamada para MAKE_CALL. Aditivo, no afecta filas existentes.
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'CALL_TASK';
```

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit`. Expected: solo los 2 pre-existentes (el schema editado + generate no introduce errores).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-06-26-activitytype-call-task.sql
git commit -m "feat(db): ActivityType += CALL_TASK (aditivo) para tareas de llamada"
```

> El `ALTER TYPE` en la BD compartida lo aplica el controlador vía MCP con la frase de Luis (gate de infra). El código de tasks 2-4 compila con el cliente regenerado aunque la BD aún no tenga el valor; en runtime el valor debe existir (se aplica antes/junto al deploy).

---

## Task 2: Runner `MAKE_CALL` (actions.ts)

**Files:** Modify `src/lib/workflows/actions.ts`; Test `src/lib/workflows/actions.make-call.test.ts`.

- [ ] **Step 1: READ** el case `MAKE_CALL` actual (~línea 225, `{ skipped: true, note: "Dialer disponible en fase posterior (voz)" }`) y los cases `CREATE_TASK` (crea `prisma.activity.create` con activityType TASK) + `NOTIFY` (crea `prisma.notification.create`) para imitar EXACTAMENTE los campos reales (`activityType`, `subject`, `description`, `dueDate`, `status`, `contactId`, `dealId`, `userId`; y Notification `title`/`message`/`type`/`link`). Confirma que `contact` tiene `phone`, `firstName`, `doNotContact`.

- [ ] **Step 2: Test que falla** — `src/lib/workflows/actions.make-call.test.ts` (ALINEA el mock de `@/lib/db` + la firma de `executeAction` a un test existente de `src/lib/workflows/`; este es un patrón base):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const contact = { id: "c1", phone: "+52155500", firstName: "Ana", doNotContact: false, assignedToId: "u1" };
const prismaMock = {
  contact: { findUnique: vi.fn().mockResolvedValue(contact) },
  deal: { findUnique: vi.fn() },
  activity: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
  notification: { create: vi.fn().mockResolvedValue({ id: "n1" }) },
  user: { findFirst: vi.fn().mockResolvedValue({ id: "u1" }) },
};
vi.mock("@/lib/db", () => ({ default: prismaMock }));

beforeEach(() => { prismaMock.activity.create.mockClear(); prismaMock.notification.create.mockClear(); });

describe("MAKE_CALL runner", () => {
  it("crea una Activity CALL_TASK + Notification", async () => {
    const { executeAction } = await import("./actions");
    const r = await executeAction({ actionType: "MAKE_CALL", entityType: "contact", entityId: "c1", config: { reason: "Seguimiento" } } as never);
    expect(r.skipped).toBeUndefined();
    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.activity.create.mock.calls[0][0].data.activityType).toBe("CALL_TASK");
    expect(prismaMock.activity.create.mock.calls[0][0].data.status).toBe("PENDIENTE");
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });

  it("skip si el contacto no tiene teléfono", async () => {
    prismaMock.contact.findUnique.mockResolvedValueOnce({ ...contact, phone: null });
    const { executeAction } = await import("./actions");
    const r = await executeAction({ actionType: "MAKE_CALL", entityType: "contact", entityId: "c1", config: {} } as never);
    expect(r.skipped).toBe(true);
    expect(prismaMock.activity.create).not.toHaveBeenCalled();
  });

  it("skip si doNotContact", async () => {
    prismaMock.contact.findUnique.mockResolvedValueOnce({ ...contact, doNotContact: true });
    const { executeAction } = await import("./actions");
    const r = await executeAction({ actionType: "MAKE_CALL", entityType: "contact", entityId: "c1", config: {} } as never);
    expect(r.skipped).toBe(true);
  });
});
```

- [ ] **Step 3: Run to fail** — `npx vitest run src/lib/workflows/actions.make-call.test.ts` → FAIL (hoy MAKE_CALL devuelve skip "Dialer disponible…", así que el primer test falla).

- [ ] **Step 4: Implementar** — reemplazar el case `MAKE_CALL`:

```ts
    case "MAKE_CALL": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      if (!contact.phone) return { skipped: true, note: "Contacto sin teléfono" };
      if (contact.doNotContact) return { skipped: true, note: "Opt-out" };
      const userId = await ownerUserId(contact);
      if (!userId) return { skipped: true, note: "Sin usuario destino" };

      const subject = String(config.subject ?? `Llamar a ${contact.firstName ?? "contacto"}`);
      const dueInMinutes = typeof config.dueInMinutes === "number" ? config.dueInMinutes : 60;
      await prisma.activity.create({
        data: {
          contactId: contact.id,
          dealId: item.entityType === "deal" ? item.entityId : undefined,
          userId,
          activityType: "CALL_TASK",
          subject,
          description: config.reason ? String(config.reason) : (config.description ? String(config.description) : null),
          dueDate: new Date(Date.now() + dueInMinutes * 60_000),
          status: "PENDIENTE",
        },
      });
      await prisma.notification.create({
        data: {
          userId,
          title: "Llamada pendiente",
          message: subject,
          type: "call_task",
          link: `/contacts/${contact.id}`,
        },
      });
      return {};
    }
```

> ADAPTA los nombres de campo si difieren de lo que viste en Step 1 (p. ej. si `Notification` no tiene `link`, omítelo; si `Activity` usa otro nombre para `description`). NO inventes campos que el modelo no tiene.

- [ ] **Step 5: Run to pass + typecheck** — `npx vitest run src/lib/workflows/actions.make-call.test.ts` → PASS (3). `npx tsc --noEmit` → solo los 2 pre-existentes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/actions.ts src/lib/workflows/actions.make-call.test.ts
git commit -m "feat(workflows): MAKE_CALL crea tarea CALL_TASK + notificación"
```

---

## Task 3: CallButton en tareas CALL_TASK de la ficha del contacto

**Files:** Modify `src/components/activities/activity-log.tsx`.

- [ ] **Step 1: READ `src/components/activities/activity-log.tsx`** — confirma: `isPendingTask = a.activityType === "TASK" && a.status === "PENDIENTE"` (~línea 282); cómo se renderiza cada fila de actividad `a` y dónde caben botones; que el componente recibe `contactPhone`, `currentUserId`, `contactId`, `doNotContact` en props (sí, por la firma línea 68); el import de `CallButton` (ya existe).

- [ ] **Step 2: Reconocer CALL_TASK como tarea pendiente** — cambiar la línea ~282:

```ts
const isPendingTask = (a.activityType === "TASK" || a.activityType === "CALL_TASK") && a.status === "PENDIENTE";
```
(Así CALL_TASK obtiene el mismo tratamiento de "tarea pendiente" — estilo, completar, etc.)

- [ ] **Step 3: Botón Llamar por-fila en CALL_TASK** — en el render de la fila, cuando `a.activityType === "CALL_TASK" && a.status === "PENDIENTE" && contactPhone && currentUserId`, mostrar un `CallButton` (reusa el componente ya importado):

```tsx
{a.activityType === "CALL_TASK" && a.status === "PENDIENTE" && contactPhone && currentUserId && (
  <CallButton phone={contactPhone} contactId={contactId} userId={currentUserId} doNotContact={doNotContact} />
)}
```
Colócalo en el área de acciones de la fila (junto a los controles existentes de la actividad, p. ej. el botón de completar). Mantén el estilo (clases existentes).

- [ ] **Step 4: Etiqueta del tipo** — si hay un mapa/`switch` que traduce `activityType` a label/ícono para la fila (búscalo en este archivo o en `@/lib/constants`), agregar `CALL_TASK → "Llamada pendiente"` (ícono teléfono) para que no se muestre el valor crudo. Si no hay mapa exhaustivo (usa el string directo), omitir.

- [ ] **Step 5: Typecheck + build parcial** — `npx tsc --noEmit` (solo pre-existentes). `npx vitest run src/lib/workflows src/lib/email` (sin regresiones; este archivo es UI, no rompe tests existentes).

- [ ] **Step 6: Commit**

```bash
git add src/components/activities/activity-log.tsx
git commit -m "feat(activities): CALL_TASK como tarea pendiente + botón Llamar por fila"
```

---

## Task 4: CALL_TASK en Hoy (lista de tareas + botón Llamar)

**Files:** Modify `src/server/today.ts`, `src/components/today/today-view.tsx`, `src/app/(dashboard)/hoy/page.tsx`.

- [ ] **Step 1: READ** los tres archivos. En `today.ts` confirma la query de tasks (~líneas 89-93): `activityType: "TASK"`, pendiente, `dueDate <= endToday`, `select { id, subject, dueDate, contact: { id, firstName, lastName } }`. Confirma el tipo `TodayMini` (~línea 21) y cómo `TodayView` renderiza `data.tasks.items`.

- [ ] **Step 2: Ampliar la query de tasks** en `today.ts` (count + findMany) para incluir CALL_TASK y traer teléfono + tipo:

```ts
// count:
where: { deletedAt: null, activityType: { in: ["TASK", "CALL_TASK"] as never }, status: "PENDIENTE" as never, dueDate: { lte: endToday }, ...activityUserScope },
// findMany select:
select: { id: true, subject: true, dueDate: true, activityType: true, contact: { select: { id: true, firstName: true, lastName: true, phone: true } } },
```
Extender el tipo `TodayMini` (o el tipo del item de task) para incluir `activityType?: string` y `contact.phone?: string | null`. (Si `TodayMini` es compartido por varias secciones, crea un tipo específico para tasks o agrega los campos como opcionales.)

- [ ] **Step 3: Pasar userId a TodayView** — en `src/app/(dashboard)/hoy/page.tsx`, pasar el id de sesión:

```tsx
return <TodayView data={JSON.parse(JSON.stringify(data))} firstName={firstName} userId={session.user.id} />;
```

- [ ] **Step 4: Botón Llamar en TodayView** — en `src/components/today/today-view.tsx`: agregar `userId: string` a sus props; importar `CallButton`; en el render de cada task item, cuando `item.activityType === "CALL_TASK" && item.contact?.phone`, mostrar:

```tsx
{item.activityType === "CALL_TASK" && item.contact?.phone && (
  <CallButton phone={item.contact.phone} contactId={item.contact.id} userId={userId} />
)}
```
(TodayView es client component — confirma `"use client"` arriba; `CallButton` ya es client y usa `useVoice()`, disponible porque `VoiceDeviceProvider` envuelve la app en `providers.tsx`.)

- [ ] **Step 5: Verificar** — `npx tsc --noEmit` (solo pre-existentes), `npx vitest run` (todo verde), `npm run build` (verde — paste status).

- [ ] **Step 6: Commit**

```bash
git add src/server/today.ts src/components/today/today-view.tsx "src/app/(dashboard)/hoy/page.tsx"
git commit -m "feat(today): tareas CALL_TASK con botón Llamar en Hoy"
```

---

## Verificación final (antes de merge)
- [ ] `npx vitest run` — suite verde (incluye actions.make-call).
- [ ] `npx tsc --noEmit` — solo los 2 pre-existentes de `builder-model.test.ts`.
- [ ] `npm run build` — verde.
- [ ] **Migración:** aplicar `ALTER TYPE ... ADD VALUE 'CALL_TASK'` vía MCP a `oaijxdpevakashxshhvm` (con la frase de Luis) ANTES de que un MAKE_CALL real corra en prod. (El push de código puede ir antes: las queries de CALL_TASK no fallan si el valor aún no existe — `IN ["TASK","CALL_TASK"]` simplemente no matchea filas; pero el runner MAKE_CALL fallaría al crear hasta que el valor exista → aplicar la migración junto al deploy.)
- [ ] **Smoke (opcional, pedir autorización):** difícil sin Twilio configurado + Device online; el valor está en el unit test del runner + que el botón reusa el dialer probado del PR #11. Probable omisión.
- [ ] Review final (Opus) del diff.
- [ ] ff-push `feat/crm-call-task` → `main` (autor Propyte-Luis) → auto-deploy.

## Notas / caveats
- **Orden de deploy:** idealmente aplicar el `ALTER TYPE` antes/junto al push para que un MAKE_CALL en vuelo no falle al crear la Activity. El runner que falla deja la acción en retry (`action_queue`), así que un desfase corto se recupera solo al aplicar la migración.
- **Auto-completar la CALL_TASK** al marcar/loguear la llamada = fuera de alcance (el asesor la cierra con el flujo de tareas existente).
- **Etiqueta de tipo:** si `ActivityType` se mapea a labels en varios lugares (constantes/UI), agregar `CALL_TASK` para no mostrar el valor crudo (revisar en Task 3 Step 4 y, si aplica, en filtros de actividades).
- **Fuera de alcance:** auto-dial por presencia, SLA de llamadas, cadencias de re-intento.
