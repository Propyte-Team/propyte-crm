# Fase 1 — Fundaciones de Datos: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear TODAS las entidades nuevas del rebuild (Anexo Técnico §B/§D + Anexo B §H/§I/§J) como migración additiva al esquema `propyte_crm`, con utilidades base (E.164, cifrado) y seeds canónicos — sin tocar nada existente.

**Architecture:** Schema-first. Un solo bloque de enums + modelos nuevos al final de `schema.prisma`; extensiones mínimas a `Contact`/`Deal`/`Message`/`User`. El SQL se genera por diff contra el schema de git HEAD, se revisa que sea 100% additivo, se versiona y se aplica con `prisma db execute`. Lógica testeable (phone/crypto) con TDD.

**Tech Stack:** Prisma 6 multiSchema · Postgres (Supabase compartida) · zod · vitest · Node crypto.

**Rama:** `feat/crm-rebuild-fase1` (sobre `feat/audit-fixes-minimal-ui`).

---

### Task 1: Enums nuevos + valor TIKTOK_ADS

**Files:**
- Modify: `prisma/schema.prisma` (bloque ENUMS, después de `LeadAssignmentMode`; y enum `LeadSource`)

- [ ] **Step 1:** Agregar `TIKTOK_ADS` al enum `LeadSource` (después de `INSTAGRAM`).
- [ ] **Step 2:** Agregar al final del bloque de enums (cada uno con `@@schema("propyte_crm")`):

```prisma
// ===== ENUMS REBUILD F1 (Anexo Técnico §B/§D + Anexo B) =====

enum ContactStatus {
  NUEVO
  SIN_RESPUESTA
  CONTACTADO
  EN_SEGUIMIENTO
  DESCARTADO
  @@schema("propyte_crm")
}

enum Urgency {
  ALTA
  MEDIA
  BAJA
  @@schema("propyte_crm")
}

enum DocumentType {
  INE
  PASAPORTE
  FM2
  FM3
  OTRO
  @@schema("propyte_crm")
}

enum MaritalStatus {
  SOLTERO
  CASADO
  DIVORCIADO
  VIUDO
  UNION_LIBRE
  @@schema("propyte_crm")
}

enum TaxRegime {
  PFAE
  PM
  PF
  @@schema("propyte_crm")
}

enum TriggerType {
  EVENT
  TIME
  BEHAVIORAL
  INACTIVITY
  STAGE_CHANGE
  SLA_BREACH
  SCORE_THRESHOLD
  @@schema("propyte_crm")
}

enum WorkflowActionType {
  CREATE_TASK
  SEND_WHATSAPP
  SEND_EMAIL
  MAKE_CALL
  ASSIGN
  REASSIGN
  NOTIFY
  UPDATE_FIELD
  ADD_TAG
  CHANGE_STAGE
  ENROLL_PLAN
  ESCALATE
  AI_DRAFT
  AI_REPLY
  AI_CALL_SUMMARY
  WEBHOOK
  @@schema("propyte_crm")
}

enum AutonomyLevel {
  L0
  L1
  L2
  @@schema("propyte_crm")
}

enum EnrollmentStatus {
  ACTIVE
  PAUSED
  COMPLETED
  EXITED
  @@schema("propyte_crm")
}

enum SlaTimerType {
  FIRST_TOUCH
  RETRY
  ORPHAN
  @@schema("propyte_crm")
}

enum SlaTimerStatus {
  RUNNING
  MET
  BREACHED
  CANCELLED
  @@schema("propyte_crm")
}

enum ActionQueueStatus {
  PENDING
  RUNNING
  DONE
  FAILED
  SKIPPED
  @@schema("propyte_crm")
}

enum ConnectorProvider {
  META
  TIKTOK
  WEBSITE
  ZAPIER
  MANUAL
  @@schema("propyte_crm")
}

enum ConnectorStatus {
  ACTIVE
  PAUSED
  ERROR
  @@schema("propyte_crm")
}

enum ConnectorLeadStatus {
  RECEIVED
  PROCESSED
  DUPLICATE
  ERROR
  @@schema("propyte_crm")
}

enum ConversationChannel {
  WHATSAPP
  SMS
  WEB
  @@schema("propyte_crm")
}

enum ConversationStatus {
  BOT
  HUMAN
  SNOOZED
  CLOSED
  @@schema("propyte_crm")
}

enum MessageSender {
  CONTACT
  ADVISOR
  BOT
  SYSTEM
  @@schema("propyte_crm")
}

enum TemplateChannel {
  WHATSAPP
  EMAIL
  SMS
  @@schema("propyte_crm")
}
```

