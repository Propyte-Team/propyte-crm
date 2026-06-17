# Metas y Scorecard por asesor (§5.14)

> Fecha: 2026-06-16. Deriva del speckit consolidado §5.14 (Materializa P5: visibilidad para Dirección; paridad con "Metas Personalizadas" de Zoho).
> Rama destino: nueva, apilada sobre el trabajo en curso del CRM.

## Problema / objetivo

El admin/TL fija **metas mensuales por asesor / equipo / empresa** sobre métricas de venta; el sistema calcula **real-vs-meta** (el real se **deriva** de datos existentes, no se duplica) y muestra un scorecard. Alimenta el dashboard de Dirección y el "mi avance del mes" del asesor en `/hoy`.

## Supuestos (aprobados por Luis)

- **Captaciones** = `Contact` nuevos asignados al asesor en el mes (la captación write-through al Hub aún no existe).
- **Monto de venta** se mide por moneda: la meta es MXN o USD; el real suma deals WON de esa misma moneda (sin conversión FX en v1).

## Modelo de datos (additivo — esquema `propyte_crm`)

```prisma
enum GoalScope { USER  TEAM  COMPANY  @@schema("propyte_crm") }

enum GoalMetric {
  CAPTACIONES
  NEGOCIOS_CREADOS
  COTIZACIONES_ENVIADAS
  ACTIVIDADES_COMPLETADAS
  NEGOCIOS_GANADOS
  MONTO_VENTA
  @@schema("propyte_crm")
}

model Goal {
  id          String     @id @default(uuid())
  scope       GoalScope
  userId      String?                       // requerido si scope=USER
  user        User?      @relation("UserGoals", fields: [userId], references: [id])
  teamId      String?                       // requerido si scope=TEAM
  team        Team?      @relation(fields: [teamId], references: [id])
  period      DateTime                       // 1er día del mes (00:00 UTC)
  metric      GoalMetric
  target      Decimal    @db.Decimal(14, 2)
  currency    Currency?                      // solo aplica a MONTO_VENTA
  createdById String
  createdBy   User       @relation("GoalsCreated", fields: [createdById], references: [id])
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  deletedAt   DateTime?

  @@unique([scope, userId, teamId, period, metric, currency])
  @@index([period])
  @@index([userId])
  @@index([teamId])
  @@map("goals")
  @@schema("propyte_crm")
}
```

- Relaciones inversas: `User.goals @relation("UserGoals")`, `User.goalsCreated @relation("GoalsCreated")`, `Team.goals`.
- `currency` nullable: para métricas ≠ MONTO_VENTA es `null` (forma parte del unique para no chocar entre MXN/USD del mismo mes).

**Migración:** `prisma/migrations-manual/2026-06-16-goals.sql` — additiva idempotente (2 enums vía `DO $$`, tabla `goals` con FKs a `users`/`teams`, índices). NO se aplica sin OK explícito ("aplica la migración goals") → MCP + `prisma generate`.

## Derivación del "real" — `src/server/goals.ts`

`computeActual(input: { metric, scope, userId?, teamId?, period, currency? }): Promise<number>`

- **Rango del mes:** `start = period`, `end = addMonths(period, 1)` (date-fns). Filtro `>= start AND < end`.
- **Resolución de scope a filtro de usuario(s):**
  - USER → un userId.
  - TEAM → `userIds = (TeamMember where teamId, leftAt: null).map(userId)`.
  - COMPANY → sin filtro de usuario.
- **Por métrica** (todas con `deletedAt: null` donde aplique):

| Métrica | Query |
|---|---|
| CAPTACIONES | `contact.count` where `createdAt` en rango + (`assignedToId` = userId / `in` userIds / —) |
| NEGOCIOS_CREADOS | `deal.count` where `createdAt` en rango + `assignedToId` filtro |
| COTIZACIONES_ENVIADAS | `quote.count` where `status: "SENT"` + `sentAt` en rango + `deal.assignedToId` filtro (relación) |
| ACTIVIDADES_COMPLETADAS | `activity.count` where `status: "COMPLETADA"` + `completedAt` en rango + `userId` filtro |
| NEGOCIOS_GANADOS | `deal.count` where `stage: "WON"` + `actualCloseDate` en rango + `assignedToId` filtro |
| MONTO_VENTA | `deal.aggregate _sum estimatedValue` where `stage: "WON"` + `actualCloseDate` en rango + `currency = goal.currency` + `assignedToId` filtro |

