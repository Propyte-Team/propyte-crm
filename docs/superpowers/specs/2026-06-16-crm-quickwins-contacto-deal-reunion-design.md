# CRM quick-wins: asignar asesor · crear deal inline · gate de reunión

> Fecha: 2026-06-16. Tres mejoras de UX del flujo contacto/deal, en un solo spec.
> Pedido de Luis. Rama destino: nueva rama de feature.

## Resumen

1. **Crear deal inline desde el contacto** — el botón deja de redirigir a `/pipeline`; abre un modal con el `DealForm` existente.
2. **Asignar/reasignar asesor directo** — selector inline de asesor en el detalle de Contacto y de Deal (hoy es read-only).
3. **Gate de reunión al cambiar de etapa** — mover un deal a una etapa de reunión obliga a registrar la reunión, enlazando agendada → realizada sin duplicar.

Ninguna requiere migración de BD. Las APIs ya aceptan lo necesario.

---

## Mejora 1 — Crear deal inline desde el contacto

**Estado hoy:** `src/components/contacts/contact-detail.tsx` tiene 2 botones "Crear Deal" (~líneas 335 y 435) que hacen `router.push('/pipeline?newDeal=true&contactId=...')`.

**Diseño:**
- Añadir estado `const [dealOpen, setDealOpen] = useState(false)` en `contact-detail.tsx`.
- Ambos botones "Crear Deal" → `onClick={() => setDealOpen(true)}`.
- Montar un `<Dialog open={dealOpen} onOpenChange={setDealOpen}>` (mismo `@/components/ui/dialog` que ya usa el modal de edición de esa página) con:
  ```tsx
  <DealForm
    initialData={{ contactId: contact.id }}
    onSuccess={() => { setDealOpen(false); router.refresh(); }}
    onCancel={() => setDealOpen(false)}
  />
  ```
- Importar `DealForm` de `@/components/pipeline/deal-form`.

**Sin backend.** Reusa `DealForm`, `Dialog`, `POST /api/deals`. El flujo `/pipeline?newDeal=true` queda intacto para la página de pipeline.

---

## Mejora 2 — Asignar/reasignar asesor directo (contacto + deal)

**Estado hoy:** el `assignedTo` se muestra read-only en el detalle de Contacto (`contact-detail.tsx` ~394) y de Deal (`pipeline/[id]/deal-detail-client.tsx` ~374-397). Las APIs ya aceptan `assignedToId`:
- Contacto: `PUT /api/contacts?id=<id>` (connect/disconnect, permite null).
- Deal: `PATCH /api/deals/[id]` (`assignedToId` requerido, no nullable).
- Asesores: `GET /api/users?role=ASESOR,ASESOR_SR,ASESOR_JR,TEAM_LEADER&isActive=true&basic=true` → `{ data: [{id,name,email,role,plaza}] }`.

**Diseño:**
- Componente compartido `src/components/shared/advisor-select.tsx` (`"use client"`): trae los asesores una vez y renderiza un `<select>` (estilo `form-input`). Props: `value: string | null`, `onChange: (id: string | null) => void`, `allowUnassigned?: boolean` (muestra "Sin asignar"), `disabled?`.
- **Contacto:** la fila "Asesor" pasa de `ReadRow` a `AdvisorSelect` con `allowUnassigned`; al cambiar, persiste con el helper `changeField()` ya existente (`PUT /api/contacts?id=`), luego `router.refresh()`/estado local.
- **Deal:** la card "Asesor Asignado" gana el `AdvisorSelect` (sin "Sin asignar"); al cambiar, `PATCH /api/deals/[id]` `{ assignedToId }`, luego `router.refresh()`.
- Optimismo opcional; suficiente con refrescar tras éxito.

**Sin backend.**

---

## Mejora 3 — Gate de reunión al cambiar de etapa

**Estado hoy:**
- Etapas de reunión (`DealStage`): `MEETING_SCHEDULED` ("Reunión Agendada"), `MEETING_COMPLETED` ("Reunión Realizada").
- Mover de etapa (kanban `kanban-board.tsx` y selector del detalle) embudo en `StageTransitionDialog` (`src/components/pipeline/stage-transition-dialog.tsx`). Hoy solo abre diálogo para `["DISCOVERY_DONE","RESERVED","WON","LOST"]` (`STAGES_REQUIRING_DIALOG`).
- Tipos de reunión (`ActivityType`): `MEETING_VIRTUAL`, `MEETING_PRESENTIAL`, `MEETING_SHOWROOM`.
- `createActivity` (`src/server/activities.ts`) **ya acepta** `status?: ActivityStatus` y `dueDate?: Date`; pone `completedAt` cuando el status final es `COMPLETADA`. `updateActivity` ya setea `outcome` + status + `completedAt`.