- [ ] **Step 3:** `npx prisma validate` → debe pasar.

---

### Task 2: Extensiones a Contact / Deal / Message / User

**Files:** Modify: `prisma/schema.prisma`

- [ ] **Step 1:** En `model Contact`, después del bloque "Asignación y scoring", agregar:

```prisma
  // Ciclo de contacto y cumplimiento (Anexo §B.2)
  contactStatus     ContactStatus @default(NUEVO)
  urgency           Urgency?
  lastActivityAt    DateTime?
  originalCreatedAt DateTime?
  doNotContact      Boolean       @default(false)
  whatsappOptOut    Boolean       @default(false)
  recordingConsent  Boolean       @default(false)
  zohoId            String?       @unique
  hubContactId      String?

  // Dedup / merge (humano-en-loop salvo phone+email idénticos)
  mergedIntoId String?
  mergedInto   Contact?  @relation("MergedContacts", fields: [mergedIntoId], references: [id])
  mergedFrom   Contact[] @relation("MergedContacts")
```

y en el bloque de relaciones de `Contact`:

```prisma
  dossier        ContactDossier?
  adAttribution  AdAttribution?
  webBehavior    WebBehavior?
  conversations  Conversation[]
  slaTimers      SlaTimer[]
  connectorLeads ConnectorLeadLog[]
```

- [ ] **Step 2:** En `model Deal`, después del bloque "Atribución", agregar:

```prisma
  // Referencias al catálogo del Hub (Fase 7 las vuelve obligatorias; aquí preparan el terreno)
  hubDevelopmentId String?
  hubUnitId        String?
  holdId           String?
  holdExpiresAt    DateTime?

  // Fechas hito (paridad Zoho, consolidado §2.3.8)
  reservedAt       DateTime?
  contractSignedAt DateTime?
  deedAt           DateTime?
  deliveredAt      DateTime?
```

y en relaciones de `Deal`: `slaTimers SlaTimer[]`.

- [ ] **Step 3:** En `model Message`, después de `externalPhone`, agregar:

```prisma
  // Inbox / bot (Anexo B §I.2)
  conversationId String?
  conversation   Conversation? @relation(fields: [conversationId], references: [id])
  sender         MessageSender @default(SYSTEM)
  aiGenerated    Boolean       @default(false)
  aiAutonomy     AutonomyLevel?
  internalNote   Boolean       @default(false)
```

- [ ] **Step 4:** En `model User`, agregar relaciones:

```prisma
  profile                 UserProfile?
  templates               UserTemplate[]
  ownedActionPlans        ActionPlan[]   @relation("OwnedActionPlans")
  controlledConversations Conversation[] @relation("ControlledConversations")
```

- [ ] **Step 5:** `npx prisma validate` → falla esperada (modelos aún no existen) hasta terminar Task 3-6.

---

### Task 3: Modelos de Contacto extendido (Dossier, AdAttribution, WebBehavior)

**Files:** Modify: `prisma/schema.prisma` (al final, sección nueva "REBUILD F1")

- [ ] **Step 1:** Agregar:

