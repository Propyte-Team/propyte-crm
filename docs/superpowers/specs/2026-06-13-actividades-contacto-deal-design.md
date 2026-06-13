# Diseño — Sistema de Actividades en Contacto y Deal (Entregable A)

> **Fecha:** 2026-06-13
> **Stack:** propyte-crm (Next.js 14 + Prisma + Supabase + NextAuth + vitest)
> **Rama:** `feat/actividades-contacto-deal`
> **Relación:** Entregable A de 2. El B (Integración Gmail GW-0+GW-1, speckit `SPECKIT-GOOGLE-WORKSPACE.md`) se hace después y reutiliza el timeline que deja A.

---

## 1. Problema

El modelo de datos de actividades **ya existe y es completo**, pero está **huérfano / fragmentado en la UI**:

- `Activity` (`schema.prisma:859`) + enum `ActivityType` (`:277`) con los 17 tipos: `CALL_OUTBOUND/INBOUND`, `WHATSAPP_OUT/IN`, `SMS_OUT/IN`, `EMAIL_SENT/RECEIVED`, `MEETING_VIRTUAL/PRESENTIAL/SHOWROOM`, `DISCOVERY_CALL`, `PROPOSAL_DELIVERY`, `FOLLOW_UP`, `WALK_IN` (visita), `NOTE`, `TASK`, `CONTRACT_REVIEW`, `CLOSING_ACTIVITY`.
- `src/server/activities.ts`: `getActivities`, `createActivity`, `updateActivity` (+ stats/overdue/agreement). `getActivities` ya filtra `deletedAt: null` (`:107`). `updateActivity` ya tiene guard RBAC y setea `completedAt` al completar (`:260-276`).
- `POST /api/activities` (crear) y `GET /api/activities` (listar) existen. **No hay** `/api/activities/[id]`.
- `src/components/activities/activity-form.tsx` y `activity-timeline.tsx` existen pero son **estilo shadcn con colores** (`bg-blue-100`, badges de colores). Se usan en `dashboard/recent-activities` y `reports`.

**Tres timelines distintos y desalineados:**
1. **Contacto** (`contact-detail.tsx:500-548`): timeline propio **minimalista B/N** (tokens `--text-*`, hairlines) + compositor de nota rápida (`addNote`, `:287`). Bonito pero solo-lectura y solo crea `NOTE`.
2. **Deal** (`deal-detail-client.tsx:413-459`): timeline propio shadcn neutro, **solo-lectura**, sin compositor.
3. **`ActivityTimeline`** (componente): shadcn **colorido**, solo-lectura.

**Brechas (lo que el usuario percibe como "faltantes"):**
- No se puede registrar una llamada/whatsapp/reunión/visita/correo desde contacto ni deal (solo nota rápida en contacto).
- No se puede **completar una tarea**, editar ni borrar una actividad desde la UI (no existe `/api/activities/[id]`).
- Tres estéticas distintas para lo mismo.

---

## 2. Objetivo

Que un asesor pueda, **desde el detalle de contacto y desde el detalle de deal**, con una **sola estética minimalista B/N**:

- Registrar cualquier tipo de actividad (llamada, whatsapp, reunión, visita, correo, nota, tarea) con el contexto (contacto/deal) preseleccionado.
- Ver todas las actividades en un **timeline unificado**.
- **Completar tareas**, editar y borrar (soft-delete) desde ese timeline.

Sin dependencias externas (no toca Google). Es el cimiento del timeline donde el Entregable B (Gmail) inyectará los correos.

---

## 3. Decisión de arquitectura (craft)

Luis exige craft B/N consistente (ver `[[feedback_ui_craft_no_admin_template]]`). **No** se reutilizan los componentes coloridos `ActivityForm`/`ActivityTimeline` en los detalles. En su lugar:

- **UN componente nuevo compartido `ActivityLog`** (B/N), usado por contacto **y** deal: compositor + timeline interactivo (registrar / nota rápida / completar / editar / borrar).
- `ActivityLog` **fetchea sus propias actividades** (por `contactId` o por `dealId`) y maneja su estado → permite refrescar tras cada mutación sin recargar toda la página.
- Los componentes coloridos `ActivityForm`/`ActivityTimeline` **se dejan intactos** (siguen sirviendo a `dashboard/recent-activities` y `reports`). No se tocan → cero regresión ahí.

---

## 4. Diseño por unidad

### 4.1 Lógica pura testeable — `src/lib/activities/permissions.ts` (NUEVO)

Extraer la regla RBAC de mutación a una función pura (hoy está embebida en `updateActivity`), para poder testearla con vitest (el repo solo testea lógica pura, env `node`, sin DB):

