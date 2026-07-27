# Agenda Personal — Fase 1: `Activity.contactId` nullable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que una `Activity` exista sin contacto asociado, para que un asesor pueda registrar tareas y notas personales.

**Architecture:** Migración SQL aditiva que quita el `NOT NULL` de `activities.contactId`, más el cambio correspondiente en `schema.prisma`. Al volverse nullable, Prisma regenera los tipos y `tsc --noEmit` enumera todo el código que asumía un contacto siempre presente. Sin UI nueva: al terminar, la app se comporta exactamente igual que antes.

**Tech Stack:** Next.js 14.2.21, Prisma 6.19.2 (Postgres en Supabase vía pooler, schema `propyte_crm`), vitest 2.1.9, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-27-agenda-personal-asesor-design.md` §5

**Rama:** `feat/agenda-personal` (worktree en `.claude/worktrees/agenda-personal`, base `origin/main` = `363c7dc`)

---

## Contexto que el ejecutor necesita

**Convención de migraciones.** Este repo casi no usa `prisma migrate`. Hay una sola migración de Prisma (`20260313232528_init_with_twilio_zapier`) y 26 archivos SQL en `prisma/migrations-manual/`, con el patrón `YYYY-MM-DD-<slug>.sql`, aditivos e idempotentes, siempre con el schema `propyte_crm` explícito. Se aplican a mano contra la base; **no** hay script de npm que las aplique.

**Consecuencia crítica:** cambiar `schema.prisma` sin aplicar el SQL real produce `P2022` en runtime (Prisma espera una columna/constraint que la base no tiene). El orden importa: SQL primero, schema después, `prisma generate` al final.

**Tests.** vitest en modo `node`, sin base de datos. Los módulos de `src/server/` se prueban mockeando `@/lib/db`. Ojo: `src/server/activities.ts` importa `prisma` como **default export** (`import prisma from "@/lib/db"`), así que el mock debe exponer `default`. Otros tests del repo mockean `{ prisma: … }` con export nombrado — ese patrón **no** funciona aquí.

**vitest no typechea** (usa esbuild, que borra tipos sin verificarlos). Tests en verde no significan que compile. `tsc --noEmit` es un gate aparte y obligatorio.

**Autorización de producción.** El paso 1.3 aplica DDL contra la base de producción. Requiere autorización explícita de Luis nombrando el objetivo. No ejecutar por iniciativa propia.

---

## Task 1: Migración SQL + schema

**Files:**
- Create: `prisma/migrations-manual/2026-07-27-activity-contactid-nullable.sql`
- Modify: `prisma/schema.prisma:958-959`

- [ ] **Step 1.1: Escribir el archivo de migración**

Crear `prisma/migrations-manual/2026-07-27-activity-contactid-nullable.sql`:

```sql
-- Agenda personal del asesor — Fase 1
-- Spec: docs/superpowers/specs/2026-07-27-agenda-personal-asesor-design.md §5
--
-- Permite Activity sin contacto, para tareas y notas personales del asesor.
-- Aditivo e idempotente. Reversible mientras no existan filas con contactId NULL
-- (la UI que las crea llega hasta la Fase 2).
--
-- Rollback:
--   ALTER TABLE propyte_crm.activities ALTER COLUMN "contactId" SET NOT NULL;

ALTER TABLE propyte_crm.activities ALTER COLUMN "contactId" DROP NOT NULL;
```

No se agrega índice para actividades personales: la query que lo aprovecharía es de Fase 2, y un índice de más en `activities` (tabla caliente) cuesta throughput de escritura sin beneficio hoy.

- [ ] **Step 1.2: Verificar cuántas filas quedarían afectadas**

Antes de aplicar nada, confirmar que la operación es segura. Correr contra la base:

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE "contactId" IS NULL) AS ya_nulas
FROM propyte_crm.activities;
```

Esperado: `ya_nulas = 0`. Si no es 0, detenerse — significa que el estado de la base no coincide con el schema y hay que investigar antes de seguir.

- [ ] **Step 1.3: Aplicar la migración (REQUIERE AUTORIZACIÓN DE LUIS)**

Este paso escribe en producción. Pedir autorización explícita nombrando el objetivo antes de ejecutar.

```bash
psql "$DATABASE_URL" -f prisma/migrations-manual/2026-07-27-activity-contactid-nullable.sql
```

Verificar que quedó aplicada:

```sql
SELECT is_nullable FROM information_schema.columns
WHERE table_schema = 'propyte_crm'
  AND table_name = 'activities'
  AND column_name = 'contactId';
```

Esperado: `YES`.

- [ ] **Step 1.4: Actualizar `schema.prisma`**

En `prisma/schema.prisma`, dentro de `model Activity`, cambiar dos líneas:

```prisma
  contactId        String?
  contact          Contact?       @relation(fields: [contactId], references: [id])
```

(antes: `contactId String` y `contact Contact @relation(...)`)