```prisma
// =====================================================================
// REBUILD F1 — Anexo Técnico §B.3-B.5
// =====================================================================

// Expediente KYC (PII sensible: documentNumber/taxId se guardan CIFRADOS con lib/crypto)
model ContactDossier {
  id        String  @id @default(uuid())
  contactId String  @unique
  contact   Contact @relation(fields: [contactId], references: [id])

  documentType   DocumentType?
  documentNumber String? // cifrado AES-256-GCM (lib/crypto), nunca en logs ni payloads de IA
  birthDate      DateTime?
  birthPlace     String?
  maritalStatus  MaritalStatus?
  occupation     String?
  taxId          String? // cifrado AES-256-GCM
  taxRegime      TaxRegime?

  // Domicilio de correspondencia
  corrStreet  String?
  corrColonia String?
  corrCity    String?
  corrState   String?
  corrZip     String?
  corrCountry String?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@map("contact_dossiers")
  @@schema("propyte_crm")
}

// Atribución publicitaria (1:1 con Contact; la pueblan los conectores y el webhook web)
model AdAttribution {
  id        String  @id @default(uuid())
  contactId String  @unique
  contact   Contact @relation(fields: [contactId], references: [id])

  gclid        String?
  fbclid       String?
  socialLeadId String? // Meta leadgen_id / TikTok lead id

  utmSource  String?
  utmMedium  String?
  utmCampaign String?
  utmTerm    String?
  utmContent String?

  campaignName String?
  adName       String?
  adsetName    String?
  network      String?
  device       String?
  keyword      String?

  costPerClick      Decimal? @db.Decimal(10, 2)
  costPerConversion Decimal? @db.Decimal(10, 2)

  conversionExportStatus String?
  conversionExportedAt   DateTime?

  landingPage String?
  referrer    String?
  firstTouch  DateTime?
  lastTouch   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("ad_attributions")
  @@schema("propyte_crm")
}

// Comportamiento web (equivalente SalesIQ; alimenta scoring conductual)
model WebBehavior {
  id        String  @id @default(uuid())
  contactId String  @unique
  contact   Contact @relation(fields: [contactId], references: [id])

  visitorScore     Int?
  firstVisitAt     DateTime?
  lastVisitAt      DateTime?
  daysVisited      Int?
  avgTimeOnSiteMin Decimal? @db.Decimal(6, 2)
  chatCount        Int?
  firstPageUrl     String?
  pagesViewed      String[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("web_behavior")
  @@schema("propyte_crm")
}
```

---

### Task 4: Modelos del motor de workflows (§D.2)

**Files:** Modify: `prisma/schema.prisma`

- [ ] **Step 1:** Agregar:

```prisma
// =====================================================================
// REBUILD F1 — Motor de workflows (Anexo Técnico §D.2)
// =====================================================================

// Log append-only de eventos de dominio. `type` es String (extensible sin migración):
// lead.captured, lead.assigned, contact.scored, deal.stage_changed, quote.opened,
// whatsapp.replied, unit.viewed, payment.overdue, visit.completed, deal.won, deal.lost…
model WorkflowEvent {
  id          String    @id @default(uuid())
  type        String
  entityType  String // "contact" | "deal" | "conversation" | …
  entityId    String
  payload     Json      @default("{}")
  occurredAt  DateTime  @default(now())
  processedAt DateTime?

  @@index([processedAt])
  @@index([entityType, entityId])
  @@index([type, occurredAt])
  @@map("workflow_events")
  @@schema("propyte_crm")
}

// Regla de automatización data-driven (conditions = DSL §D.4, actions = ActionSpec[])
model AutomationRule {
  id              String      @id @default(uuid())
  name            String
  description     String?     @db.Text
  isActive        Boolean     @default(false)
  priority        Int         @default(100)
  triggerType     TriggerType
  triggerConfig   Json        @default("{}")
  conditions      Json        @default("{}")
  actions         Json        @default("[]")
  cooldownMinutes Int?
  lastFiredAt     DateTime?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@map("automation_rules")
  @@schema("propyte_crm")
}

// Cadencia / action plan. ownerUserId=null → global; con valor → cadencia personal (Anexo B §J.3)
model ActionPlan {
  id             String  @id @default(uuid())
  name           String
  description    String? @db.Text
  isActive       Boolean @default(false)
  ownerUserId    String?
  owner          User?   @relation("OwnedActionPlans", fields: [ownerUserId], references: [id])
  entryTrigger   Json    @default("{}")
  exitConditions Json    @default("{}")

  steps           ActionPlanStep[]
  enrollments     ActionPlanEnrollment[]
  defaultForUsers UserProfile[]          @relation("DefaultCadence")

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@map("action_plans")
  @@schema("propyte_crm")
}

model ActionPlanStep {
  id            String             @id @default(uuid())
  planId        String
  plan          ActionPlan         @relation(fields: [planId], references: [id])
  order         Int
  delayMinutes  Int                @default(0)
  actionType    WorkflowActionType
  config        Json               @default("{}")
  conditions    Json?
  autonomyLevel AutonomyLevel      @default(L0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([planId, order])
  @@map("action_plan_steps")
  @@schema("propyte_crm")
}

model ActionPlanEnrollment {
  id          String           @id @default(uuid())
  planId      String
  plan        ActionPlan       @relation(fields: [planId], references: [id])
  entityType  String
  entityId    String
  currentStep Int              @default(0)
  status      EnrollmentStatus @default(ACTIVE)
  nextRunAt   DateTime?
  enrolledAt  DateTime         @default(now())
  exitedAt    DateTime?

  @@unique([planId, entityType, entityId])
  @@index([status, nextRunAt])
  @@map("action_plan_enrollments")
  @@schema("propyte_crm")
}

// Cola de acciones (decisión §K G.5: pg-backed + cron + API runner). dedupeKey garantiza idempotencia.
model ActionQueue {
  id          String             @id @default(uuid())
  ruleId      String?
  planStepId  String?
  actionType  WorkflowActionType
  entityType  String
  entityId    String
  config      Json               @default("{}")
  dedupeKey   String             @unique
  status      ActionQueueStatus  @default(PENDING)
  attempts    Int                @default(0)
  maxAttempts Int                @default(3)
  runAfter    DateTime           @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?
  error       String?            @db.Text

  createdAt DateTime @default(now())

  @@index([status, runAfter])
  @@map("action_queue")
  @@schema("propyte_crm")
}

// Ruteo de leads (conditions: plaza/idioma/fuente/score/perfil; targets: userIds+weights)
model RoutingRule {
  id         String             @id @default(uuid())
  name       String
  priority   Int                @default(100)
  isActive   Boolean            @default(true)
  conditions Json               @default("{}")
  strategy   LeadAssignmentMode
  targets    Json               @default("{}")

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@map("routing_rules")
  @@schema("propyte_crm")
}

// Política SLA (businessHours keyed por plaza — decisión §K G.7)
model SlaPolicy {
  id                String  @id @default(uuid())
  name              String
  isDefault         Boolean @default(false)
  isActive          Boolean @default(true)
  firstTouchMinutes Int     @default(5)
  retryMinutes      Int     @default(30)
  orphanHours       Int     @default(24)
  escalationChain   Json    @default("[]")
  businessHours     Json    @default("{}")
  channelFallback   Json    @default("{}")

  timers SlaTimer[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("sla_policies")
  @@schema("propyte_crm")
}

model SlaTimer {
  id         String         @id @default(uuid())
  contactId  String
  contact    Contact        @relation(fields: [contactId], references: [id])
  dealId     String?
  deal       Deal?          @relation(fields: [dealId], references: [id])
  policyId   String?
  policy     SlaPolicy?     @relation(fields: [policyId], references: [id])
  type       SlaTimerType
  status     SlaTimerStatus @default(RUNNING)
  dueAt      DateTime
  metAt      DateTime?
  breachedAt DateTime?

  createdAt DateTime @default(now())

  @@index([status, dueAt])
  @@map("sla_timers")
  @@schema("propyte_crm")
}
```

---

### Task 5: Modelos de conectores e inbox (Anexo B §H/§I)

**Files:** Modify: `prisma/schema.prisma`

- [ ] **Step 1:** Agregar:

