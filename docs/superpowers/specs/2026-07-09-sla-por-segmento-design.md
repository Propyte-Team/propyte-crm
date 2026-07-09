# Fase 3 sub-D — SLA por segmento + minutos hábiles

**Fecha:** 2026-07-09
**Rama:** `feat/crm-sla-por-segmento` (worktree off `origin/main` `97bb004`)
**Estado:** diseño aprobado por Luis ("si hazlo", 2026-07-09)

## Problema

Hoy `createSlaTimer(contactId, type)` usa `defaultPolicy()` = **una sola** `SlaPolicy` global (`isDefault:true, isActive:true`) y calcula `dueAt = now + minutes` en tiempo de reloj. No se puede:

1. Tener SLAs distintos por **segmento** (origen, campaña, tipo de contacto, plaza…).
2. Respetar **horario laboral**: un lead de las 11pm con SLA de 5 min "vence" de madrugada aunque nadie trabaje.

El modelo `SlaPolicy` ya trae `businessHours Json`, `escalationChain`, `channelFallback` sin usarse para el cálculo. `RoutingRule` ya define el patrón a copiar (`conditions Json` + `priority Int`).

## Alcance (sub-D)

- Selección de política SLA **por segmento** vía el DSL de condiciones existente + prioridad.
- Cálculo de `dueAt` por **acumulación de minutos hábiles** según el horario de la política.
- CRUD completo de políticas + editor de horario en la UI de `/configuracion`.

**Fuera de alcance (follow-ups):** festivos, múltiples ventanas por día (comida), `escalationChain`/`channelFallback` UI, hacer `isBusinessHoursNow()` (condición WF2) policy-aware.

## Decisiones (brainstorming)

1. **Matching = DSL de condiciones + `priority`** (consistente con `RoutingRule`/reglas; reusa `ConditionTreeEditor` y `evaluateConditions`).
2. **Incluir businessHours** en el cálculo del vencimiento.
3. **Semántica = acumular minutos hábiles** (no solo correr el inicio).

## Arquitectura

### Modelo (migración aditiva)

```prisma
model SlaPolicy {
  // ...campos existentes...
  conditions Json @default("{}")   // NUEVO — DSL all/any/leaf; {} = sin condiciones
  priority   Int  @default(100)    // NUEVO — menor = mayor prioridad
  // businessHours Json @default("{}")  // YA EXISTE — se empieza a usar
}
```

`businessHours` shape (v1):
```jsonc
{}  // vacío = wall-clock (comportamiento actual, la "Default Propyte" queda así)
// o:
{
  "tz": "America/Cancun",
  "days": {                 // 0=domingo … 6=sábado; [aperturaMin, cierreMin] desde medianoche; null = cerrado
    "0": null,
    "1": [540, 1080],       // 09:00–18:00
    "6": [600, 840]         // 10:00–14:00
  }
}
```

La "Default Propyte" existente conserva `conditions={}`, `priority=100`, `businessHours={}` → **fallback idéntico a hoy** (test de regresión obligatorio).

### Unidad pura 1 — selección de política

`src/lib/workflows/sla-select.ts`
```
selectSlaPolicy(policies: SlaPolicyLike[], ctx: Record<string,unknown>): SlaPolicyLike | null
```
- Candidatas = `policies` **activas, no-default**, ordenadas por `priority` asc, luego `name`.
- Devuelve la **primera cuyas `conditions` cumplen** `ctx` (vía `evaluateConditions`).
- Si ninguna → la **default activa** (`isDefault && isActive`). Si no hay → `null`.
- Función pura (recibe la lista ya cargada); sin BD.

### Unidad pura 2 — minutos hábiles

`src/lib/workflows/business-hours.ts`
```
computeDueAt(startAt: Date, minutes: number, businessHours: BusinessHours | null): Date
```
- `businessHours` vacío/`null`/sin `days` → `new Date(startAt + minutes*60000)` (wall-clock).
- Con horario: convierte `startAt` a la `tz`, avanza acumulando **solo minutos dentro de ventanas abiertas**, saltando cierres (noches, días `null`), cruzando días hasta consumir `minutes`; devuelve el instante **UTC** resultante.
- Casos borde cubiertos por tests: inicio antes de apertura (cuenta desde apertura), dentro de ventana, después del cierre (siguiente apertura), spill multi-día, semana con días cerrados, `minutes=0`, semana entera cerrada (guarda anti-loop → cae a wall-clock + warning).
- 1 ventana/día, sin festivos (v1).

