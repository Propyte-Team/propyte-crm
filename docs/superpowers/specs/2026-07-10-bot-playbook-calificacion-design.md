# Playbook de calificación del bot (Sub-proyecto B)

> Fecha: 2026-07-10 · Estado: diseño, pendiente review de spec
> Proyecto: propyte-crm · Rama: `feat/bot-playbook` (apilada sobre `feat/bot-configurable-tono` = Sub-proyecto A)
> Depende de A: usa el hook `objective` de `buildSystemPrompt`, `BotConfig`, `getBotConfig`, `bot-respond.ts`.

## 1. Problema y objetivo

El bot "Sage" ya responde con tono configurable (A), pero **no persigue objetivos de calificación ni captura datos estructurados** del lead. Se quiere el patrón ManyChat: una secuencia de **tareas** que el bot va cumpliendo en la conversación, y **cada respuesta del lead llena un campo del Contact**.

Ejemplo:
- Tarea 1: pedir el nombre → llena `firstName`/`lastName`.
- Tarea 2: preguntar presupuesto → llena `budgetMin`/`budgetMax`.
- Tarea 3: preguntar zona → llena `preferredZone`. … etc.

**Objetivo de B:** un motor de playbook que, en cada mensaje entrante, (1) extrae los datos que el lead haya dado, (2) los escribe al Contact (auto-llenado auditado), (3) marca la tarea cumplida, (4) elige la siguiente tarea pendiente y la inyecta como `objective` (capa 3 de A) para que el bot la persiga **en el tono seleccionado**, y al terminar propone agendar / escala. Con un **constructor visual en la app** para armar el playbook.

## 2. Decisiones tomadas (cerradas)

- **Captura → Contact:** **auto-llenado + auditado.** El valor se escribe al Contact automáticamente y se registra en `AuditLog` (`source='bot_playbook'`, con taskKey + conversationId + from/to) para trazabilidad y reversibilidad por el asesor.
- **Alcance:** **un playbook global (v1).** `BotConfig.activePlaybookId` apunta al playbook activo. La segmentación por plaza/fuente/conector se agrega después sin refactor (tabla ya modelada para múltiples playbooks).
- **UI:** **constructor completo en la app** en esta ronda (crear/ordenar tareas, mapear cada una a un campo nativo o custom).
- **Tono:** intacto. B solo produce el `objective`; A lo renderiza. Cambiar tono no afecta el playbook y viceversa.

## 3. Arquitectura: composición con A

`bot-respond.ts` gana un **paso de playbook** antes de generar la respuesta:

```
inbound → [PLAYBOOK STEP]                          → buildSystemPrompt(A) → askClaude(A) → linter/send/escala(A)
           1. cargar playbook activo + estado
           2. EXTRAER campos del último mensaje (Claude structured-output)
           3. ESCRIBIR al Contact (validado) + AuditLog + marcar tarea done
           4. AVANZAR: siguiente tarea requerida pendiente
           5. objective := prompt de esa tarea (o cierre si todo done)
                              └────────────► se pasa como `objective` a buildSystemPrompt (hook de A)
```

Invariante: B **solo** calcula `objective` y escribe datos; NO toca la capa de marca ni de tono. Si no hay playbook activo, `bot-respond` se comporta exactamente como en A (objective por default).

## 4. Modelo de datos (Prisma, schema `propyte_crm`, aditivo)