```ts
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"]

/** ¿Puede el rol modificar/borrar una actividad de la que isOwner indica propiedad? */
export function canModifyActivity(userRole: string, isOwner: boolean): boolean {
  if (OWN_ACCESS_ROLES.includes(userRole)) return isOwner
  return true // roles de equipo/full editan; el filtro de visibilidad ya ocurre en getActivities
}
```

`updateActivity` y el nuevo `deleteActivity` consumen esta función (DRY). Test en `permissions.test.ts`.

### 4.2 Server — `deleteActivity` en `src/server/activities.ts` (EDITAR)

Soft-delete (columna `deletedAt` ya existe, `:878`), mismo patrón RBAC que `updateActivity` pero vía `canModifyActivity`:

```ts
export async function deleteActivity(id: string) {
  const session = await getServerSession()
  if (!session?.user) throw new Error("No autorizado")
  const existing = await prisma.activity.findUnique({ where: { id, deletedAt: null } })
  if (!existing) throw new Error("Actividad no encontrada")
  if (!canModifyActivity(session.user.role, existing.userId === session.user.id)) {
    throw new Error("No tienes permiso para eliminar esta actividad")
  }
  await prisma.activity.update({ where: { id }, data: { deletedAt: new Date() } })
  return { ok: true }
}
```

`updateActivity` se refactoriza para usar `canModifyActivity` en lugar del check inline (`:260-262`).

### 4.3 API — `src/app/api/activities/[id]/route.ts` (NUEVO)

`params` **síncrono** (`{ params }: { params: { id: string } }`), como `deals/[id]/route.ts:120` (este repo NO migró a `Promise<params>`). Envuelve los server actions:

- **`PATCH`** → valida body con zod (`subject?`, `description?`, `dueDate?`, `status?`, `outcome?`, `duration_minutes?`), llama `updateActivity(id, data)`. Completar tarea = `PATCH {status:"COMPLETADA"}`. Mapea errores: "no encontrada" → 404, "permiso" → 403, otro → 500.
- **`DELETE`** → llama `deleteActivity(id)`; mismos mapeos de error.

### 4.4 `ActivityLog` — `src/components/activities/activity-log.tsx` (NUEVO)

Componente cliente B/N. Props:

```ts
interface ActivityLogProps {
  contactId: string                              // contacto al que se asocian nuevas actividades
  contactName: string                            // para mostrar en el form
  dealId?: string                                // si está → timeline scope=deal y nuevas activities llevan dealId
  onChanged?: () => void                         // p.ej. router.refresh() para refrescar métricas del padre
}
```

Comportamiento:
- Al montar y tras cada mutación: `GET /api/activities?{dealId|contactId}=...&pageSize=100` → estado local `activities`.
- **Compositor de nota rápida** (textarea + "Agregar nota", ⌘/Ctrl+Enter): `POST /api/activities {contactId, dealId?, activityType:"NOTE", subject, description, status:"COMPLETADA"}` (igual que `contact-detail.addNote` hoy).
- Botón **"Registrar actividad"** → abre `<ActivityLogForm>` (modal/panel) con contacto+deal preseleccionados.
- **Timeline interactivo** B/N (estética del `<ol>` de `contact-detail:502-543`): por ítem, en hover, acciones de texto secundario:
  - **Completar** (solo `TASK` + `PENDIENTE`) → `PATCH {status:"COMPLETADA"}`.
  - **Editar** → abre `ActivityLogForm` en modo edición (PATCH).
  - **Borrar** → confirm → `DELETE`.
- Tras cualquier mutación: refetch local + `onChanged?.()`.
- Estética: clases globales `form-input`, `btn-primary`, `btn-secondary`, hairlines y vars `--text-*`/`--border-*`/`--bg-*`. **Sin** `bg-blue-100` ni badges de colores. Iconos lucide monocromos (`--text-tertiary`).

### 4.5 `ActivityLogForm` — `src/components/activities/activity-log-form.tsx` (NUEVO)

Form B/N para crear/editar actividad tipada. Reemplaza al `ActivityForm` colorido **solo para los detalles** (no toca el viejo). Props:

```ts
interface ActivityLogFormProps {
  contactId: string
  contactName: string
  dealId?: string
  initial?: ActivityForEdit   // si está → modo edición (PATCH a /api/activities/[id])
  onSaved: () => void
  onCancel: () => void
}
```

- Tipos agrupados (las 4 categorías de `ACTIVITY_TYPE_GROUPS`), asunto, descripción, `dueDate` (solo `TASK`), `duration_minutes` (llamadas/reuniones), `outcome`, `status`.
- Contacto **fijo y mostrado** (no buscador — viene del contexto). Deal: fijo si `dealId`, oculto si no.
- Crear → `POST /api/activities`; editar → `PATCH /api/activities/[id]`.
- Controles con `form-input`/`btn-*`; nada de shadcn colorido.