**Diseño:**

1. **Disparo:** agregar `MEETING_SCHEDULED` y `MEETING_COMPLETED` a `STAGES_REQUIRING_DIALOG` (en `kanban-board.tsx`; el selector del detalle ya reusa el mismo diálogo).

2. **`StageTransitionDialog` — rama por etapa destino:**

   **a) `MEETING_SCHEDULED` (Agendar) — obligatorio:**
   - Sección "Agendar reunión": tipo (`MEETING_VIRTUAL/PRESENTIAL/SHOWROOM`), fecha y hora (futura, requerida), nota opcional.
   - Al confirmar: `POST /api/activities` con `{ contactId: deal.contactId, dealId: deal.id, activityType: <tipo>, subject: "Reunión agendada", dueDate: <fecha>, status: "PENDIENTE", description: <nota?> }`. **Luego** se aplica el cambio de etapa (PATCH deal). Sin la reunión no se completa el cambio (botón confirmar deshabilitado).

   **b) `MEETING_COMPLETED` (Realizada) — sin duplicar:**
   - Al abrir el diálogo: buscar la reunión **pendiente más reciente** del deal vía `GET /api/deals/[id]/pending-meeting`.
   - **Si existe:** mostrarla read-only (tipo, fecha agendada) + campo **"Resultado"** (requerido). Al confirmar: `PATCH /api/activities/[id]` con `{ status: "COMPLETADA", outcome: <resultado> }` (esa misma actividad se completa; **no se crea otra**). Luego cambio de etapa.
   - **Si NO existe** (saltó directo a Realizada): mostrar formulario de reunión realizada desde cero: tipo + fecha (pasada/hoy) + resultado (requerido). Al confirmar: `POST /api/activities` `{ ..., activityType, dueDate, status: "COMPLETADA", outcome }`. Luego cambio de etapa.

3. **Backend (mínimo):**
   - Nuevo: `getLatestPendingMeeting(dealId)` en `src/server/activities.ts` — `Activity` donde `dealId`, `activityType in [MEETING_VIRTUAL,MEETING_PRESENTIAL,MEETING_SHOWROOM]`, `status = "PENDIENTE"`, `deletedAt = null`, orden `dueDate desc` (fallback `createdAt desc`), `take 1`.
   - Nueva ruta `GET /api/deals/[id]/pending-meeting` → `{ data: Activity | null }` (auth sesión, `params` síncrono).
   - `createActivity` y `updateActivity` **se reusan tal cual** (ya soportan status/dueDate/outcome).

4. **Orden y errores:** crear/completar la actividad **primero**, luego el PATCH de etapa. Si el PATCH falla, mostrar error (la reunión ya quedó guardada; reintentar el cambio). No es transaccional cross-tabla (aceptable v1).

**Sin migración de BD.**

---

## Pruebas

- `getLatestPendingMeeting` — test puro no aplica (toca Prisma); se valida por build + smoke.
- Helper puro testeable: `requiresMeetingGate(toStage)` (true para las 2 etapas de reunión) y `meetingStageMode(toStage)` → `"schedule" | "complete"`, en un módulo nuevo `src/lib/pipeline/meeting-gate.ts`, con test vitest.
- Build verde + smoke local: arrastrar deal a "Agendada" → registrar → ver Activity Pendiente; arrastrar a "Realizada" → ver la agendada precargada → capturar resultado → Activity Completada (una sola). Probar fallback sin reunión previa. Probar asignar asesor en contacto y deal. Probar crear deal inline desde contacto.

## Riesgos / notas

- BD compartida con prod: estas mejoras crean Activities/actualizan asignaciones reales. Hacer el smoke con un contacto/deal de prueba y limpiar. Crear/mover deals puede disparar automation_rules/agentes activos — usar datos de prueba con cuidado (igual que en la sesión anterior).
- Verificar en implementación los nombres exactos de campos de `Activity` (`dueDate`, `completedAt`, `outcome`, `subject`, `description`) y la firma real de `StageTransitionDialog` (cómo aplica hoy el cambio de etapa) antes de cablear.
- `AdvisorSelect` reutiliza el endpoint y la lista de roles ya usados por `contact-form.tsx`.
