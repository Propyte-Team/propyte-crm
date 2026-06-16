# CRM quick-wins (asignar asesor · crear deal inline · gate de reunión) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tres mejoras de UX del flujo contacto/deal: asignar asesor inline (contacto+deal), crear deal en modal desde el contacto, y obligar a registrar reunión al mover un deal a etapa de reunión (agendada→realizada sin duplicar).

**Architecture:** Casi todo es UI reusando componentes y APIs existentes (no hay migración). El único backend nuevo es leer la reunión pendiente de un deal. El gate de reunión extiende el `StageTransitionDialog` ya existente y agrega las 2 etapas de reunión a `STAGES_REQUIRING_DIALOG`.

**Tech Stack:** Next.js 14.2 App Router, React 18, Prisma 6, vitest. Sin dependencias nuevas. Sin migración de BD.

**Spec:** `docs/superpowers/specs/2026-06-16-crm-quickwins-contacto-deal-reunion-design.md`

**Rama:** crear `feat/crm-quickwins-contacto-deal-reunion` **apilada sobre `feat/shortlist-propuesta-express`** (así el review local de la shortlist se conserva). Lo maneja el orquestador antes de Task 1.

**Hechos del repo ya verificados (citar, no re-descubrir):**
- `POST /api/activities` (zod) acepta: `contactId`(uuid req), `dealId?`(uuid), `activityType`(enum), `subject`(min 3), `description?`, `dueDate?`(coerce date), `status?`(PENDIENTE/COMPLETADA/…), `outcome?`, `duration_minutes?`. El `userId` lo pone el server desde la sesión.
- `PATCH /api/activities/[id]` acepta `status?` + `outcome?` (+ otros). `updateActivity` pone `completedAt` cuando status=COMPLETADA.
- `GET /api/users?role=ASESOR,ASESOR_SR,ASESOR_JR,TEAM_LEADER&isActive=true&basic=true` → `{ data: [{id,name,email,role,plaza}] }`.
- Contacto: `PUT /api/contacts?id=<id>` acepta `assignedToId` (connect/disconnect, permite null). En `contact-detail.tsx` existe `changeField(field, value)` (línea 194) que persiste vía `save({...})`.
- Deal: `PATCH /api/deals/[id]` acepta `assignedToId`.
- `StageTransitionDialog` (`src/components/pipeline/stage-transition-dialog.tsx`): recibe `deal: PipelineDeal` (tiene `id`, `contactId`, `contactName`, `stage`, `unitId`, `developmentId`), `toStage`, `onSuccess`. Hace `PATCH /api/deals/[id]` en `handleConfirm`. Tiene `isValid()` y secciones por etapa.
- Kanban `src/components/pipeline/kanban-board.tsx`: `STAGES_REQUIRING_DIALOG = ["DISCOVERY_DONE","RESERVED","WON","LOST"]` (~línea 177); si la etapa destino está ahí, abre el diálogo. El selector del detalle del deal reusa el mismo `StageTransitionDialog`.
- Etapas de reunión: `MEETING_SCHEDULED`, `MEETING_COMPLETED`. Tipos de reunión: `MEETING_VIRTUAL`, `MEETING_PRESENTIAL`, `MEETING_SHOWROOM`.
- Deal detail client real: `src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx` (card "Asesor Asignado").

---

### Task 1: Helper puro del gate de reunión + test (TDD)

**Files:**
- Create: `src/lib/pipeline/meeting-gate.ts`
- Test: `src/lib/pipeline/meeting-gate.test.ts`

- [ ] **Step 1: Test que falla** `src/lib/pipeline/meeting-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { requiresMeetingGate, meetingStageMode } from "./meeting-gate";

describe("requiresMeetingGate", () => {
  it("true para etapas de reunión, false para el resto", () => {
    expect(requiresMeetingGate("MEETING_SCHEDULED")).toBe(true);
    expect(requiresMeetingGate("MEETING_COMPLETED")).toBe(true);
    expect(requiresMeetingGate("WON")).toBe(false);
    expect(requiresMeetingGate("NEW_LEAD")).toBe(false);
  });
});

describe("meetingStageMode", () => {
  it("mapea cada etapa de reunión a su modo", () => {
    expect(meetingStageMode("MEETING_SCHEDULED")).toBe("schedule");
    expect(meetingStageMode("MEETING_COMPLETED")).toBe("complete");
    expect(meetingStageMode("WON")).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/lib/pipeline/meeting-gate.test.ts`
Expected: FAIL — "Cannot find module './meeting-gate'".

- [ ] **Step 3: Implementar** `src/lib/pipeline/meeting-gate.ts`:

```ts
// Gate de reunión: qué etapas obligan a registrar reunión y en qué modo.
export function requiresMeetingGate(stage: string): boolean {
  return stage === "MEETING_SCHEDULED" || stage === "MEETING_COMPLETED";
}

export function meetingStageMode(stage: string): "schedule" | "complete" | null {
  if (stage === "MEETING_SCHEDULED") return "schedule";
  if (stage === "MEETING_COMPLETED") return "complete";
  return null;
}

export const MEETING_ACTIVITY_TYPES = [
  { value: "MEETING_VIRTUAL", label: "Virtual" },
  { value: "MEETING_PRESENTIAL", label: "Presencial" },
  { value: "MEETING_SHOWROOM", label: "Showroom" },
] as const;
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/lib/pipeline/meeting-gate.test.ts`
Expected: PASS (2 describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/
git commit -m "feat(pipeline): helper meeting-gate (requiresMeetingGate/meetingStageMode) + test"
```

---

### Task 2: Backend — `getLatestPendingMeeting` + endpoint

**Files:**
- Modify: `src/server/activities.ts` (agregar una función exportada al final)
- Create: `src/app/api/deals/[id]/pending-meeting/route.ts`

- [ ] **Step 1: Agregar `getLatestPendingMeeting` al final de `src/server/activities.ts`:**

```ts
// Reunión pendiente más reciente de un deal (para el gate de etapa "Realizada").
export async function getLatestPendingMeeting(dealId: string) {
  return prisma.activity.findFirst({
    where: {
      dealId,
      deletedAt: null,
      status: "PENDIENTE",
      activityType: { in: ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM"] },
    },
    orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
  });
}
```

(Confirma que `prisma` ya está importado en ese archivo — lo está, lo usa `createActivity`.)

- [ ] **Step 2: Crear la ruta** `src/app/api/deals/[id]/pending-meeting/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getLatestPendingMeeting } from "@/server/activities";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const data = await getLatestPendingMeeting(params.id);
  return NextResponse.json({ data });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en los 2 archivos (ignorar errores pre-existentes ajenos).

- [ ] **Step 4: Commit**

```bash
git add src/server/activities.ts "src/app/api/deals/[id]/pending-meeting/"
git commit -m "feat(activities): getLatestPendingMeeting + GET /api/deals/[id]/pending-meeting"
```

---

### Task 3: Componente compartido `AdvisorSelect`

**Files:**
- Create: `src/components/shared/advisor-select.tsx`

- [ ] **Step 1: Implementar** `src/components/shared/advisor-select.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

interface Advisor {
  id: string;
  name: string | null;
  email: string | null;
}

export function AdvisorSelect({
  value,
  onChange,
  allowUnassigned = false,
  disabled = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void | Promise<void>;
  allowUnassigned?: boolean;
  disabled?: boolean;
}) {
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/users?role=ASESOR,ASESOR_SR,ASESOR_JR,TEAM_LEADER&isActive=true&basic=true")
      .then((r) => r.json())
      .then((j) => setAdvisors(j.data ?? []))
      .catch(() => setAdvisors([]));
  }, []);

  return (
    <select
      className="form-input max-w-[200px] text-[13px]"
      value={value ?? ""}
      disabled={disabled || busy}
      onChange={async (e) => {
        const v = e.target.value || null;
        setBusy(true);
        try {
          await onChange(v);
        } finally {
          setBusy(false);
        }
      }}
    >
      {allowUnassigned && <option value="">Sin asignar</option>}
      {!allowUnassigned && value == null && (
        <option value="" disabled>
          Seleccionar…
        </option>
      )}
      {advisors.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name ?? a.email ?? a.id}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en el archivo nuevo.

- [ ] **Step 3: Commit**

```bash
git add src/components/shared/advisor-select.tsx
git commit -m "feat(shared): AdvisorSelect (lista asesores + select)"
```

---

### Task 4: Asignar asesor inline en Contacto y Deal (Mejora 2)

**Files:**
- Modify: `src/components/contacts/contact-detail.tsx` (fila "Asesor", ~línea 395)
- Modify: `src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx` (card "Asesor Asignado", ~líneas 374-397)

- [ ] **Step 1: Contacto** — en `contact-detail.tsx` importar el componente:

```tsx
import { AdvisorSelect } from "@/components/shared/advisor-select";
```

Reemplazar la fila read-only del asesor (la línea `<ReadRow label="Asesor" value={contact.assignedTo?.name ?? "Sin asignar"} />`) por una fila con el selector. Usa el campo id del asesor asignado que exista en `contact` (`contact.assignedToId`; si no existe, `contact.assignedTo?.id`):

```tsx
<div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
  <span className="text-[color:var(--text-tertiary)]">Asesor</span>
  <AdvisorSelect
    value={contact.assignedToId ?? contact.assignedTo?.id ?? null}
    allowUnassigned
    onChange={(id) => changeField("assignedToId", id)}
  />
</div>
```

(`changeField` ya persiste vía `PUT /api/contacts?id=` con `{ assignedToId }`, que hace connect/disconnect.)

- [ ] **Step 2: Deal** — en `deal-detail-client.tsx` importar:

```tsx
import { AdvisorSelect } from "@/components/shared/advisor-select";
```

Dentro de la card "Asesor Asignado", DEBAJO del bloque que muestra el asesor actual, agregar el selector de reasignación (usa el `router` que ya existe en ese client component; si no, agrega `const router = useRouter()` de `next/navigation`):

```tsx
<div className="mt-3">
  <AdvisorSelect
    value={deal.assignedToId ?? deal.assignedTo?.id ?? null}
    onChange={async (id) => {
      if (!id) return;
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: id }),
      });
      if (res.ok) router.refresh();
    }}
  />