```prisma
// =====================================================================
// REBUILD F1 — Conectores de leads (Anexo B §H) e Inbox (§I)
// =====================================================================

// Conector de intake (Meta Lead Ads / TikTok Lead Gen / Web). credentials va CIFRADO (lib/crypto).
model LeadConnector {
  id          String            @id @default(uuid())
  name        String
  provider    ConnectorProvider
  status      ConnectorStatus   @default(PAUSED)
  credentials String?           @db.Text // JSON cifrado AES-256-GCM — nunca en claro
  config      Json              @default("{}")
  fieldMap    Json              @default("{}")
  lastLeadAt  DateTime?
  lastSyncAt  DateTime?
  errorCount  Int               @default(0)
  lastError   String?           @db.Text

  leadLogs ConnectorLeadLog[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@map("lead_connectors")
  @@schema("propyte_crm")
}

// Log de leads entrantes por conector — idempotencia (UNIQUE) + replay + auditoría
model ConnectorLeadLog {
  id             String              @id @default(uuid())
  connectorId    String
  connector      LeadConnector       @relation(fields: [connectorId], references: [id])
  externalLeadId String
  rawPayload     Json
  contactId      String?
  contact        Contact?            @relation(fields: [contactId], references: [id])
  status         ConnectorLeadStatus @default(RECEIVED)
  errorDetail    String?             @db.Text
  receivedAt     DateTime            @default(now())
  processedAt    DateTime?

  @@unique([connectorId, externalLeadId])
  @@index([status, receivedAt])
  @@map("connector_lead_logs")
  @@schema("propyte_crm")
}

// Conversación (un hilo por contacto+canal). status=HUMAN ⇒ el bot NUNCA envía en este hilo.
model Conversation {
  id             String              @id @default(uuid())
  contactId      String
  contact        Contact             @relation(fields: [contactId], references: [id])
  channel        ConversationChannel @default(WHATSAPP)
  status         ConversationStatus  @default(BOT)
  controlledById String?
  controlledBy   User?               @relation("ControlledConversations", fields: [controlledById], references: [id])
  botEnabled     Boolean             @default(true)
  lastMessageAt  DateTime?
  lastInboundAt  DateTime?
  unreadCount    Int                 @default(0)
  aiSummary      String?             @db.Text
  takeoverAt     DateTime?
  snoozedUntil   DateTime?

  messages Message[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([contactId, channel])
  @@index([status, lastMessageAt])
  @@map("conversations")
  @@schema("propyte_crm")
}
```

---

### Task 6: Modelos de perfiles de usuario (Anexo B §J)

**Files:** Modify: `prisma/schema.prisma`

- [ ] **Step 1:** Agregar:

```prisma
// =====================================================================
// REBUILD F1 — Perfiles de usuario (Anexo B §J)
// =====================================================================

model UserProfile {
  id     String @id @default(uuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id])

  jobTitle       String?
  bioEs          String? @db.Text
  bioEn          String? @db.Text
  photoUrl       String?
  phoneDirect    String?
  whatsappNumber String?
  languages      String[] @default(["ES"])

  // Correo
  emailFromAlias     String?
  emailSignatureHtml String? @db.Text

  // Tarjeta digital pública /t/{cardSlug} (slug inmutable tras publicar — los QR impresos no se rompen)
  cardSlug  String? @unique
  cardTheme Json    @default("{}")

  socialLinks       Json    @default("{}")
  calendarUrl       String?
  defaultCadenceId  String?
  defaultCadence    ActionPlan? @relation("DefaultCadence", fields: [defaultCadenceId], references: [id])
  notificationPrefs Json    @default("{}")
  workingHours      Json    @default("{}")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("user_profiles")
  @@schema("propyte_crm")
}

// Plantillas de mensaje. userId=null → plantilla GLOBAL de marca (solo ADMIN/MARKETING editan).
model UserTemplate {
  id         String            @id @default(uuid())
  userId     String?
  user       User?             @relation(fields: [userId], references: [id])
  channel    TemplateChannel
  name       String
  shortcut   String?
  subject    String?
  body       String            @db.Text
  language   PreferredLanguage @default(ES)
  isActive   Boolean           @default(true)
  usageCount Int               @default(0)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@unique([userId, shortcut])
  @@map("user_templates")
  @@schema("propyte_crm")
}
```

- [ ] **Step 2:** `npx prisma validate` → PASS. `npx prisma format`.
- [ ] **Step 3:** Commit: `feat(schema): F1 fundaciones — enums + 16 modelos nuevos (motor, conectores, inbox, perfiles, KYC)`

---

### Task 7: Migración SQL additiva + aplicar + generar cliente

**Files:**
- Create: `prisma/migrations-manual/2026-06-10-f1-fundaciones.sql`

