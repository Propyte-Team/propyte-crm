# MAKE_CALL real — tarea de llamada + click-to-call (Fase 3 sub-E2) — Diseño

**Fecha:** 2026-06-26
**Sub-proyecto:** Fase 3 — E2 (MAKE_CALL). Cierra la "E" (E1 = SEND_EMAIL ya desplegado).
**Rama:** `feat/crm-call-task` (worktree `.claude/worktrees/crm-call-task`, desde `origin/main` `563ad61`)
**Estado:** aprobado por Luis (brainstorming)

## Problema

La acción de workflow `MAKE_CALL` hoy es **no-op** (`actions.ts`: `{ skipped: true, note: "Dialer disponible en fase posterior (voz)" }`). El motor puede encolar `MAKE_CALL` pero no produce nada. Un workflow **no puede "marcar" por sí mismo** (no hay humano; el asesor puede estar offline; una llamada robotizada saliente no es opción por legalidad). La infra de voz (Twilio click-to-call, PR #11) ya existe: `useVoice().startCall(to, contactId, userId)` en el navegador.

## Decisión (confirmada)

`MAKE_CALL` = **crea una TAREA de llamada** (Activity) para el asesor asignado **+ notificación**. El asesor la ve y **marca con 1 clic** reusando el dialer existente. **Sin auto-dial.** La tarea de llamada se modela con un **nuevo `ActivityType.CALL_TASK`** (migración aditiva). El botón "Llamar" aparece en la **ficha del contacto** (lista de actividades) y en **Hoy/tareas**.

## Componentes

### 1. Migración aditiva — `ActivityType += CALL_TASK`

- `prisma/schema.prisma`: agregar `CALL_TASK` al `enum ActivityType` (junto a CALL_OUTBOUND/CALL_INBOUND/TASK/FOLLOW_UP/…).
- SQL (vía MCP, con autorización de Luis): `ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'CALL_TASK';`
- `npx prisma generate` tras editar el schema.
- Aditiva: no afecta filas existentes, no se borra nada. Gate de infra (Supabase compartida) → la aplica el flujo con la frase de Luis.

### 2. Runner `MAKE_CALL` (actions.ts)

Reemplaza el no-op (espejo de `CREATE_TASK` + `NOTIFY`):
1. `contact` requerido; si `!contact?.phone` → skip "Contacto sin teléfono"; si `contact.doNotContact` → skip "Opt-out".
2. `userId = await ownerUserId(contact)`; si null → skip "Sin usuario destino".
3. `prisma.activity.create`:
   ```
   activityType: "CALL_TASK",
   contactId: contact.id,
   dealId: item.entityType === "deal" ? item.entityId : undefined,
   userId,
   subject: String(config.subject ?? `Llamar a ${contact.firstName ?? "contacto"}`),
   description: config.reason ? String(config.reason) : (config.description ? String(config.description) : null),
   dueDate: new Date(Date.now() + (typeof config.dueInMinutes === "number" ? config.dueInMinutes : 60) * 60_000),
   status: "PENDIENTE",
   ```
4. `prisma.notification.create`: `{ userId, title: "Llamada pendiente", message: subject, type: "call_task", link: \`/contacts/${contact.id}\` }`.
5. Devuelve `{}`.

> Default de vencimiento: **60 min** (una llamada de seguimiento es urgente, no a 24h como una tarea genérica).

### 3. Botón "Llamar" (1 clic) en tareas de llamada

El dialer se dispara con `useVoice().startCall(to, contactId, userId)` (contexto de `src/components/voice/voice-device-provider.tsx`, montado globalmente en `providers.tsx`). En las filas de actividad/tarea con `activityType === "CALL_TASK"` y `status === "PENDIENTE"`, renderizar un botón **"Llamar"** que invoque `startCall(contact.phone, contact.id, userId)`.

- **Ficha del contacto** (lista de actividades): el componente que lista las `Activity` del contacto. El teléfono y el id del contacto ya están en contexto.
- **Hoy / tareas pendientes**: la lista de tareas del asesor. Requiere que la query incluya el **teléfono del contacto** de cada tarea (si hoy no lo trae, agregarlo al `select`/include). El `userId` para `startCall` = el usuario en sesión.
- El botón solo se muestra si hay teléfono. Al hacer clic, `startCall` toma el control (estados connecting/ringing/in-call vía el provider). El cierre/log de la llamada ya lo maneja el flujo del PR #11 (auto-log `CALL_OUTBOUND` por `callSid`).

### 4. Componente reutilizable

Extraer un `CallTaskButton` pequeño (`"use client"`) que reciba `{ phone, contactId }`, lea `useVoice()` + la sesión (o reciba `userId`), y renderice el botón "Llamar" (deshabilitado si el Device no está `ready` o no hay teléfono). Se usa en ambos lugares (ficha + Hoy) para no duplicar.

## Pruebas

- **Unit `MAKE_CALL` runner:** crea Activity `CALL_TASK` + Notification con los campos correctos; skip sin teléfono / opt-out / sin owner. (prisma mockeado, mismo patrón que otros tests de `actions.ts`.)
- **UI `CallTaskButton`:** se renderiza para `CALL_TASK` pendiente con teléfono; invoca `startCall(phone, contactId, userId)` al clic; deshabilitado sin teléfono / Device no listo. (test ligero con `useVoice` mockeado, o verificación manual si el patrón de test de componentes con contexto no existe en el repo.)
- Build + suite verdes. ff-push a main → auto-deploy.

## Fuera de alcance (futuro)

- **Auto-dial por presencia** (timbrar al asesor si su Device está online).
- **Auto-completar** la tarea `CALL_TASK` cuando la llamada se conecta/loguea (v1: el asesor la cierra con el flujo de tareas existente, o queda pendiente). Vincular el `CALL_OUTBOUND` logueado a la `CALL_TASK` que lo originó = futuro.
- SLA específico de llamadas; cadencias de re-intento de llamada.

## Notas / consistencia

- `ActivityType` se usa en varios lugares (runner, listas de actividades, posiblemente filtros/labels de UI). Al agregar `CALL_TASK`, revisar que ningún `switch`/mapa de labels exhaustivo se rompa o muestre el valor crudo — agregar etiqueta "Llamada pendiente"/ícono donde se mapeen los tipos.
- Idempotencia: la cola (`action_queue` + dedupeKey) evita doble-tarea; el runner no agrega dedup propio.
- El botón vive dentro del `VoiceDeviceProvider` (ya envuelve la app en `providers.tsx`), así que `useVoice()` está disponible en ficha y en Hoy.