</div>
```

(Confirma el nombre del id del asesor en el objeto `deal`; usa `deal.assignedToId` o `deal.assignedTo?.id`, el que exista.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en los 2 archivos.

- [ ] **Step 4: Commit**

```bash
git add src/components/contacts/contact-detail.tsx "src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx"
git commit -m "feat(crm): asignar/reasignar asesor inline en contacto y deal"
```

---

### Task 5: Crear deal inline (modal) desde el contacto (Mejora 1)

**Files:**
- Modify: `src/components/contacts/contact-detail.tsx`

- [ ] **Step 1: Imports** — en `contact-detail.tsx` agregar (si no están ya):

```tsx
import { DealForm } from "@/components/pipeline/deal-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
```

(El edit modal de esta página ya usa `Dialog`; reutiliza el mismo import si ya existe — no dupliques.)

- [ ] **Step 2: Estado** — junto a los otros `useState` del componente:

```tsx
const [dealOpen, setDealOpen] = useState(false);
```

- [ ] **Step 3: Botones** — los 2 botones "Crear Deal" (que hoy hacen `router.push(\`/pipeline?newDeal=true&contactId=${contact.id}\`)`) cambian su `onClick` a:

```tsx
onClick={() => setDealOpen(true)}
```

- [ ] **Step 4: Modal** — agregar cerca del final del JSX (junto al Dialog de edición existente):

```tsx
<Dialog open={dealOpen} onOpenChange={setDealOpen}>
  <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Crear nuevo deal</DialogTitle>
    </DialogHeader>
    <DealForm
      initialData={{ contactId: contact.id }}
      onSuccess={() => {
        setDealOpen(false);
        router.refresh();
      }}
      onCancel={() => setDealOpen(false)}
    />
  </DialogContent>
</Dialog>
```

