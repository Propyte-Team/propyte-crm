# Diseño — Sistema de Actividades en Contacto y Deal (Entregable A)

> **Fecha:** 2026-06-13
> **Stack:** propyte-crm (Next.js 14 + Prisma + Supabase + NextAuth)
> **Rama base:** `main`
> **Relación:** Entregable A de 2. El B (Integración Gmail GW-0+GW-1, speckit `SPECKIT-GOOGLE-WORKSPACE.md`) se hace después y reutiliza el timeline que deja A.

---

## 1. Problema

El modelo de datos de actividades **ya existe y es completo**, pero está **huérfano en la UI**:

- `Activity` (Prisma, `schema.prisma:859`) + enum `ActivityType` (`:277`) con los 17 tipos: `CALL_OUTBOUND/INBOUND`, `WHATSAPP_OUT/IN`, `SMS_OUT/IN`, `EMAIL_SENT/RECEIVED`, `MEETING_VIRTUAL/PRESENTIAL/SHOWROOM`, `DISCOVERY_CALL`, `PROPOSAL_DELIVERY`, `FOLLOW_UP`, `WALK_IN` (visita), `NOTE`, `TASK`, `CONTRACT_REVIEW`, `CLOSING_ACTIVITY`.
- `src/server/activities.ts`: `getActivities`, `createActivity`, `updateActivity`, `getActivityStats`, `getOverdueTasks`, `getActivityAgreementProgress` (todas con RBAC own/team/full-access).
- `src/components/activities/activity-form.tsx`: formulario que expone **los 17 tipos** agrupados en 4 categorías, soporta `preselectedContactId` y `preselectedDealId`, postea a `POST /api/activities`.
- `src/components/activities/activity-timeline.tsx`: `ActivityTimeline`, render **solo-lectura** de un `activities[]`.

**Brechas (lo que el usuario percibe como "faltantes"):**

1. **`ActivityForm` nunca se monta** en detalle de contacto ni de deal → no se puede registrar una llamada/whatsapp/reunión/visita/correo desde donde se trabaja.
2. **Contacto** (`src/components/contacts/contact-detail.tsx`) solo tiene una caja de "nota" hardcodeada a `activityType: "NOTE"` (`:291-301`) y un **timeline propio bespoke** (no usa `ActivityTimeline`).
3. **Deal** (`src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx:413-459`) solo muestra un "Historial de Actividades" **de solo-lectura**, sin botón para registrar ni componer nota.
4. **No existe `/api/activities/[id]`** → no hay forma REST de editar, **completar una tarea**, cancelar o borrar una actividad desde la UI. El server action `updateActivity` existe pero no está expuesto.
5. **Dos implementaciones del mismo timeline** (la bespoke de contacto vs. `ActivityTimeline`).

---

## 2. Objetivo

Que un asesor pueda, **desde el detalle de contacto y desde el detalle de deal**:

- Registrar cualquier tipo de actividad (llamada, whatsapp, reunión, visita, correo, nota, tarea) con el contexto (contacto/deal) preseleccionado.
- Ver todas las actividades en un **timeline unificado** mezcladas cronológicamente.
- **Completar tareas**, editar y cancelar/borrar actividades desde ese timeline.

Sin dependencias externas (no toca Google). Es el cimiento del timeline donde el Entregable B (Gmail) inyectará los correos.

---

## 3. Diseño por unidad

### 3.1 API — `src/app/api/activities/[id]/route.ts` (NUEVO)

Expone los server actions existentes vía REST. Patrón idéntico a otras rutas dinámicas del repo (Next.js 14 → `params` síncrono; **verificar** firma vs. `deals/[id]/route.ts` por si el repo ya migró a `Promise<params>`).

- **`PATCH /api/activities/[id]`** → llama `updateActivity(id, body)`. Acepta `subject?`, `description?`, `dueDate?`, `status?`, `outcome?`, `duration_minutes?`. `updateActivity` ya setea `completedAt` cuando `status → COMPLETADA`, así que "completar tarea" = `PATCH { status: "COMPLETADA" }`. RBAC heredado del server action.
- **`DELETE /api/activities/[id]`** → soft-delete. Requiere **nueva función `deleteActivity(id)`** en `src/server/activities.ts` que ponga `deletedAt = now()` (la columna ya existe, `:878`) con el mismo guard RBAC que `updateActivity`. `getActivities` debe filtrar `deletedAt: null` (verificar que ya lo haga; si no, agregarlo).

**Sin endpoints nuevos de creación**: `POST /api/activities` ya sirve.

### 3.2 `ActivityTimeline` → interactivo (EDITAR `activity-timeline.tsx`)

Mantenerlo reutilizable. Agregar **props opcionales**:

```ts
onComplete?: (id: string) => void   // botón "Completar" solo en TASK + status PENDIENTE
onEdit?: (activity: Activity) => void
onDelete?: (id: string) => void     // con confirmación
```

- Si no se pasan callbacks → se comporta como hoy (solo-lectura). No rompe ningún consumidor actual (dashboard `recent-activities`, reports).
- Botones discretos por ítem (hover/menú), acordes al craft B/N del CRM (ver `[[feedback_ui_craft_no_admin_template]]`): nada de iconitos de colores; acciones como texto/áfono secundario.

