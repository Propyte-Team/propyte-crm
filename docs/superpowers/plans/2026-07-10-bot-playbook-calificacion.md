# Playbook de calificación del bot (Sub-proyecto B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Motor de playbook estilo ManyChat: en cada mensaje entrante el bot extrae datos del lead, los escribe al Contact (auto-llenado auditado), marca la tarea cumplida, elige la siguiente y la persigue vía el hook `objective` de A (tono intacto). Con constructor visual en la app.

**Architecture:** Modelos `BotPlaybook`/`BotTask`/`ConversationPlaybookState` + `BotConfig.activePlaybookId`. Motor puro en `src/lib/bot/playbook/` (fields/capture/extract/engine/apply/run). `bot-respond.ts` gana un paso de playbook defensivo que produce el `objective` que consume `buildSystemPrompt` (A). UI: pestaña admin "Playbook".

**Tech Stack:** Next.js 14, Prisma 6 (Postgres/Supabase schema `propyte_crm`), TypeScript, Vitest, Zod, @dnd-kit, Radix. Claude vía fetch (structured-output para extracción).

**Ref:** spec `docs/superpowers/specs/2026-07-10-bot-playbook-calificacion-design.md`. Rama `feat/bot-playbook` (sobre A).

> ⚠️ Worktree compartido: `git rev-parse --abbrev-ref HEAD` == `feat/bot-playbook` antes de cada commit. Config git ya en `Propyte-Luis <marketing@propyte.com>`. Migración la aplica el humano (o vía MCP con autorización nombrada) — el código es runtime-safe sin ella (try/catch + `activePlaybookId` null).
> ⚠️ Preexistente: 2 errores tsc en `src/lib/workflows/builder-model.test.ts` — ignorar; solo importan errores nuevos en archivos de este trabajo. Gates por task: vitest del archivo + `tsc --noEmit` sin errores nuevos; en tasks de UI además `npm run build`.

## Enum values (fuente de verdad para seed/ENUM)
- PropertyType: `DEPARTAMENTO CASA TERRENO MACROLOTE LOCAL_COMERCIAL OTRO`
- PurchaseTimeline: `IMMEDIATE ONE_TO_THREE_MONTHS THREE_TO_SIX_MONTHS SIX_PLUS_MONTHS`
- PaymentMethod: `CONTADO CREDITO_HIPOTECARIO FINANCIAMIENTO_DIRECTO MIXTO`
- PurchaseModality: `PREVENTA ENTREGA_INMEDIATA REVENTA ABIERTO`
- RentalStrategy: `LONG_TERM AIRBNB BOTH NA`
- InvestmentProfile: `END_USER INVESTOR_RENTAL INVESTOR_FLIP INVESTOR_LAND MIXED`
- ContactType: `LEAD PROSPECTO CLIENTE INVERSIONISTA BROKER_EXTERNO REFERIDO EMPLEO COMPRADOR REFERIDOR`

## File Structure
- Nuevos: `src/lib/bot/playbook/{fields,capture,extract,engine,apply,run}.ts` (+ `.test.ts` de fields/capture/extract/engine), `src/server/bot-playbook.ts` + `bot-playbook.schema.ts` (+schema test), `src/components/admin/playbook-tab.tsx`, `scripts/seed-bot-playbook.ts`, `prisma/migrations-manual/2026-07-10-bot-playbook.sql`.
- Editados: `prisma/schema.prisma` (+2 enums, +3 models, `BotConfig.activePlaybookId`, `Conversation` inverse rel), `src/lib/bot/config.ts` (+`activePlaybookId`), `src/lib/bot/bot-respond.ts` (paso playbook), `src/components/admin/admin-content.tsx` (+tab), `src/app/(dashboard)/admin/page.tsx` (+fetch playbook).

---

## Task 1: Schema + migración

**Files:** modify `prisma/schema.prisma`; create `prisma/migrations-manual/2026-07-10-bot-playbook.sql`.