(`DealForm` ya es modal-friendly: `initialData`/`onSuccess`/`onCancel`. Verifica que `initialData` mínimo `{ contactId }` baste — el resto de campos los pide el form; lo es según `DealFormProps`.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/components/contacts/contact-detail.tsx
git commit -m "feat(crm): crear deal inline en modal desde el contacto"
```

---

### Task 6: Gate de reunión en el cambio de etapa (Mejora 3)

**Files:**
- Modify: `src/components/pipeline/kanban-board.tsx` (`STAGES_REQUIRING_DIALOG`)
- Modify: `src/components/pipeline/stage-transition-dialog.tsx`

- [ ] **Step 1: Disparo** — en `kanban-board.tsx`, agregar las 2 etapas de reunión a `STAGES_REQUIRING_DIALOG`:

```tsx
const STAGES_REQUIRING_DIALOG = [
  "DISCOVERY_DONE",
  "MEETING_SCHEDULED",
  "MEETING_COMPLETED",
  "RESERVED",
  "WON",
  "LOST",
];
```

- [ ] **Step 2: `stage-transition-dialog.tsx` — imports + estado de reunión.** Agregar import:

```tsx
import { meetingStageMode, MEETING_ACTIVITY_TYPES } from "@/lib/pipeline/meeting-gate";
```

Y junto a los otros `useState` del componente:

```tsx
  // Gate de reunión
  const meetingMode = meetingStageMode(toStage); // "schedule" | "complete" | null
  const [meetingType, setMeetingType] = useState("MEETING_VIRTUAL");
  const [meetingDate, setMeetingDate] = useState(""); // datetime-local (schedule) o date (complete-from-scratch)
  const [meetingNote, setMeetingNote] = useState("");
  const [meetingResult, setMeetingResult] = useState("");
  const [pendingMeeting, setPendingMeeting] = useState<{
    id: string; activityType: string; dueDate: string | null; subject: string;
  } | null>(null);
  const [pendingLoaded, setPendingLoaded] = useState(false);
```

- [ ] **Step 3: useEffect que carga la reunión pendiente cuando se va a "Realizada".** Agregar dentro del componente:

```tsx
  useEffect(() => {
    if (meetingMode !== "complete") { setPendingLoaded(true); return; }
    setPendingLoaded(false);
    fetch(`/api/deals/${deal.id}/pending-meeting`)
      .then((r) => r.json())
      .then((j) => setPendingMeeting(j.data ?? null))
      .catch(() => setPendingMeeting(null))
      .finally(() => setPendingLoaded(true));
  }, [meetingMode, deal.id]);
```

- [ ] **Step 4: Lógica de envío de la reunión.** Agregar esta función auxiliar dentro del componente (antes de `handleConfirm`):

```tsx
  // Crea/completa la actividad de reunión. Devuelve true si OK (o si no aplica gate).
  async function handleMeetingActivity(): Promise<boolean> {
    if (meetingMode === "schedule") {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: deal.contactId,
          dealId: deal.id,
          activityType: meetingType,
          subject: "Reunión agendada",
          dueDate: meetingDate,
          status: "PENDIENTE",
          description: meetingNote || undefined,
        }),
      });
      return res.ok;
    }
    if (meetingMode === "complete") {
      if (pendingMeeting) {
        const res = await fetch(`/api/activities/${pendingMeeting.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "COMPLETADA", outcome: meetingResult }),
        });
        return res.ok;
      }
      // Fallback: no había reunión agendada → registrar la realizada desde cero.
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: deal.contactId,
          dealId: deal.id,
          activityType: meetingType,
          subject: "Reunión realizada",
          dueDate: meetingDate || undefined,
          status: "COMPLETADA",
          outcome: meetingResult,
        }),
      });
      return res.ok;
    }
    return true; // no es etapa de reunión
  }
```

- [ ] **Step 5: Encadenar en `handleConfirm`.** Al inicio del `try` de `handleConfirm` (antes del `fetch` PATCH del deal), insertar:

```tsx
      // Gate de reunión: registrar/completar la reunión antes del cambio de etapa.
      if (meetingMode) {
        const okMeeting = await handleMeetingActivity();
        if (!okMeeting) {
          throw new Error("No se pudo registrar la reunión. Intenta de nuevo.");
        }
      }
```

(El resto de `handleConfirm` —el PATCH a `/api/deals/[id]` con `{ stage: toStage }`— queda igual.)

- [ ] **Step 6: Validación.** Dentro de `isValid()`, antes del `return true` final, agregar:

```tsx
    if (meetingMode === "schedule" && (!meetingType || !meetingDate)) return false;
    if (meetingMode === "complete") {
      if (!pendingLoaded) return false; // aún cargando la reunión pendiente
      if (!meetingResult.trim()) return false; // resultado obligatorio
      if (!pendingMeeting && !meetingType) return false; // fallback necesita tipo
    }
```

- [ ] **Step 7: UI de las secciones de reunión.** Dentro del `<div className="space-y-4">` de campos dinámicos (junto a las otras secciones por etapa), agregar:

```tsx
          {/* MEETING_SCHEDULED: agendar reunión (obligatorio) */}
          {meetingMode === "schedule" && (
            <div className="space-y-3 rounded-md border bg-blue-50 p-4">
              <p className="text-sm font-medium text-blue-800">
                Registra la reunión agendada
              </p>
              <div className="space-y-2">
                <Label>Tipo <span className="text-red-500">*</span></Label>
                <Select value={meetingType} onValueChange={setMeetingType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEETING_ACTIVITY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="meetDate">Fecha y hora <span className="text-red-500">*</span></Label>
                <Input id="meetDate" type="datetime-local" value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meetNote">Nota (opcional)</Label>
                <Input id="meetNote" value={meetingNote} maxLength={500}
                  onChange={(e) => setMeetingNote(e.target.value)} />
              </div>
            </div>
          )}

          {/* MEETING_COMPLETED: completar la reunión agendada (sin duplicar) */}
          {meetingMode === "complete" && (
            <div className="space-y-3 rounded-md border bg-green-50 p-4">
              {!pendingLoaded ? (
                <p className="text-sm text-green-800">Cargando reunión agendada…</p>
              ) : pendingMeeting ? (
                <p className="text-sm text-green-800">
                  Reunión agendada{" "}
                  {pendingMeeting.dueDate
                    ? `para ${new Date(pendingMeeting.dueDate).toLocaleString("es-MX")}`
                    : ""}. Captura el resultado para cerrarla.
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium text-green-800">
                    No hay reunión agendada previa. Registra la reunión realizada.
                  </p>
                  <div className="space-y-2">
                    <Label>Tipo <span className="text-red-500">*</span></Label>
                    <Select value={meetingType} onValueChange={setMeetingType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MEETING_ACTIVITY_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="meetDate2">Fecha</Label>
                    <Input id="meetDate2" type="date" value={meetingDate}
                      onChange={(e) => setMeetingDate(e.target.value)} />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="meetResult">Resultado <span className="text-red-500">*</span></Label>
                <Input id="meetResult" value={meetingResult} maxLength={1000}
                  placeholder="¿Qué resultó de la reunión?"
                  onChange={(e) => setMeetingResult(e.target.value)} />
              </div>
            </div>
          )}
```

- [ ] **Step 8: Asegurar import de `useEffect`** en `stage-transition-dialog.tsx` (ya importa `useState, useEffect` — confirma; si falta `useEffect`, agrégalo).

- [ ] **Step 9: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: sin errores en los archivos tocados.

- [ ] **Step 10: Commit**

```bash
git add src/components/pipeline/kanban-board.tsx src/components/pipeline/stage-transition-dialog.tsx
git commit -m "feat(pipeline): gate de reunión al cambiar de etapa (agendar obligatorio, realizar sin duplicar)"
```

---

### Task 7: Verificación + smoke local

**Files:** ninguno.

- [ ] **Step 1: Suite de tests**

Run: `npx vitest run`
Expected: verde (los previos + los 2 nuevos de meeting-gate → 91 tests).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0, sin errores de tipo. Confirmar que aparece la ruta `/api/deals/[id]/pending-meeting`.

- [ ] **Step 3: Smoke local** (no requiere migración — no hubo cambios de BD; usar un contacto/deal de prueba con cuidado por las automatizaciones activas):
  - Contacto: cambiar el asesor en el selector → recargar → persiste. "Sin asignar" también.
  - Contacto: botón "Crear Deal" → abre modal → crear → modal cierra, el deal aparece (sin salir del contacto).
  - Deal: cambiar asesor en el detalle → persiste.
  - Pipeline: arrastrar un deal a "Reunión Agendada" → el diálogo obliga tipo+fecha → confirmar → se crea Activity Pendiente; el cambio de etapa no se completa sin la reunión.
  - Pipeline: arrastrar ese deal a "Reunión Realizada" → el diálogo precarga la reunión agendada → capturar resultado (obligatorio) → confirmar → esa MISMA Activity queda Completada (verificar que NO se creó una segunda reunión).
  - Fallback: con un deal sin reunión previa, moverlo a "Reunión Realizada" → pide tipo+resultado → crea la realizada.

- [ ] **Step 4: Limpiar** datos de prueba creados (deal/actividades de prueba) si aplica.

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** Mejora 1 → Task 5. Mejora 2 → Task 3 (componente) + Task 4 (montaje contacto+deal). Mejora 3 → Task 1 (helper) + Task 2 (backend pending-meeting) + Task 6 (dialog + disparo). Verificación → Task 7. ✅
- **Sin migración** (confirmado: APIs y `createActivity`/`updateActivity` ya aceptan status/dueDate/outcome). ✅
- **Consistencia de tipos:** `meetingStageMode`/`requiresMeetingGate`/`MEETING_ACTIVITY_TYPES` definidos en Task 1 y consumidos en Task 6. `getLatestPendingMeeting` definido en Task 2 y consumido por el endpoint del mismo task, que la UI de Task 6 llama vía `GET /api/deals/[id]/pending-meeting`. `AdvisorSelect` (Task 3) consumido en Task 4. Payloads de `/api/activities` (POST/PATCH) coinciden con el esquema zod verificado del repo. ✅
- **Sin placeholders.** Todo el código está completo.
- **Nota de campos a confirmar en implementación:** id del asesor en `contact`/`deal` (`assignedToId` vs `assignedTo?.id`) y la presencia de `router` en `deal-detail-client.tsx` — el plan instruye verificarlos.
- **Orden de errores en el gate:** la actividad se crea/completa antes del PATCH de etapa; si el PATCH falla, la reunión ya quedó guardada (aceptable v1, documentado en el spec).