```prisma
enum CaptureType {
  TEXT
  FULL_NAME       // llena firstName + lastName
  EMAIL
  PHONE
  MONEY           // un monto → campo numérico (ej. budgetMax)
  BUDGET_RANGE    // "2 a 3 mdp" → budgetMin + budgetMax
  ENUM            // mapea texto libre → valor de enum (usa enumOptions)
  ZONE            // texto de zona → preferredZone
  BOOLEAN
  NUMBER
  @@schema("propyte_crm")
}

enum PlaybookRunStatus { IN_PROGRESS  COMPLETED  ESCALATED  @@schema("propyte_crm") }

model BotPlaybook {
  id          String     @id @default(uuid())
  name        String
  description String?
  isActive    Boolean    @default(false)
  tasks       BotTask[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  deletedAt   DateTime?
  @@map("bot_playbooks")
  @@schema("propyte_crm")
}

model BotTask {
  id            String      @id @default(uuid())
  playbookId    String
  playbook      BotPlaybook @relation(fields: [playbookId], references: [id], onDelete: Cascade)
  order         Int
  key           String      // estable dentro del playbook (ej. "presupuesto")
  objective     String      @db.Text   // instrucción al bot: qué preguntar/lograr
  targetField   String      // campo destino: nativo ("budgetMax") o "custom.<apiName>"
  captureType   CaptureType @default(TEXT)
  enumOptions   Json        @default("[]")  // para ENUM: [{value,label,synonyms?}]
  extractionHint String?    @db.Text   // ayuda opcional al extractor
  required      Boolean     @default(true)
  skipIfFilled  Boolean     @default(true)  // saltar si el Contact ya tiene ese campo
  isActive      Boolean     @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([playbookId, order])
  @@unique([playbookId, key])
  @@map("bot_tasks")
  @@schema("propyte_crm")
}

model ConversationPlaybookState {
  id               String            @id @default(uuid())
  conversationId   String            @unique
  conversation     Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  playbookId       String
  status           PlaybookRunStatus @default(IN_PROGRESS)
  currentTaskKey   String?
  completedTaskKeys Json             @default("[]")  // array de keys cumplidas
  startedAt        DateTime          @default(now())
  completedAt      DateTime?
  updatedAt        DateTime          @updatedAt
  @@map("conversation_playbook_state")
  @@schema("propyte_crm")
}
```

Extensiones aditivas:
- `BotConfig.activePlaybookId String?` (FK a BotPlaybook, `onDelete: SetNull`). El runtime usa este playbook.
- `Conversation` gana relación inversa `playbookState ConversationPlaybookState?`.

## 5. Motor (`src/lib/bot/playbook/`)

Módulos (funciones puras donde se pueda → testeables):

- **`fields.ts`** — `TARGET_FIELDS`: whitelist de campos nativos escribibles por el playbook (firstName, lastName, email, phone, budgetMin, budgetMax, preferredZone, propertyType, purchaseTimeline, paymentMethod, purchaseModality, rentalStrategy, investmentProfile, contactType) + soporte `custom.<apiName>`. Mapa field → { captureType sugerido, enum values si aplica }. `ENUM_VALUES` de los enums Prisma (propertyType, etc.) reutilizando `@/lib/constants` si existe.
- **`extract.ts`** — `buildExtractionSchema(tasks)`: arma un JSON Schema (solo campos de tareas pendientes) para `output_config.format`. `extractFields(messages, tasks, model)`: llama Claude (structured-output, `max_tokens` bajo, `thinking:disabled` vía el helper de A) y devuelve `{ [taskKey]: rawValue | null }`. Función `parseExtraction` pura para testear el post-proceso.
- **`capture.ts`** — `validateAndCoerce(captureType, raw, task)`: valida/normaliza (MONEY→numeric con `postgres int` gotcha en mente; ENUM→match contra enumOptions/synonyms; FULL_NAME→{firstName,lastName}; BUDGET_RANGE→{min,max}). Devuelve `{ ok, writes: {field:value}[] }` o `{ ok:false }` (dato no confiable → no se escribe).
- **`apply.ts`** — `applyCapture(contactId, writes, {taskKey, conversationId, actor:'bot_playbook'})`: escribe a Contact (columna nativa o `custom` JSONB merge) dentro de una transacción + `AuditLog` por cada campo (entity='Contact', action='UPDATE', changes={field, from, to, source:'bot_playbook', taskKey, conversationId}).
- **`engine.ts`** — `nextTask(playbook, state, contact)`: primera tarea activa por `order` no completada y (si `skipIfFilled`) cuyo campo destino esté vacío en el Contact. `advance(...)`: orquesta extraer→capturar→marcar→elegir siguiente; devuelve `{ objective, status }`. `buildObjective(task)`: enmarca el prompt de la tarea para la capa 3 de A (ej. `"Tu meta ahora: ${task.objective}. Hazlo con UNA pregunta natural, sin sonar a formulario."`). Al completar todas las requeridas → objective de cierre (`"Ya tienes lo esencial. Propón agendar una llamada/visita con el asesor."`) + status COMPLETED + (opcional) subir `temperature`/`score`.

## 6. Integración en `bot-respond.ts`