- [ ] **Step 1:** Añadir al schema los 2 enums (`CaptureType`, `PlaybookRunStatus`) y 3 modelos (`BotPlaybook`, `BotTask`, `ConversationPlaybookState`) **exactamente como en la §4 del spec**. Añadir `activePlaybookId String?` + relación `activePlaybook BotPlaybook? @relation("ActivePlaybook", fields:[activePlaybookId], references:[id], onDelete: SetNull)` a `model BotConfig`; en `BotPlaybook` la inversa `activeInConfigs BotConfig[] @relation("ActivePlaybook")`. En `model Conversation` añadir `playbookState ConversationPlaybookState?`.
- [ ] **Step 2:** `npx prisma format && npx prisma validate && npx prisma generate` (usar un `DATABASE_URL` placeholder inline si no hay `.env`, como en A: `DATABASE_URL="postgresql://u:p@localhost:5432/x"` — validate/generate no conectan).
- [ ] **Step 3:** Escribir `prisma/migrations-manual/2026-07-10-bot-playbook.sql` — aditiva e **idempotente** (patrón de A: `DO $$ ... EXCEPTION WHEN duplicate_object` para CREATE TYPE y ADD CONSTRAINT/COLUMN, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Incluir: los 2 enums; las 3 tablas (`bot_playbooks`, `bot_tasks`, `conversation_playbook_state`) con columnas/defaults 1:1 al schema; uniques (`bot_tasks(playbookId,order)`, `bot_tasks(playbookId,key)`, `conversation_playbook_state(conversationId)`); FKs (`bot_tasks.playbookId`→`bot_playbooks`, `conversation_playbook_state.conversationId`→`conversations`, ambos `ON DELETE CASCADE`); `ALTER TABLE "propyte_crm"."bot_config" ADD COLUMN IF NOT EXISTS "activePlaybookId" TEXT` + FK a `bot_playbooks(id)` `ON DELETE SET NULL`. NO aplicar a ninguna DB.
- [ ] **Step 4:** Commit `feat(bot): schema playbook (BotPlaybook/BotTask/estado) + activePlaybookId + migración`.

---

## Task 2: `fields.ts` — whitelist de campos destino (TDD)

**Files:** create `src/lib/bot/playbook/fields.ts` + `.test.ts`.

- [ ] **Step 1 (test):** exporta `NATIVE_TARGET_FIELDS` (Record) con al menos firstName,lastName,email,phone,budgetMin,budgetMax,preferredZone,propertyType,purchaseTimeline,paymentMethod,purchaseModality,rentalStrategy,investmentProfile,contactType; cada uno `{ captureType, enumValues? }`. Tests: campos enum traen `enumValues` con los valores exactos (arriba); `isCustomTarget("custom.foo")===true`, `isNativeTarget("budgetMax")===true`, `isNativeTarget("hackerField")===false`.
- [ ] **Step 2:** correr → fail.
- [ ] **Step 3 (impl):**
```ts
import type { CaptureType } from "@prisma/client";
export interface TargetFieldSpec { captureType: CaptureType; enumValues?: string[]; }
export const NATIVE_TARGET_FIELDS: Record<string, TargetFieldSpec> = {
  firstName: { captureType: "FULL_NAME" }, lastName: { captureType: "TEXT" },
  email: { captureType: "EMAIL" }, phone: { captureType: "PHONE" },
  budgetMin: { captureType: "MONEY" }, budgetMax: { captureType: "MONEY" },
  preferredZone: { captureType: "ZONE" },
  propertyType: { captureType: "ENUM", enumValues: ["DEPARTAMENTO","CASA","TERRENO","MACROLOTE","LOCAL_COMERCIAL","OTRO"] },
  purchaseTimeline: { captureType: "ENUM", enumValues: ["IMMEDIATE","ONE_TO_THREE_MONTHS","THREE_TO_SIX_MONTHS","SIX_PLUS_MONTHS"] },
  paymentMethod: { captureType: "ENUM", enumValues: ["CONTADO","CREDITO_HIPOTECARIO","FINANCIAMIENTO_DIRECTO","MIXTO"] },
  purchaseModality: { captureType: "ENUM", enumValues: ["PREVENTA","ENTREGA_INMEDIATA","REVENTA","ABIERTO"] },
  rentalStrategy: { captureType: "ENUM", enumValues: ["LONG_TERM","AIRBNB","BOTH","NA"] },
  investmentProfile: { captureType: "ENUM", enumValues: ["END_USER","INVESTOR_RENTAL","INVESTOR_FLIP","INVESTOR_LAND","MIXED"] },
  contactType: { captureType: "ENUM", enumValues: ["LEAD","PROSPECTO","CLIENTE","INVERSIONISTA","BROKER_EXTERNO","REFERIDO","EMPLEO","COMPRADOR","REFERIDOR"] },
};
export function isCustomTarget(f: string) { return f.startsWith("custom."); }
export function isNativeTarget(f: string) { return Object.prototype.hasOwnProperty.call(NATIVE_TARGET_FIELDS, f); }
```
- [ ] **Step 4:** correr → pass. **Step 5:** commit `feat(bot): playbook fields whitelist`.

---

## Task 3: `capture.ts` — validación/coerción por tipo (TDD, correctness-critical)

**Files:** create `src/lib/bot/playbook/capture.ts` + `.test.ts`.

- [ ] **Step 1 (test):** `coerceCapture(task, raw)` devuelve `{ ok, writes }`. Casos:
  - FULL_NAME `"Ana María Pérez"` → `writes=[{firstName:"Ana María"},{lastName:"Pérez"}]` ok (una sola palabra → firstName solo, lastName ""); vacío → `ok:false`.
  - BUDGET_RANGE `"entre 2 y 3 millones"` → budgetMin=2000000, budgetMax=3000000; `"como 2.5 mdp"` → budgetMin=budgetMax=2500000; texto sin número → ok:false.
  - MONEY (target budgetMax) `"3 millones"` → budgetMax=3000000.
  - ENUM (task.enumOptions con value+synonyms) `"un depa"`→propertyType=DEPARTAMENTO; valor fuera → ok:false (no escribe).
  - EMAIL válido/ inválido; PHONE normaliza a E.164-ish (reusar `@/lib/phone` si existe — revisar); ZONE→trim string; TEXT passthrough no vacío.
- [ ] **Step 2:** fail. **Step 3 (impl):** funciones puras; MONEY parse maneja "mdp/millones/mil/k", comas y puntos; ENUM matchea contra `task.enumOptions` `[{value,synonyms[]}]` case/acento-insensible (reusar normalizador estilo brand-linter). **Nunca** devolver `ok:true` con valor no confiable. **Step 4:** pass. **Step 5:** commit `feat(bot): playbook capture (coerción/validación por tipo)`.

> Nota impl: para dinero usar number JS y castear a Decimal en la escritura (Prisma acepta number|string para Decimal). Recordar gotcha `postgres int/int` (memory) — aquí es parse de texto, no división SQL.

---

## Task 4: `extract.ts` — schema + llamada de extracción (TDD del builder)

**Files:** create `src/lib/bot/playbook/extract.ts` + `.test.ts`.

- [ ] **Step 1 (test):** `buildExtractionSchema(tasks)` → JSON Schema `{type:"object", additionalProperties:false, properties:{ [task.key]: {type:["string","null"]} }, required:[...]}` (todos required, nullable para "no encontrado"). `parseExtractionResponse('{"presupuesto":"3 mdp","nombre":null}')` → objeto; texto con ```json fences → limpia; no-JSON → `{}`.
- [ ] **Step 2:** fail. **Step 3 (impl):** `buildExtractionSchema`; `parseExtractionResponse` (pura); `extractFields({messages, tasks, model, apiKey})`: arma system "Extrae SOLO lo que el cliente dijo explícitamente; null si no lo dijo. No inventes." + `output_config:{format:{type:"json_schema",schema}}` + `thinking` vía el helper de A (`thinkingFieldFor`) + `max_tokens:400`; POST fetch a la API (mismo patrón que `askClaude`); devuelve `parseExtractionResponse(text)`. Si no hay apiKey → `{}`. **Step 4:** pass (solo builder/parse; la llamada real la cubre el eval). **Step 5:** commit.

---

## Task 5: `engine.ts` — selección de tarea + objetivo (TDD)

**Files:** create `src/lib/bot/playbook/engine.ts` + `.test.ts`.

- [ ] **Step 1 (test):** `nextTask(tasks, completedKeys, contact)`:
  - primera por `order` activa no en `completedKeys`;
  - si `skipIfFilled` y el campo destino del Contact ya tiene valor → se salta (y cuenta como resuelta);
  - todas resueltas → `null`.
  `buildObjective(task)` → string que contiene `task.objective`. `COMPLETION_OBJECTIVE` no vacío.
- [ ] **Step 2:** fail. **Step 3 (impl):** puras; `nextTask` recibe `contact` para el check `skipIfFilled` (usa `isNativeTarget`/`custom`); `buildObjective(task)= 'Tu meta ahora: ${task.objective}. Consíguelo con UNA pregunta natural, sin sonar a formulario ni listar campos.'`. **Step 4:** pass. **Step 5:** commit.

---

## Task 6: `apply.ts` — escritura + auditoría

**Files:** create `src/lib/bot/playbook/apply.ts` (+ test del router puro).

- [ ] **Step 1 (test):** `resolveWrite(field, value)` puro → nativo `{native:{col:"budgetMax",value}}` para campos de la whitelist; `custom.foo` → `{custom:{key:"foo",value}}`; campo no permitido → `{skip:true}`.
- [ ] **Step 2:** fail. **Step 3 (impl):** `resolveWrite` (pura, valida contra `isNativeTarget`/`isCustomTarget`); `applyCapture(prisma, contactId, writes, {taskKey, conversationId})`:
  - resolver `actorId = contact.assignedToId ?? (primer User ADMIN activo).id` (como `bot-respond`); si ninguno → abortar (no romper).
  - en `$transaction`: leer contact (para `from` del audit + merge custom); construir `data` nativo + `custom` (merge JSON) desde `writes`; `contact.update`; por cada write un `auditLog.create({ userId: actorId, action:"UPDATE", entity:"Contact", entityId:contactId, changes:{ field, from, to, source:"bot_playbook", taskKey, conversationId } })`.
- [ ] **Step 4:** pass (test del `resolveWrite`; la escritura real la cubren integración/eval). **Step 5:** commit.

---

## Task 7: `config.ts` — exponer `activePlaybookId` (TDD)

**Files:** modify `src/lib/bot/config.ts` + su test.

- [ ] Añadir `activePlaybookId: string | null` a `BotConfigResolved` (default `null` en `DEFAULT_BOT_CONFIG`), mapearlo en `resolveBotConfig` (`(row.activePlaybookId as string) ?? null`). Test: `resolveBotConfig(null).activePlaybookId===null`; con fila `{activePlaybookId:"pb_1"}` → "pb_1". Correr `npx vitest run src/lib/bot/config.test.ts`. Commit.

---

## Task 8: `run.ts` + integración en `bot-respond.ts`

**Files:** create `src/lib/bot/playbook/run.ts`; modify `src/lib/bot/bot-respond.ts`. READ el bot-respond actual (post-A) primero.

- [ ] **Step 1 (impl `run.ts`):** `runPlaybookStep({ playbook, conversationId, contact, msgs, config }): Promise<{ objective?: string; status }>`:
  1. cargar/crear `ConversationPlaybookState` (upsert por conversationId con `playbookId`, status IN_PROGRESS).
  2. tareas activas ordenadas del playbook.
  3. `extractFields(msgs recientes del cliente, pendientes, config.model)` → por cada key con valor no-null: `coerceCapture(task, raw)`; si `ok` → `applyCapture(...)` + agregar key a `completedTaskKeys`.
  4. persistir `completedTaskKeys`.
  5. `task = nextTask(tasks, completedKeys, contactActualizado)`; si `task` → `{ objective: buildObjective(task), status:"IN_PROGRESS", currentTaskKey }`; si `null` → marcar state COMPLETED (+`completedAt`), `{ objective: COMPLETION_OBJECTIVE, status:"COMPLETED" }`.
  - TODO el cuerpo en try/catch → en error, log y `return { objective: undefined, status:"IN_PROGRESS" }` (cae a A).
- [ ] **Step 2 (integración):** en `bot-respond.ts`, tras `config` y antes de `buildSystemPrompt`, si `config.activePlaybookId`: cargar playbook activo (`prisma.botPlaybook.findFirst({where:{id:config.activePlaybookId,isActive:true},include:{tasks:{where:{isActive:true},orderBy:{order:"asc"}}}})`); si existe → `const pr = await runPlaybookStep(...)` y usar `pr.objective` en lugar del `objective` de A (si `pr.objective` definido). Mantener el opener de A como fallback cuando no hay playbook. Defensivo (try/catch envolviendo la carga+step).
- [ ] **Step 3:** `npx vitest run src/lib/bot/` verde (mockear `./config`/`./claude` donde el channel-test lo necesite, como en A); `tsc --noEmit` sin nuevos. **Step 4:** commit `feat(bot): paso de playbook en bot-respond (extrae→escribe→avanza→objective)`.

---

## Task 9: server actions `bot-playbook.ts` (+ schema module)

**Files:** create `src/server/bot-playbook.ts` + `src/server/bot-playbook.schema.ts` + schema test. Sigue el patrón de A (`bot-config.ts`): RBAC `["ADMIN","DIRECTOR","GERENTE"]`, zod, `prisma.auditLog.create`, `invalidateBotConfigCache` cuando cambie `activePlaybookId`. **Schema en módulo aparte** (lección A: `"use server"` solo exporta async).

- [ ] Schema (`bot-playbook.schema.ts`): `taskInputSchema` (order int≥0, key `/^[a-z0-9_]+$/`, objective 1..500, targetField string, captureType enum de los 10 valores, enumOptions array, required bool, skipIfFilled bool), `playbookUpsertSchema` (name, description?, tasks: taskInputSchema[]). Test: acepta válido, rechaza captureType inválido, rechaza key con mayúsculas/espacios.
- [ ] Server (`bot-playbook.ts`): `listPlaybooks()`, `getPlaybook(id)`, `upsertPlaybook(input)` (crea/reemplaza tareas en transacción; valida `targetField` contra `isNativeTarget || isCustomTarget` + existencia de custom en `CustomFieldDef` del objeto contact), `setActivePlaybook(id|null)` (setea `BotConfig.activePlaybookId` + invalida cache + audit), `deletePlaybook(id)` (soft `deletedAt`). Todos con `requireAdminRole` + audit. Commit.

---

## Task 10: UI pestaña "Playbook"

**Files:** create `src/components/admin/playbook-tab.tsx`; modify `admin-content.tsx` (+tab "Playbook", icono `ListChecks`) y `admin/page.tsx` (+`getPlaybookForAdmin`/lista + `botConfig.activePlaybookId`). READ `bot-config-tab.tsx` (de A) y un uso de `@dnd-kit` en el repo como patrón.

- [ ] Constructor: lista de tareas **ordenable con `@dnd-kit`** (ya instalado; copiar patrón de sortable existente); cada fila: `objective` (input), `targetField` (Select con opciones de `NATIVE_TARGET_FIELDS` + custom fields de `contact` pasados por props, agrupadas), `captureType` (Select; auto-sugerir desde `NATIVE_TARGET_FIELDS[field].captureType` al elegir campo), `required`, `skipIfFilled`, y cuando captureType=ENUM mostrar editor simple de `enumOptions` (value + sinónimos) prellenado con `enumValues` del campo. Botones agregar/eliminar tarea. Guardar → `upsertPlaybook`. Toggle "Playbook activo" → `setActivePlaybook`. Sin `window.location.reload()`; toasts.
- [ ] Verify: `npm run build` exit 0; `npx vitest run` verde. Manual: `/admin`→Playbook, crear tareas, reordenar, activar. Commit.

---

## Task 11: seed `scripts/seed-bot-playbook.ts`

**Files:** create `scripts/seed-bot-playbook.ts` (relative imports como los scripts existentes; `scripts/` excluido de tsc → verificar con `npx tsx`). Crea (idempotente por `name`) el playbook **"Calificación base"** `isActive:false` con tareas:
1. `nombre` FULL_NAME → firstName · objective "Pide su nombre para dirigirte a él/ella."
2. `presupuesto` BUDGET_RANGE → budgetMax · "Pregunta el rango de presupuesto de inversión."
3. `zona` ZONE → preferredZone · "Pregunta en qué zona busca."
4. `tipo_propiedad` ENUM → propertyType (enumOptions con sinónimos: DEPARTAMENTO="depa/departamento", CASA="casa", TERRENO="terreno/lote", ...) · "Pregunta qué tipo de propiedad busca."
5. `plazo` ENUM → purchaseTimeline (IMMEDIATE="ya/ahora", ONE_TO_THREE_MONTHS="1-3 meses", ...) · "Pregunta en qué plazo planea comprar."
- [ ] Verify `npx tsx scripts/seed-bot-playbook.ts` (requiere DB+migración → si no hay, documentar que lo corre Luis post-migración; al menos `npx tsc`-parse vía tsx dry si no hay DB: aceptar que falla por conexión, no por sintaxis). Commit.

---

## Task 12: extensión del eval + verificación final

- [ ] Añadir a `scripts/eval-bot-voice.ts` (o nuevo `scripts/eval-playbook.ts`) un modo que, dado el playbook seed, simule 2-3 turnos y verifique que `extractFields`+`coerceCapture` capturan (unit-level, sin DB): p.ej. mensaje "soy Ana, busco depa en Tulum, como 3 millones" → capturas esperadas nombre/zona/tipo/presupuesto. (Preferir un `*.test.ts` puro sobre extract+capture encadenados si no se quiere gastar API.)
- [ ] `npm test` (suite completa verde), `npx tsc --noEmit` (solo preexistentes), `npm run build` (exit 0). Commit si hubo cambios.

---

## Task 13: handoff + revisión final + memoria
- [ ] Instrucciones Luis: aplicar `prisma/migrations-manual/2026-07-10-bot-playbook.sql`, correr `npx tsx scripts/seed-bot-playbook.ts`, activar el playbook en `/admin`→Playbook.
- [ ] Revisión final holística (subagente) sobre `191fdc1..HEAD`: correctness de capture/extract/engine, defensividad del paso playbook, que el tono de A NO se altere, auditoría correcta (userId válido), RBAC, no over-build. Corregir Critical/Important.
- [ ] Actualizar memoria (`project_propyte_crm.md` changelog): Sub-proyecto B implementado en `feat/bot-playbook`, pendientes (migración, seed, merge), y marcar que la migración de A ya fue aplicada.

---

## Self-Review (cobertura del spec)
- §4 modelos → Task 1 ✅ · §5 motor (fields/extract/capture/engine/apply) → Tasks 2-6 ✅ · §6 integración bot-respond → Task 8 ✅ · §7 UI → Task 10 ✅ · §8 seed → Task 11 ✅ · decisiones (auto-llenado auditado / global / UI completa) → Tasks 6,9,10 ✅ · criterios §10 → Tasks 3,5,8,10 + Task 12/13 ✅ · gancho §11 (`activePlaybookId` desacoplado) → Task 1/7 ✅.
- Consistencia de nombres: `coerceCapture`, `buildExtractionSchema`/`parseExtractionResponse`/`extractFields`, `nextTask`/`buildObjective`/`COMPLETION_OBJECTIVE`, `resolveWrite`/`applyCapture`, `runPlaybookStep`, `activePlaybookId`, `NATIVE_TARGET_FIELDS`/`isNativeTarget`/`isCustomTarget` — usados igual en todas las tasks.