> Verificado: `Deal.actualCloseDate` existe (schema:818). Si por datos viejos viniera null en WON, esos no cuentan para "del mes" (aceptable v1).

**Funciones server:**
- `upsertGoal({scope,userId?,teamId?,period,metric,target,currency?,createdById})` — valida scope↔ref (USER⇒userId, TEAM⇒teamId, COMPANY⇒ninguno; MONTO_VENTA⇒currency). Upsert por el unique.
- `deleteGoal(id)` — soft.
- `getScorecard({period, userId?, teamId?, scope?})` — trae las `Goal` del filtro (deletedAt null) + corre `computeActual` por cada una en paralelo (`Promise.all`) → `[{ goal, actual, pct, status }]`.

## Helpers puros — `src/lib/goals/progress.ts` (con test)

```ts
export function monthRange(period: Date): { start: Date; end: Date }   // start=period, end=+1 mes
export function computeGoalProgress(target: number, actual: number): {
  pct: number;                       // 0..100+ (round, 0 si target<=0)
  status: "met" | "on_track" | "behind";  // met si actual>=target; on_track si pct>=70; else behind
}
```

## API REST

| Ruta | Método | RBAC |
|---|---|---|
| `/api/goals` | POST (upsert) | ADMIN/DIRECTOR/GERENTE: cualquiera. TEAM_LEADER: solo metas de su equipo o de usuarios de su equipo. Otros: 403. |
| `/api/goals/[id]` | DELETE (soft) | igual que POST |
| `/api/goals/scorecard` | GET `?period=YYYY-MM&userId=&teamId=` | ASESOR/asesores: fuerza `userId = self`. TEAM_LEADER: su equipo. Full-access: cualquiera. |

- `params` síncrono. Auth `getServerSession`. Errores 400/403/404 con mensaje claro.
- `period` se parsea de `YYYY-MM` → primer día del mes UTC.

## UI

- **Página `/metas`** (entrada en sidebar; visible a todos, contenido según rol):
  - **Admin/DIRECTOR/GERENTE/TEAM_LEADER:** selector de **mes** + selector **asesor/equipo** (reusa `AdvisorSelect` para asesor; selector de equipos para TEAM). Tabla scorecard: métrica · meta · real · barra de % · semáforo (met/on_track/behind). Botón "Nueva meta" → modal (`Dialog`): scope, asesor/equipo, métrica, target, moneda (solo si MONTO_VENTA). Editar/borrar por fila.
  - **Asesor:** su scorecard del mes en curso, **read-only** (sin botones de edición).
- **Widget "Mi avance del mes"** en `/hoy`: lee `getScorecard({period: mesActual, userId: self})`, muestra top 3 métricas con barra compacta. Si no hay metas: estado vacío discreto ("Sin metas este mes"). B/N, lenguaje de los componentes existentes (`crm-card`, vars `--text/border`).

## Pruebas

- `src/lib/goals/progress.test.ts` (vitest): `monthRange` (start/end correctos, cruce de año dic→ene); `computeGoalProgress` (met cuando actual≥target; on_track pct≥70; behind; target 0 → pct 0 sin dividir por cero).
- Derivación Prisma: build + smoke local (crear meta, ver real calculado contra datos de prueba).
- Suite completa verde + build antes de proponer aplicar migración.

## Riesgos / notas

- BD compartida con prod: la migración es aditiva (riesgo nulo); crear metas no dispara automatizaciones. Smoke con datos de prueba.
- COMPANY scope: `userId`/`teamId` ambos null en el unique → una sola meta-empresa por mes/métrica/moneda.
- Mezcla de monedas en MONTO_VENTA resuelta por meta-por-moneda (sin FX). Si luego se quiere total consolidado, es follow-up.
- Reusa patrones de `src/server/reports.ts` (groupBy/count) y el RBAC inline `FULL_ACCESS_ROLES`/`TEAM_ACCESS_ROLES` ya presentes.