- [ ] **Step 1.5: Regenerar el cliente Prisma**

```bash
npx prisma generate
```

Esperado: `Generated Prisma Client (v6.2.1)`. No usar `--no-engine`: rompe el runtime en este proyecto.

- [ ] **Step 1.6: Commit**

```bash
git add prisma/migrations-manual/2026-07-27-activity-contactid-nullable.sql prisma/schema.prisma
git commit -m "feat(agenda): Activity.contactId nullable para actividades personales"
```

---

## Task 2: `createActivity` acepta actividades sin contacto

`createActivity` hoy exige `contactId` y valida que el contacto exista. Con el campo opcional, el `findUnique` deja de tipar y hay que saltar la validación cuando no hay contacto.

**Files:**
- Create: `src/server/activities.create.test.ts`
- Modify: `src/server/activities.ts:171-191`, `src/server/activities.ts:210`

- [ ] **Step 2.1: Escribir el test que falla**

Crear `src/server/activities.create.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const contactFindUnique = vi.fn()
const dealFindUnique = vi.fn()
const activityCreate = vi.fn()

vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    deal: { findUnique: (...a: unknown[]) => dealFindUnique(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}))

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "ASESOR" } }),
}))

// Stub async plano: un mock que rechaza haría fallar el test aunque el código lo capture.
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }))

import { createActivity } from "./activities"

beforeEach(() => {
  contactFindUnique.mockReset()
  dealFindUnique.mockReset()
  activityCreate.mockReset()
  activityCreate.mockResolvedValue({ id: "act-1", contactId: null, userId: "user-1" })
})

describe("createActivity sin contacto (actividad personal)", () => {
  it("crea la actividad con contactId null y no valida contacto", async () => {
    await createActivity({ activityType: "TASK", subject: "Preparar propuesta" })

    expect(contactFindUnique).not.toHaveBeenCalled()
    expect(activityCreate.mock.calls[0][0].data.contactId).toBeNull()
    expect(activityCreate.mock.calls[0][0].data.userId).toBe("user-1")
  })

  it("una TASK personal nace PENDIENTE", async () => {
    await createActivity({ activityType: "TASK", subject: "Revisar contrato" })
    expect(activityCreate.mock.calls[0][0].data.status).toBe("PENDIENTE")
  })
})

describe("createActivity con contacto (comportamiento existente)", () => {
  it("sigue validando que el contacto exista", async () => {
    contactFindUnique.mockResolvedValue({ id: "c-1" })
    await createActivity({ contactId: "c-1", activityType: "NOTE", subject: "Llamada" })

    expect(contactFindUnique).toHaveBeenCalledOnce()
    expect(activityCreate.mock.calls[0][0].data.contactId).toBe("c-1")
  })

  it("sigue lanzando si el contacto no existe", async () => {
    contactFindUnique.mockResolvedValue(null)
    await expect(
      createActivity({ contactId: "no-existe", activityType: "NOTE", subject: "X" }),
    ).rejects.toThrow("Contacto no encontrado")
  })
})
```

- [ ] **Step 2.2: Correr el test y verificar que falla**

```bash
npx vitest run src/server/activities.create.test.ts
```

Esperado: FAIL. Los dos primeros tests fallan porque `contactId` es obligatorio en `CreateActivityInput` y porque `createActivity` llama `contact.findUnique` incondicionalmente (con `contactFindUnique` devolviendo `undefined`, lanza `"Contacto no encontrado"`).

- [ ] **Step 2.3: Hacer `contactId` opcional en la interfaz**

En `src/server/activities.ts`, línea 172:

```typescript
export interface CreateActivityInput {
  contactId?: string
  dealId?: string
  activityType: ActivityType
  subject: string
  description?: string
  dueDate?: Date
  duration_minutes?: number
  outcome?: string
  status?: ActivityStatus
}
```

- [ ] **Step 2.4: Saltar la validación de contacto cuando no hay contacto**

En `src/server/activities.ts`, reemplazar el bloque de las líneas 187-191:

```typescript
  // Verificar que el contacto exista (solo si la actividad cuelga de uno).
  // Sin contactId es una actividad personal del asesor — spec §5.4.
  if (data.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: data.contactId, deletedAt: null },
    })
    if (!contact) throw new Error("Contacto no encontrado")
  }
```

- [ ] **Step 2.5: Pasar null explícito al crear**

En `src/server/activities.ts`, línea 210:

```typescript
      contactId: data.contactId ?? null,
```

- [ ] **Step 2.6: Correr el test y verificar que pasa**

```bash
npx vitest run src/server/activities.create.test.ts
```

Esperado: PASS, 4 tests.

- [ ] **Step 2.7: Commit**

```bash
git add src/server/activities.ts src/server/activities.create.test.ts
git commit -m "feat(agenda): createActivity acepta actividades sin contacto"
```

---