- [ ] **Step 1:** Generar SQL por diff contra el schema de git HEAD (NUNCA contra la BD — la BD tiene tablas históricas que el diff dropearía):

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema-old.prisma
npx prisma migrate diff \
  --from-schema-datamodel /tmp/schema-old.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations-manual/2026-06-10-f1-fundaciones.sql
```

- [ ] **Step 2:** REVISAR el SQL: solo `CREATE TYPE`, `ALTER TYPE … ADD VALUE`, `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `CREATE [UNIQUE] INDEX`, `ADD CONSTRAINT … FOREIGN KEY`. **Cero `DROP`, cero `ALTER COLUMN` sobre columnas existentes.** Si aparece algo destructivo → STOP y corregir el schema.

- [ ] **Step 3:** Anexar al final del archivo el backfill de `messages.sender` (los históricos inbound eran del contacto):

```sql
-- Backfill: mensajes históricos
UPDATE "propyte_crm"."messages"
SET "sender" = CASE WHEN "direction" = 'INBOUND' THEN 'CONTACT'::"propyte_crm"."MessageSender"
                    ELSE 'ADVISOR'::"propyte_crm"."MessageSender" END
WHERE "sender" = 'SYSTEM';
```

- [ ] **Step 4:** Aplicar: `npx prisma db execute --file prisma/migrations-manual/2026-06-10-f1-fundaciones.sql --schema prisma/schema.prisma`
  - Nota Postgres: `ALTER TYPE … ADD VALUE` no corre dentro de transacción con uso del valor; si `db execute` falla por eso, separar esa línea en un archivo previo y ejecutarlo primero.
- [ ] **Step 5:** `npx prisma generate` → OK. `npx tsc --noEmit` → OK.
- [ ] **Step 6:** Verificación: script efímero que haga `count()` sobre 3 tablas nuevas (`workflowEvent`, `leadConnector`, `userProfile`) → 0 filas, sin error.
- [ ] **Step 7:** Commit: `feat(db): F1 migración additiva aplicada (16 tablas + extensiones contact/deal/message)`

---

### Task 8: `lib/phone.ts` — normalización E.164 (TDD)

**Files:**
- Create: `src/lib/phone.ts`
- Test: `src/lib/phone.test.ts`

- [ ] **Step 1:** Test primero:

```ts
import { describe, it, expect } from "vitest";
import { normalizePhoneE164 } from "./phone";

describe("normalizePhoneE164", () => {
  it("normaliza formato mexicano con espacios", () => {
    expect(normalizePhoneE164("+52 984 123 4567")).toBe("+529841234567");
  });
  it("agrega +52 a 10 dígitos nacionales", () => {
    expect(normalizePhoneE164("9841234567")).toBe("+529841234567");
  });
  it("respeta otros códigos de país", () => {
    expect(normalizePhoneE164("+1 (305) 555-0199")).toBe("+13055550199");
  });
  it("quita el 1 de marcación celular legacy 521", () => {
    expect(normalizePhoneE164("+5219841234567")).toBe("+529841234567");
  });
  it("convierte 52 sin + (12 dígitos) a +52", () => {
    expect(normalizePhoneE164("529841234567")).toBe("+529841234567");
  });
  it("whatsapp: prefijo 'whatsapp:' de Twilio", () => {
    expect(normalizePhoneE164("whatsapp:+5219841234567")).toBe("+529841234567");
  });
  it("rechaza basura", () => {
    expect(normalizePhoneE164("hola")).toBeNull();
    expect(normalizePhoneE164("123")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
  });
});
```

- [ ] **Step 2:** `npm test` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementación:

```ts
// Normalización de teléfonos a E.164 — clave de dedup de contactos (Anexo §A).
// Heurística MX-first: 10 dígitos => +52; tolera el "1" celular legacy (+521…).
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^whatsapp:/i, "").replace(/[\s\-().]/g, "");
  if (!s) return null;

  const hasPlus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  if (s.length < 10 || s.length > 15) return null;

  // +521XXXXXXXXXX (13 díg) → +52XXXXXXXXXX (legacy celular MX)
  if (s.startsWith("521") && s.length === 13) s = "52" + s.slice(3);

  if (hasPlus) return "+" + s;
  if (s.length === 10) return "+52" + s; // nacional MX
  if (s.startsWith("52") && s.length === 12) return "+" + s;
  return "+" + s; // internacional sin + (mejor esfuerzo)
}
```

- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit: `feat(lib): normalización E.164 con tests (clave de dedup)`

---

### Task 9: `lib/crypto.ts` — cifrado AES-256-GCM para PII (TDD)

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `src/lib/crypto.test.ts`
- Modify: `.env.example` (agregar `KYC_ENCRYPTION_KEY=`)

- [ ] **Step 1:** Test primero:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { encryptPII, decryptPII } from "./crypto";

beforeAll(() => {
  // 32 bytes en base64 para el test
  process.env.KYC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("crypto PII", () => {
  it("roundtrip", () => {
    const enc = encryptPII("CURP123456HQRXXX01");
    expect(enc).not.toContain("CURP");
    expect(decryptPII(enc)).toBe("CURP123456HQRXXX01");
  });
  it("dos cifrados del mismo texto difieren (IV aleatorio)", () => {
    expect(encryptPII("X")).not.toBe(encryptPII("X"));
  });
  it("null-safe", () => {
    expect(encryptPII(null)).toBeNull();
    expect(decryptPII(null)).toBeNull();
  });
  it("rechaza ciphertext manipulado", () => {
    const enc = encryptPII("dato")!;
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(() => decryptPII(tampered)).toThrow();
  });
});
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementación:

```ts
// Cifrado de PII (KYC) a nivel app — decisión Anexo B §K (G.4).
// AES-256-GCM. Formato: v1:<iv b64>:<authTag b64>:<ciphertext b64>
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function key(): Buffer {
  const k = process.env.KYC_ENCRYPTION_KEY;
  if (!k) throw new Error("KYC_ENCRYPTION_KEY no configurada");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error("KYC_ENCRYPTION_KEY debe ser 32 bytes base64");
  return buf;
}

export function encryptPII(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decryptPII(value: string | null | undefined): string | null {
  if (value == null || value === "") return value ?? null;
  const [v, ivB64, tagB64, dataB64] = value.split(":");
  if (v !== "v1") throw new Error("Formato de cifrado desconocido");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4:** `npm test` → PASS. Agregar `KYC_ENCRYPTION_KEY=` a `.env.example` con comentario de generación: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- [ ] **Step 5:** Commit: `feat(lib): cifrado AES-256-GCM para PII KYC con tests`

---

### Task 10: Validaciones zod de entidades nuevas

**Files:**
- Create: `src/lib/validations/rebuild-f1.ts`
- Test: `src/lib/validations/rebuild-f1.test.ts`

- [ ] **Step 1:** Test primero (casos clave):

```ts
import { describe, it, expect } from "vitest";
import {
  conditionsDslSchema,
  connectorCredentialsMetaSchema,
  userTemplateSchema,
  incomingLeadSchema,
} from "./rebuild-f1";

describe("conditions DSL", () => {
  it("acepta DSL anidado válido", () => {
    const r = conditionsDslSchema.safeParse({
      all: [
        { field: "contact.score", op: "gte", value: 70 },
        { any: [{ field: "deal.stage", op: "eq", value: "PROPOSAL_SENT" }] },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("rechaza operador desconocido", () => {
    expect(conditionsDslSchema.safeParse({ all: [{ field: "x", op: "regex", value: 1 }] }).success).toBe(false);
  });
});

describe("credenciales Meta", () => {
  it("exige pageId+pageAccessToken+appSecret+verifyToken", () => {
    expect(connectorCredentialsMetaSchema.safeParse({ pageId: "1" }).success).toBe(false);
    expect(
      connectorCredentialsMetaSchema.safeParse({
        pageId: "1", pageAccessToken: "t", appSecret: "s", verifyToken: "v",
      }).success
    ).toBe(true);
  });
});

describe("plantillas", () => {
  it("shortcut con formato /algo", () => {
    expect(userTemplateSchema.safeParse({ channel: "WHATSAPP", name: "x", body: "hola", language: "ES", shortcut: "precio" }).success).toBe(false);
    expect(userTemplateSchema.safeParse({ channel: "WHATSAPP", name: "x", body: "hola", language: "ES", shortcut: "/precio" }).success).toBe(true);
  });
});

describe("incoming lead", () => {
  it("exige teléfono o email", () => {
    expect(incomingLeadSchema.safeParse({ source: "WEBSITE", firstName: "A", lastName: "B" }).success).toBe(false);
    expect(incomingLeadSchema.safeParse({ source: "WEBSITE", firstName: "A", lastName: "B", phone: "+529841234567" }).success).toBe(true);
  });
});
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar `rebuild-f1.ts` con: `conditionDslOps` (eq,neq,gt,gte,lt,lte,in,nin,contains,exists,changed_to), `conditionsDslSchema` (lazy recursivo all/any/leaf), `actionSpecSchema` ({type: WorkflowActionType, config}), `connectorCredentialsMetaSchema`, `connectorCredentialsTikTokSchema` (advertiserId+accessToken+appId+secret), `userProfileSchema` (cardSlug kebab-case `/^[a-z0-9]+(-[a-z0-9]+)*$/`, emailFromAlias termina en `@propyte.com`), `userTemplateSchema` (shortcut `/^\/[a-z0-9-]+$/`), `incomingLeadSchema` (webhook H.5: refine phone-o-email, phone via normalizePhoneE164).
- [ ] **Step 4:** `npm test` → PASS. `npx tsc --noEmit` → OK.
- [ ] **Step 5:** Commit: `feat(validations): zod F1 — DSL condiciones, credenciales conectores, perfiles, intake`

---

### Task 11: Seeds canónicos (datos, no lógica)

**Files:**
- Create: `scripts/seed-rebuild-f1.ts`

- [ ] **Step 1:** Script idempotente (upsert por nombre) que crea:
  1. `SlaPolicy` "Default Propyte" — isDefault, 5/30/24, businessHours por plaza (PDC/TULUM/MERIDA L-S 09:00-18:00), channelFallback `{afterRetry:"WHATSAPP"}`.
  2. `RoutingRule` "Round-robin asesores activos" — priority 100, conditions `{}`, strategy ROUND_ROBIN, targets `{roles:["ASESOR","ASESOR_SR","ASESOR_JR"]}`.
  3. Las **8 AutomationRule canónicas** (§D.5) con `isActive=false` (se activan en Fase 2 cuando exista el runner), `conditions`/`actions` en el DSL real — sirven de fixture y documentación viva.
  4. 4 `UserTemplate` globales (userId=null): primer contacto ES/EN WhatsApp, seguimiento post-visita ES, correo presentación ES — con variables `{{contact.firstName}}`, `{{user.name}}`, `{{card.url}}`.
- [ ] **Step 2:** Correr: `npx tsx scripts/seed-rebuild-f1.ts` → reporta creados/actualizados.
- [ ] **Step 3:** Commit: `feat(seeds): F1 — SLA default, ruteo round-robin, 8 workflows canónicos (inactivos), plantillas de marca`

---

### Task 12: Verificación final de fase

- [ ] **Step 1:** `npm test` → todo verde.
- [ ] **Step 2:** `npx tsc --noEmit` → OK.
- [ ] **Step 3:** `npm run build` → verde (CUIDADO: detener dev server antes; comparten `.next/`).
- [ ] **Step 4:** Smoke Playwright: login + dashboard + contactos (nada roto por el schema).
- [ ] **Step 5:** Push rama + actualizar `task_manager.md` + memoria.

## Self-Review (hecho al escribir)
- Cobertura: §B.2-B.5 ✓ (Task 2-3) · §D.2-D.3 ✓ (Task 1, 4) · §H.1-H.2 ✓ (Task 5) · §I.1-I.2 ✓ (Task 5, 2) · §J.1-J.2 ✓ (Task 6) · §K decisiones reflejadas (ActionQueue, cifrado, slug) ✓.
- Quote/PaymentPlan/DealDocument/ExternalBroker (§2.3 consolidado items 4-8) van en **Fase 6** — fuera de F1 a propósito (YAGNI hasta el cotizador).
- Tipos consistentes: `WorkflowActionType` (no `ActionType`, choca con nombre genérico), `EnrollmentStatus`, `AutonomyLevel` usados igual en Tasks 4/5/6.