### 4.6 Detalle de Contacto (EDITAR `contact-detail.tsx`)

- Reemplazar el bloque `Section "Seguimiento"` completo (compositor `addNote` + `<ol>` timeline, `:480-549`) por `<ActivityLog contactId={contact.id} contactName={...} onChanged={() => router.refresh()} />`.
- Borrar la función `addNote` (`:287-307`) y el estado `note`/`savingNote` (migran a `ActivityLog`).
- La métrica "Actividades" (`:416`) y `nextFollowUp` (`:214`) siguen usando `contact.activities` server-side; `onChanged → router.refresh()` las mantiene frescas.

### 4.7 Detalle de Deal (EDITAR `deal-detail-client.tsx`)

- Reemplazar la `Card "Historial de Actividades"` (`:413-459`) por `<ActivityLog contactId={deal.contactId} contactName={...} dealId={deal.id} onChanged={() => router.refresh()} />`.
- El contacto del deal (`deal.contactId`, `deal.contact`) ya está disponible (`:111-114`) → preselección directa, sin fetch extra.

---

## 5. Flujo de datos

```
[ActivityLog en Contacto/Deal]
  montar / tras mutación → GET /api/activities?{dealId|contactId}= → estado local
  nota rápida    → POST /api/activities {NOTE, COMPLETADA}
  registrar      → ActivityLogForm → POST /api/activities
  completar tarea→ PATCH /api/activities/[id] {status:COMPLETADA} → updateActivity()
  editar         → PATCH /api/activities/[id] {...}                → updateActivity()
  borrar         → DELETE /api/activities/[id]                     → deleteActivity() [soft]
  cada mutación  → refetch local + onChanged() (router.refresh del padre)
```

`createActivity` ya marca `COMPLETADA` automáticamente salvo `TASK` (queda `PENDIENTE`) — no se toca.

---

## 6. Manejo de errores

- PATCH/DELETE sin permiso → 403 (vía `canModifyActivity` en el server action).
- ID inexistente / ya soft-deleted → 404.
- Fallo de red en la UI → mensaje inline, no se limpia el form (no perder lo escrito).
- Borrar pide confirmación explícita antes del DELETE.

---

## 7. Pruebas (alineadas al repo real)

El repo solo tiene **tests de lógica pura** (vitest, env `node`, sin DB ni jsdom; `npm test`). API/DB/UI no se testean con vitest aquí.

- **Unit (vitest, TDD):** `src/lib/activities/permissions.test.ts` — `canModifyActivity`: ASESOR dueño→true, ASESOR ajeno→false, ADMIN/GERENTE/TEAM_LEADER→true.
- **Gate de build:** `npm run build` + `npm run lint` verdes tras cada tarea de código.
- **Smoke E2E (Playwright MCP, en ejecución, no archivos commiteados):** login → contacto → registrar llamada con duración (aparece) → nota rápida → crear TASK → completarla → editar → borrar con confirmación → deal → registrar reunión (contacto preseleccionado) → completar/borrar. Patrón Windows ver `[[feedback_playwright_windows]]`.

---

## 8. Fuera de alcance (explícito)

- **Entregable B — Gmail (GW-0 + GW-1):** OAuth web client, envío/recepción, auto-log, `gmail_threads`, hilos. Después, sobre `SPECKIT-GOOGLE-WORKSPACE.md`. **Decisiones ya tomadas:** inbound vía **Pub/Sub push**; Luis ya tiene `GOOGLE_CLIENT_ID/SECRET`. Los correos del B caerán en este mismo `ActivityLog`.
- **Calendar (GW-2) y Contacts (GW-3):** no son "correo"; fuera de este ciclo.
- No se agregan tipos al enum `ActivityType` (ya están todos).
- **No se tocan** `ActivityForm`/`ActivityTimeline` coloridos ni `dashboard`/`reports`.
- Sin migración de BD (todas las columnas existen).

---

## 9. Archivos afectados

| Archivo | Acción |
|---|---|
| `src/lib/activities/permissions.ts` | **NUEVO** — `canModifyActivity` puro |
| `src/lib/activities/permissions.test.ts` | **NUEVO** — vitest |
| `src/server/activities.ts` | + `deleteActivity()`; `updateActivity` usa `canModifyActivity` |
| `src/app/api/activities/[id]/route.ts` | **NUEVO** — PATCH + DELETE |
| `src/components/activities/activity-log.tsx` | **NUEVO** — compositor + timeline B/N interactivo |
| `src/components/activities/activity-log-form.tsx` | **NUEVO** — form B/N crear/editar |
| `src/components/contacts/contact-detail.tsx` | montar `ActivityLog`; quitar `addNote`/timeline bespoke |
| `src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx` | montar `ActivityLog`; quitar historial bespoke |

Sin migración de BD.