### Orquestación

`src/lib/workflows/sla.ts` → `createSlaTimer(contactId, type, dealId?)`:
1. `loadSlaContext(contactId)` — reusa `loadEntityContext("contact", contactId)` y expone `plaza` desde el owner asignado (`contact.owner.plaza`) para poder segmentar por plaza.
2. Carga políticas activas; `selectSlaPolicy(policies, ctx)`.
3. `minutes` por tipo desde la política elegida (fallback 5/30/24 si `null`).
4. `dueAt`:
   - `FIRST_TOUCH` y `RETRY` → `computeDueAt(now, minutes, policy.businessHours)`.
   - `ORPHAN` → wall-clock siempre (guardia de inactividad en horas calendario).
5. Crea `SlaTimer` con `policyId` de la elegida (o `null`).
- Se conserva la guarda "no duplicar timer RUNNING del mismo tipo".

### API

Espejo del patrón de `plans`/`rules`:
- **`POST /api/admin/automation/sla`** — crear política (zod, RBAC ADMIN/DIRECTOR, `name` único → 409).
- **`PUT /api/admin/automation/sla/[id]`** — editar (incluye `conditions`/`priority`/`businessHours`/`name`/`isActive`/`isDefault`/minutos). P2025→404.
- **`DELETE /api/admin/automation/sla/[id]`** — borrar. No permitir borrar la única default (o reasignar). P2025→404.
- `isDefault=true` → desmarca el resto en `$transaction` (solo una default).
- `GET /api/admin/automation` ya devuelve `slaPolicies`; asegurar que incluya `conditions`/`priority`/`businessHours`. El PATCH `kind:"sla"` de minutos sigue funcionando (retrocompat).
- Zod del `businessHours`: `tz` string, `days` mapa `"0".."6"` → tupla `[int 0..1440, int 0..1440]` (apertura<cierre) o `null`.

### UI

`src/components/config/automation-section.tsx`, sección "Políticas SLA":
- Lista de políticas (badge `default`, prioridad, nº timers) + botón **"Nueva política"**.
- Editor por política: `name`, `isActive`, `isDefault`, `priority`, **`ConditionTreeEditor`** (reuso; oculto/no-aplica para la default), 3 minutos, y **editor de horario**: select `tz` + 7 filas (día → apertura/cierre `<input type=time>` o toggle "cerrado"). Guardar/Borrar con confirm.
- RBAC ADMIN/DIRECTOR (igual que el resto de la sección).

## Testing (TDD)

- `sla-select.test.ts`: precedencia por prioridad, primera que cumple gana, fallback a default, sin match y sin default → null, ignora inactivas, ignora default en la fase de match.
- `business-hours.test.ts`: wall-clock (bh vacío), inicio antes/dentro/después de ventana, cruce de día, salto de día cerrado/fin de semana, `minutes=0`, semana cerrada (fallback), tz aplicada.
- `sla.createTimer.test.ts`: elige política por ctx, usa sus minutos, aplica businessHours a FIRST_TOUCH/RETRY y wall-clock a ORPHAN, guarda anti-duplicado, regresión "default sin condiciones/horario == comportamiento actual".
- API: `sla/route` (POST zod+RBAC+409 nombre único), `sla/[id]` (PUT/DELETE, 404/409, isDefault único), `businessHours` zod válido/ inválido.

## Riesgos / notas

- **Migración a BD compartida `oaijxdpevakashxshhvm`** (aditiva: 2 columnas nullable/default) → requiere frase de autorización explícita de Luis; se aplica ANTES del deploy del código que lea las columnas (o el código degrada si faltan). SQL manual respeta naming Prisma (`propyte_crm."sla_policies"`, columnas camelCase).
- Los enum/shape de un ActionType no aplican aquí (no se agrega ActionType); pero `businessHours` shape vive en 3 lugares: zod (validación API) + calculadora + editor UI → mantener en sync.
- `plaza` como campo segmentable exige exponerlo en el contexto SLA y ofrecerlo en el editor de condiciones (verificar el set de campos del `ConditionTreeEditor` en el plan).
- El cron `/api/cron/workflows` (checkSlaBreaches) ya existe; sub-D no cambia el ciclo de breach, solo el cálculo de `dueAt`.