### 3.3 Detalle de Contacto (EDITAR `contact-detail.tsx`)

- **Reemplazar** el timeline bespoke por `<ActivityTimeline>` con los 3 callbacks cableados a `PATCH`/`DELETE`.
- Agregar acción **"Registrar actividad"** que abre el `ActivityForm` (drawer o sección expandible, según el patrón visual existente del detalle) con `preselectedContactId={contact.id}`.
- **Nota rápida:** conservar la caja de nota actual como atajo (postea `NOTE`), pero que al guardar refresque el timeline unificado. No duplicar render: una sola lista.
- Tras crear/editar/completar/borrar → refetch del timeline (callback `onSaved` del form + re-fetch `getActivities({contactId})`).

### 3.4 Detalle de Deal (EDITAR `deal-detail-client.tsx`)

- **Reemplazar** la card "Historial de Actividades" solo-lectura (`:413-459`) por `<ActivityTimeline>` interactivo (mismos callbacks).
- Agregar **"Registrar actividad"** que abre el `ActivityForm` con `preselectedDealId={deal.id}` **y** `preselectedContactId={deal.contactId}` (el contacto del deal). → cubre la brecha del speckit-explore: hoy el form no auto-puebla el contacto al abrir desde un deal.
- Refetch tras cambios.

### 3.5 `ActivityForm` (EDITAR `activity-form.tsx`)

Único cambio: cuando recibe `preselectedDealId`, **derivar y preseleccionar el contacto** del deal (hoy exige buscarlo a mano). El contacto del deal se pasa como prop desde deal-detail (ya disponible), evitando un fetch extra.

---

## 4. Flujo de datos

```
[Contacto/Deal detail]
  registrar → ActivityForm → POST /api/activities → createActivity()
                                                       → (ya dispara dispatchWebhook "activity.created")
  completar tarea → PATCH /api/activities/[id] {status:COMPLETADA} → updateActivity()
  editar         → PATCH /api/activities/[id] {...}                → updateActivity()
  borrar         → DELETE /api/activities/[id]                     → deleteActivity() [soft]
  cada cambio    → refetch getActivities({contactId|dealId}) → re-render ActivityTimeline
```

`createActivity` ya marca `COMPLETADA` automáticamente para todos los tipos salvo `TASK` (queda `PENDIENTE`) — comportamiento correcto, no se toca.

---

## 5. Manejo de errores

- PATCH/DELETE sobre actividad de otro usuario sin permiso → 403 (heredado del guard RBAC del server action; replicar el guard en `deleteActivity`).
- ID inexistente o ya soft-deleted → 404.
- Fallo de red en la UI → toast de error, no se limpia el form (no perder lo escrito).
- `dispatchWebhook` ya es fire-and-forget en `createActivity`; un fallo de webhook no debe romper la creación (verificar que esté en try/catch).

---

## 6. Pruebas

- **Unit (server):** `deleteActivity` respeta RBAC (own/team/full) y setea `deletedAt`; `getActivities` excluye soft-deleted.
- **Integration (API):** PATCH completa una TASK (status→COMPLETADA, completedAt set); DELETE soft-borra; 403 cross-user; 404 inexistente.
- **E2E (Playwright, patrón del repo `[[feedback_playwright_windows]]`):** desde un contacto → registrar una llamada con duración → aparece en timeline; completar una tarea; desde un deal → registrar reunión con contacto auto-preseleccionado; borrar con confirmación.

---

## 7. Fuera de alcance (explícito)

- **Entregable B — Gmail (GW-0 + GW-1):** OAuth web client, envío/recepción, auto-log de correos, `gmail_threads`, expand de hilo. Se hará después sobre `SPECKIT-GOOGLE-WORKSPACE.md`. **Decisiones ya tomadas para B:** inbound vía **Pub/Sub push** (no polling); Luis ya tiene `GOOGLE_CLIENT_ID/SECRET`. Los correos del Entregable B caerán en el `ActivityTimeline` que deja A.
- **Calendar (GW-2) y Contacts (GW-3):** no son "correo"; fuera de este ciclo.
- No se agregan tipos al enum `ActivityType` (ya están todos).
- No se crea vista global de actividades nueva (el dashboard ya tiene `recent-activities`).

---

## 8. Archivos afectados

| Archivo | Acción |
|---|---|
| `src/app/api/activities/[id]/route.ts` | **NUEVO** — PATCH + DELETE |
| `src/server/activities.ts` | + `deleteActivity()`; verificar filtro `deletedAt:null` en `getActivities` |
| `src/components/activities/activity-timeline.tsx` | + props `onComplete/onEdit/onDelete` (opcionales) |
| `src/components/activities/activity-form.tsx` | preseleccionar contacto cuando hay `preselectedDealId` |
| `src/components/contacts/contact-detail.tsx` | montar form + `ActivityTimeline` interactivo; unificar nota |
| `src/app/(dashboard)/pipeline/[id]/deal-detail-client.tsx` | montar form + `ActivityTimeline` interactivo |

Sin migración de BD (todas las columnas existen).