Tras cargar `config` (A) y antes de construir el system:
```ts
let objective: string | undefined = /* opener/undefined de A */;
if (config.activePlaybookId) {
  const pb = await loadActivePlaybook(config.activePlaybookId);
  if (pb) {
    const result = await runPlaybookStep(pb, conv, contact, msgs, config); // extrae→escribe→avanza
    objective = result.objective;                 // reemplaza el objective de A
    if (result.status === "ESCALATED") { /* deja que el flujo de escala de A actúe */ }
  }
}
const system = buildSystemPrompt({ config, contact, catalog, objective });
```
- El paso playbook es **defensivo**: cualquier error (extracción, DB) se captura y cae al comportamiento de A (objective default) — nunca rompe la respuesta.
- Extracción usa `contact.preferredLanguage` y los últimos N mensajes ya cargados (sin llamada extra de historial).

## 7. UI constructor (admin)

- Nueva pestaña **"Playbook"** en el admin (junto a "Bot" de A) — o sub-ruta `/configuracion/playbook`. Decisión: pestaña en el mismo `admin-content.tsx` para consistencia con A.
- **Lista de tareas ordenable** (drag con `@dnd-kit`, ya instalado): cada fila = objective (textarea corto), targetField (dropdown de nativos + custom de `CustomFieldDef` de `contact`), captureType (auto-sugerido por field, editable), required, skipIfFilled, enumOptions (cuando ENUM). Agregar/eliminar/reordenar.
- Toggle "Playbook activo" (setea `BotConfig.activePlaybookId`).
- Server actions `src/server/bot-playbook.ts`: CRUD playbook+tasks (RBAC admin, zod, auditoría, invalida cache), `setActivePlaybook`. Reglas: `key` inmutable tras crear; `order` recalculado al reordenar; validación de `targetField` contra la whitelist + registro de custom fields.

## 8. Seed

`prisma/seed`-style o script: un playbook "Calificación base" con las tareas del ejemplo, **inactivo** (activación explícita):
1. `nombre` → FULL_NAME → firstName/lastName
2. `presupuesto` → BUDGET_RANGE → budgetMin/budgetMax
3. `zona` → ZONE → preferredZone
4. `tipo_propiedad` → ENUM → propertyType
5. `plazo` → ENUM → purchaseTimeline

## 9. Alcance

**Dentro de B:** modelos + motor (extract/capture/apply/engine) + integración en bot-respond + UI constructor + server actions + seed + migración aditiva + tests + extensión del eval (un escenario que verifique captura + avance).

**Fuera de B:** segmentación de playbooks por plaza/fuente (targeting); scoring conductual avanzado; dialer/voz; edición de custom fields (se consumen los existentes, no se crean aquí); confirmación humana de cada captura (se eligió auto-llenado auditado).

## 10. Criterios de aceptación

1. Con un playbook activo y el ejemplo seed, en una conversación WhatsApp el bot pregunta el nombre; al responder el lead, `firstName`/`lastName` quedan escritos en el Contact + `AuditLog` `source='bot_playbook'`, y el bot avanza a preguntar presupuesto — todo en el **tono configurado** (sin cambiar A).
2. `skipIfFilled`: si el Contact ya trae `preferredZone`, esa tarea se salta.
3. Extracción robusta: si el lead no da el dato pedido (responde otra cosa), NO se escribe nada inválido y el bot re-pregunta o avanza según reglas; un valor no confiable nunca corrompe el Contact.
4. Al completar todas las tareas requeridas, el estado → COMPLETED y el bot propone agendar; nada se re-pregunta.
5. El constructor permite crear/ordenar/mapear tareas y activar el playbook; cambios auditados.
6. Sin playbook activo, el bot se comporta idéntico a A.
7. El paso playbook es defensivo: un fallo de extracción/DB no rompe la respuesta del bot.
8. `tsc --noEmit` sin errores nuevos; `next build` verde; suite de tests verde.

## 11. Gancho / evolución

- Segmentación: agregar `BotPlaybookRule` (plaza/source/connector → playbook) y cambiar `loadActivePlaybook` por `pickPlaybook(contact, connector)` — sin tocar el motor.
- Scoring conductual (§6.4 del anexo) puede consumir `completedTaskKeys` + tiempos.