## Task 3: Audit dirigido por el compilador

Aquí es donde aparece el trabajo real. No hay una lista precomputada de archivos rotos a propósito: el compilador la produce, y es la autoridad. Cualquier lista escrita de antemano daría falsa confianza.

**Files:** los que reporte `tsc`. Candidatos conocidos del audit del spec: `src/app/api/activities/route.ts`, `src/server/today.ts`, `src/app/(dashboard)/activities/page.tsx` (este último ya es null-safe y probablemente no aparezca).

- [ ] **Step 3.1: Obtener la lista real de roturas**

```bash
npx tsc --noEmit 2>&1 | tee /tmp/tsc-contactid.txt
```

Esperado: errores del tipo `TS2531: Object is possibly 'null'` o `TS18047: 'a.contact' is possibly 'null'`, en los lugares que dereferencian `.contact` sin guardia.

Si la salida está limpia, saltar al Task 4 — significa que el código ya era null-safe en todos lados.

- [ ] **Step 3.2: Clasificar cada error antes de tocar nada**

Recorrer `/tmp/tsc-contactid.txt` y clasificar cada uno en una de tres categorías. **La categoría determina el arreglo; no aplicar el mismo parche a todos.**

| Categoría | Qué significa | Arreglo |
|---|---|---|
| Vista de CRM | El código muestra el contacto de una actividad ligada a un contacto | Guardia con fallback visible: `{a.contact ? … : "—"}` |
| Query con filtro | El código ya filtra por `contactId`, así que el contacto nunca es null ahí | Guardia temprana con `if (!a.contact) continue` / `return`, o filtrar en el `where` |
| Lógica de negocio | El código decide algo según el contacto | **Detenerse y preguntar.** Puede ser un cambio de comportamiento, no un arreglo de tipos |

- [ ] **Step 3.3: Arreglar los errores de las dos primeras categorías**

Aplicar el arreglo que corresponda a cada uno. **Prohibido usar `!` (non-null assertion) o `as` para silenciar el compilador** — eso reintroduce exactamente el bug de runtime que esta migración vuelve visible.

- [ ] **Step 3.4: Verificar que no quedan errores nuevos**

```bash
npx tsc --noEmit
```

**`tsc` NO está limpio en `origin/main`.** Hay 2 errores preexistentes en `src/lib/workflows/builder-model.test.ts` (líneas 53 y 55, TS2345 sobre `triggerConfig` / `JsonValue`) que no tienen relación con este trabajo. Verificado corriendo `tsc` contra el schema de `origin/main`.

Esperado: **exactamente esos 2 errores, ni uno más.** El gate es "cero errores nuevos", no "cero errores". No arregles los preexistentes — es scope creep y ensucia el diff.

- [ ] **Step 3.5: Commit**

```bash
git add -A
git commit -m "fix(agenda): manejar Activity sin contacto en consumidores existentes"
```

---

## Task 4: Gate final

- [ ] **Step 4.1: Suite completa de tests**

```bash
npm test
```

Esperado: todos los tests en verde. Si algún test preexistente falla, **no** es ruido — es un consumidor que asumía contacto obligatorio.

- [ ] **Step 4.2: Build de producción**

```bash
npm run build
```

Esperado: `Compiled successfully`. Este gate es independiente de los tests: vitest usa esbuild y no verifica tipos, así que solo el build confirma que la app compila de verdad.

- [ ] **Step 4.3: Verificar que no se rompió el comportamiento existente**

Confirmar a mano que crear una actividad **con** contacto sigue funcionando desde la UI (`/activities` o el timeline de un contacto). Fase 1 no debe cambiar nada visible: si un asesor nota una diferencia, algo salió mal.

- [ ] **Step 4.4: Verificar el HEAD antes del commit final**

Este repo tiene varios worktrees compartiendo el mismo `.git`. Confirmar que se está commiteando donde corresponde:

```bash
git branch --show-current   # esperado: feat/agenda-personal
git log --oneline -1        # esperado: el commit del Task 3
```

- [ ] **Step 4.5: Push**

```bash
git push -u origin feat/agenda-personal
```

---

## Definición de terminado

- `activities.contactId` es nullable en la base y en `schema.prisma`, y ambos coinciden
- `createActivity` crea actividades con y sin contacto, con tests que cubren los cuatro casos
- `npx tsc --noEmit` sin errores nuevos (quedan los 2 preexistentes de `builder-model.test.ts`), sin `!` ni `as` agregados para silenciarlo
- `npm test` y `npm run build` en verde
- Crear una actividad con contacto se comporta igual que antes del cambio
- Nada visible cambió para los asesores

## Qué NO entra en esta fase

Ruta `/agenda`, UI de captura, listado de pendientes personales, `RecordLink` desde actividades personales, grafo, asistente. Cada uno lleva su propio plan. Fase 1 es solo la migración del modelo, verificable y desplegable por sí sola.
