# Inbox social (Instagram DM + Messenger) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sumar Instagram DM y Facebook Messenger a la timeline unificada del CRM (intake → dedup → ruteo → SLA → inbox con bot IA + takeover), vía webhook Meta directo.

**Architecture:** Se extrae un *core de intake agnóstico de canal* (`handleInboundMessage`) de la lógica hoy embebida en `handleInboundWhatsApp`, y se añaden *adapters por canal* (parseo de webhook + envío Graph API) más un *dispatcher* de envío. WhatsApp se refactoriza para llamar al core (con tests de no-regresión). Nuevo webhook `/api/webhooks/meta-dm` para IG+Messenger.

**Tech Stack:** Next.js (App Router), Prisma (schema `propyte_crm`, Supabase), Meta Graph API v21.0, vitest. Migraciones manuales aditivas (`prisma/migrations-manual/`), aplicadas por MCP Supabase tras OK de Luis.

**Spec:** `docs/superpowers/specs/2026-06-17-inbox-social-ig-messenger-design.md`

**Reglas del repo a respetar:**
- `params` en rutas dinámicas es **síncrono** (`{ params }: { params: { id: string } }`), no `Promise`.
- Migraciones de schema **NO se aplican** autónomamente: se deja el `.sql` listo y se pide a Luis "aplica la migración inbox-social". `prisma generate` normal (no `--no-engine`).
- Autoría git: `Propyte-Luis` / `webkoi@webkoi-ai.com` (verificar `git config user.email` antes de commitear).
- Commits frecuentes, mensaje en español, con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Nuevos:**
- `src/lib/messaging/types.ts` — `IncomingMessage`, `ChannelAdapter`.
- `src/lib/messaging/core.ts` — `handleInboundMessage` (intake agnóstico).
- `src/lib/messaging/dispatcher.ts` — `sendChannelMessage`.
- `src/lib/messaging/adapters/instagram.ts` — parse + send IG.
- `src/lib/messaging/adapters/messenger.ts` — parse + send Messenger.
- `src/lib/messaging/graph.ts` — helper de envío Graph API (`/me/messages`, perfil).
- `src/app/api/webhooks/meta-dm/route.ts` — webhook IG+Messenger.
- Tests `*.test.ts` junto a cada módulo nuevo.
- `prisma/migrations-manual/2026-06-17-inbox-social.sql`.

**Modificados:**
- `prisma/schema.prisma` — enums + columnas.
- `src/lib/validations/rebuild-f1.ts` — `incomingLeadSchema`.
- `src/lib/intake/capture-lead.ts` — match + persistencia de id social.
- `src/lib/twilio/whatsapp.ts` — `handleInboundWhatsApp` llama al core.
- `src/lib/bot/bot-respond.ts` — parámetro `channel` + dispatcher.
- `src/app/api/conversations/[id]/messages/route.ts` — dispatcher por canal.
- `src/components/inbox/inbox-view.tsx` — badge/filtro de canal.
- Admin Integraciones (UI de `LeadConnector`) — alta de conector IG/Messenger.

---

## Task 1: Migración de datos (enums + columnas)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations-manual/2026-06-17-inbox-social.sql`

- [ ] **Step 1: Editar `prisma/schema.prisma`** — añadir valores a enums y columnas:

En `enum ConversationChannel` (tras `WEB`): añadir `INSTAGRAM` y `MESSENGER`.
En `enum MessageChannel` (tras `SMS`): añadir `INSTAGRAM` y `MESSENGER`.
En `enum ActivityType` (tras `SMS_IN`): añadir `INSTAGRAM_IN`, `INSTAGRAM_OUT`, `MESSENGER_IN`, `MESSENGER_OUT`.
En `enum LeadSource` (tras `WHATSAPP`): añadir `MESSENGER`.
En `enum ConnectorProvider` (tras `META`): añadir `INSTAGRAM`, `MESSENGER`.

En `model Contact`, junto a los identificadores, añadir:
```prisma
  instagramId   String? @unique
  messengerPsid String? @unique
```

En `model Message`, junto a `twilioSid`, añadir y relajar:
```prisma
  externalMessageId String? @unique
  externalPhone     String?   // antes NOT NULL; nullable para canales sociales (sin teléfono)
```

- [ ] **Step 2: Verificar el schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Escribir la migración SQL manual** en `prisma/migrations-manual/2026-06-17-inbox-social.sql`:

```sql
-- Inbox social IG/Messenger (§5.10.1). Aditivo + idempotente.
-- Los ALTER TYPE ADD VALUE van en statements sueltos (no usar el valor nuevo en la misma tx).

ALTER TYPE propyte_crm."ConversationChannel" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE propyte_crm."ConversationChannel" ADD VALUE IF NOT EXISTS 'MESSENGER';
ALTER TYPE propyte_crm."MessageChannel" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE propyte_crm."MessageChannel" ADD VALUE IF NOT EXISTS 'MESSENGER';
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'INSTAGRAM_IN';
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'INSTAGRAM_OUT';
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'MESSENGER_IN';
ALTER TYPE propyte_crm."ActivityType" ADD VALUE IF NOT EXISTS 'MESSENGER_OUT';
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'MESSENGER';
ALTER TYPE propyte_crm."ConnectorProvider" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE propyte_crm."ConnectorProvider" ADD VALUE IF NOT EXISTS 'MESSENGER';

ALTER TABLE propyte_crm.contacts ADD COLUMN IF NOT EXISTS "instagramId" text;
ALTER TABLE propyte_crm.contacts ADD COLUMN IF NOT EXISTS "messengerPsid" text;
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_instagramId_key"   ON propyte_crm.contacts ("instagramId")   WHERE "instagramId"   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_messengerPsid_key" ON propyte_crm.contacts ("messengerPsid") WHERE "messengerPsid" IS NOT NULL;

ALTER TABLE propyte_crm.messages ADD COLUMN IF NOT EXISTS "externalMessageId" text;
CREATE UNIQUE INDEX IF NOT EXISTS "messages_externalMessageId_key" ON propyte_crm.messages ("externalMessageId") WHERE "externalMessageId" IS NOT NULL;
ALTER TABLE propyte_crm.messages ALTER COLUMN "externalPhone" DROP NOT NULL;
```

- [ ] **Step 4: Generar el cliente Prisma**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` sin errores. (Si la DLL de Windows está bloqueada por un dev server, detenerlo y reintentar — NO usar `--no-engine`.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-06-17-inbox-social.sql
git commit -m "feat(inbox-social): schema enums + columnas IG/Messenger (migración aditiva)"
```

> **Gate de migración:** la migración NO se aplica aquí. Al final del plan se pide a Luis "aplica la migración inbox-social" (vía MCP Supabase; los `ALTER TYPE ADD VALUE` se corren por separado del resto). Hasta entonces, las queries que usen los valores nuevos fallarán en runtime — por eso se valida con tests unitarios (mockeando Prisma) y el smoke real va tras aplicar.

---

## Task 2: Extender `incomingLeadSchema` (source social + identidad social)

**Files:**
- Modify: `src/lib/validations/rebuild-f1.ts:126-161`
- Test: `src/lib/validations/rebuild-f1.test.ts`

- [ ] **Step 1: Escribir el test** en `src/lib/validations/rebuild-f1.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { incomingLeadSchema } from "./rebuild-f1";

describe("incomingLeadSchema — identidad social", () => {
  it("acepta un lead solo con instagramId (sin phone/email)", () => {
    const r = incomingLeadSchema.safeParse({
      source: "INSTAGRAM",
      firstName: "Ana",
      instagramId: "178414000000000",
    });
    expect(r.success).toBe(true);
  });

  it("acepta source MESSENGER con messengerPsid", () => {
    const r = incomingLeadSchema.safeParse({
      source: "MESSENGER",
      firstName: "Beto",
      messengerPsid: "24680",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza si no hay phone, email, instagramId ni messengerPsid", () => {
    const r = incomingLeadSchema.safeParse({ source: "INSTAGRAM", firstName: "Sin Id" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run src/lib/validations/rebuild-f1.test.ts`
Expected: FAIL (source `MESSENGER` no es válido; el `.refine` exige phone/email).

- [ ] **Step 3: Editar `incomingLeadSchema`** en `src/lib/validations/rebuild-f1.ts`:

En el `z.enum([...])` de `source`, añadir `"MESSENGER"` (junto a `"INSTAGRAM"`, `"WHATSAPP"`, etc.).
Añadir dos campos opcionales dentro del `.object({...})`:
```typescript
    instagramId: z.string().min(1).max(120).optional(),
    messengerPsid: z.string().min(1).max(120).optional(),
```
Cambiar el `.refine(...)` final por:
```typescript
  .refine((d) => !!d.phone || !!d.email || !!d.instagramId || !!d.messengerPsid, {
    message: "Se requiere teléfono, email o identificador social",
    path: ["phone"],
  });
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run src/lib/validations/rebuild-f1.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/rebuild-f1.ts src/lib/validations/rebuild-f1.test.ts
git commit -m "feat(inbox-social): incomingLeadSchema acepta identidad social (IG/Messenger)"
```

---

## Task 3: `captureLead` — match y persistencia por id social

**Files:**
- Modify: `src/lib/intake/capture-lead.ts`
- Test: `src/lib/intake/capture-lead.social.test.ts`

**Contexto:** hoy `captureLead` busca contacto por `phone`/`email`. Hay que: (a) si no hay match por phone/email, buscar por `instagramId`/`messengerPsid`; (b) al crear el contacto, persistir `instagramId`/`messengerPsid` si vienen en el input.

- [ ] **Step 1: Escribir el test** en `src/lib/intake/capture-lead.social.test.ts` (mock de Prisma):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => findFirst(...a), create: (...a: unknown[]) => create(...a) },
    activity: { create: vi.fn() },
  },
}));
vi.mock("@/lib/workflows/routing", () => ({ autoRouteLead: vi.fn(async () => ({ assignedToId: "u1" })) }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: vi.fn() }));

import { captureLead } from "./capture-lead";

beforeEach(() => { findFirst.mockReset(); create.mockReset(); });

describe("captureLead — identidad social", () => {
  it("matchea contacto existente por instagramId (no crea)", async () => {
    findFirst.mockResolvedValueOnce({ id: "c-ig", assignedToId: "u1" });
    const r = await captureLead({ source: "INSTAGRAM", firstName: "Ana", instagramId: "IG-1" });
    expect(r.isNew).toBe(false);
    expect(r.contactId).toBe("c-ig");
    expect(create).not.toHaveBeenCalled();
  });

  it("crea contacto nuevo persistiendo el instagramId", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValueOnce({ id: "c-new", assignedToId: null });
    const r = await captureLead({ source: "INSTAGRAM", firstName: "Nuevo", instagramId: "IG-2" }, { skipRouting: true });
    expect(r.isNew).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ instagramId: "IG-2" }) })
    );
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run src/lib/intake/capture-lead.social.test.ts`
Expected: FAIL (captureLead no busca ni persiste id social).

- [ ] **Step 3: Editar `src/lib/intake/capture-lead.ts`**:

En la búsqueda de duplicado (el `where` que hoy arma OR por `phone`/`email`), añadir las cláusulas sociales cuando vengan en el input. El OR debe incluir, además de `{ phone }` y `{ email }`:
```typescript
      ...(input.instagramId ? [{ instagramId: input.instagramId as string }] : []),
      ...(input.messengerPsid ? [{ messengerPsid: input.messengerPsid as string }] : []),
```
(usa `prisma.contact.findFirst` con `OR: [...]` y el filtro existente de `deletedAt: null`, `mergedIntoId: null`).

En el `prisma.contact.create({ data: {...} })`, añadir al `data`:
```typescript
      instagramId: (input.instagramId as string) ?? null,
      messengerPsid: (input.messengerPsid as string) ?? null,
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run src/lib/intake/capture-lead.social.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/intake/capture-lead.ts src/lib/intake/capture-lead.social.test.ts
git commit -m "feat(inbox-social): captureLead matchea y persiste id social"
```

---

## Task 4: Tipos de mensajería (`IncomingMessage`, `ChannelAdapter`)

**Files:**
- Create: `src/lib/messaging/types.ts`

- [ ] **Step 1: Crear `src/lib/messaging/types.ts`**:

```typescript
import type { ConversationChannel } from "@prisma/client";

/** Canales sociales/mensajería soportados por el core agnóstico. */
export type MessagingChannel = Extract<ConversationChannel, "WHATSAPP" | "INSTAGRAM" | "MESSENGER">;

/** Mensaje entrante ya normalizado, agnóstico del proveedor. */
export interface IncomingMessage {
  channel: MessagingChannel;
  /** Id estable del remitente en el canal: E.164 (WA), IGSID (IG) o PSID (Messenger). */
  senderId: string;
  /** Id del mensaje en el proveedor (wamid/mid) — para dedup idempotente. */
  externalMessageId: string;
  text: string;
  mediaUrl?: string | null;
  /** Nombre/usuario del perfil si el adapter lo resolvió (best-effort). */
  profileName?: string | null;
}

/** Resultado de un envío saliente por un adapter. */
export interface SendResult {
  externalMessageId: string;
  status: "SENT" | "QUEUED";
}
```

- [ ] **Step 2: Verificar compilación de tipos**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos en `src/lib/messaging/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/messaging/types.ts
git commit -m "feat(inbox-social): tipos de mensajería agnósticos (IncomingMessage)"
```

---

## Task 5: Core `handleInboundMessage` (intake agnóstico)

**Files:**
- Create: `src/lib/messaging/core.ts`
- Test: `src/lib/messaging/core.test.ts`

**Contexto:** replica el flujo de `handleInboundWhatsApp` pero parametrizado por canal: match (por socialId/phone) → captureLead si nuevo → upsert Conversation(channel) → create Message (dedup por `externalMessageId`) → Activity(`<CH>_IN`) → meetSlaTimers → si BOT+botEnabled `botRespond(contactId, { channel })`, si HUMAN notifica.

- [ ] **Step 1: Escribir el test** en `src/lib/messaging/core.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const convUpsert = vi.fn();
const msgCreate = vi.fn();
const msgFindUnique = vi.fn();
const activityCreate = vi.fn();
const captureLead = vi.fn();
const botRespond = vi.fn();
const meetSlaTimers = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a), findUnique: vi.fn(async () => ({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" })) },
    conversation: { upsert: (...a: unknown[]) => convUpsert(...a) },
    message: { create: (...a: unknown[]) => msgCreate(...a), findUnique: (...a: unknown[]) => msgFindUnique(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { create: vi.fn() },
  },
}));
vi.mock("@/lib/intake/capture-lead", () => ({ captureLead: (...a: unknown[]) => captureLead(...a) }));
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));
vi.mock("@/lib/workflows/sla", () => ({ meetSlaTimers: (...a: unknown[]) => meetSlaTimers(...a) }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: vi.fn() }));

import { handleInboundMessage } from "./core";

beforeEach(() => {
  [contactFindFirst, convUpsert, msgCreate, msgFindUnique, activityCreate, captureLead, botRespond, meetSlaTimers].forEach((m) => m.mockReset());
  convUpsert.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
  msgCreate.mockResolvedValue({ id: "m1" });
  activityCreate.mockResolvedValue({});
});

const base = { channel: "INSTAGRAM" as const, senderId: "IG-1", externalMessageId: "mid-1", text: "hola", profileName: "Ana" };

describe("handleInboundMessage", () => {
  it("DM de desconocido → captureLead con source y id social", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(base);
    expect(captureLead).toHaveBeenCalledWith(
      expect.objectContaining({ source: "INSTAGRAM", instagramId: "IG-1", firstName: "Ana" })
    );
    expect(convUpsert).toHaveBeenCalled();
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "INSTAGRAM", direction: "INBOUND", externalMessageId: "mid-1" }) })
    );
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activityType: "INSTAGRAM_IN" }) })
    );
  });

  it("contacto conocido por instagramId → no captura", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(captureLead).not.toHaveBeenCalled();
  });

  it("reentrega con mismo externalMessageId → idempotente (no duplica)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    msgCreate.mockRejectedValueOnce({ code: "P2002" });
    msgFindUnique.mockResolvedValue({ id: "m-existing" });
    const r = await handleInboundMessage(base);
    expect(msgFindUnique).toHaveBeenCalledWith({ where: { externalMessageId: "mid-1" } });
    expect(r).toEqual({ id: "m-existing" });
  });

  it("status BOT + botEnabled → botRespond con channel", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run src/lib/messaging/core.test.ts`
Expected: FAIL (`handleInboundMessage` no existe).

- [ ] **Step 3: Crear `src/lib/messaging/core.ts`**:

```typescript
import prisma from "@/lib/db";
import type { IncomingMessage, MessagingChannel } from "./types";

const IN_ACTIVITY: Record<MessagingChannel, "WHATSAPP_IN" | "INSTAGRAM_IN" | "MESSENGER_IN"> = {
  WHATSAPP: "WHATSAPP_IN",
  INSTAGRAM: "INSTAGRAM_IN",
  MESSENGER: "MESSENGER_IN",
};

const SOURCE: Record<MessagingChannel, "WHATSAPP" | "INSTAGRAM" | "MESSENGER"> = {
  WHATSAPP: "WHATSAPP",
  INSTAGRAM: "INSTAGRAM",
  MESSENGER: "MESSENGER",
};

/** Busca el contacto por el id propio del canal. */
async function findContactByChannel(channel: MessagingChannel, senderId: string) {
  const where =
    channel === "INSTAGRAM" ? { instagramId: senderId }
    : channel === "MESSENGER" ? { messengerPsid: senderId }
    : { phone: senderId };
  return prisma.contact.findFirst({
    where: { ...where, deletedAt: null, mergedIntoId: null },
    include: { assignedTo: { select: { id: true, name: true } } },
  });
}

/**
 * Intake agnóstico de canal: match/captura → conversación → mensaje (idempotente)
 * → actividad → SLA → bot/notify. Reutilizado por WhatsApp e IG/Messenger.
 */
export async function handleInboundMessage(msg: IncomingMessage) {
  let contact = await findContactByChannel(msg.channel, msg.senderId);

  if (!contact) {
    const { captureLead } = await import("@/lib/intake/capture-lead");
    const idField =
      msg.channel === "INSTAGRAM" ? { instagramId: msg.senderId }
      : msg.channel === "MESSENGER" ? { messengerPsid: msg.senderId }
      : { phone: msg.senderId };
    const result = await captureLead({
      source: SOURCE[msg.channel],
      firstName: msg.profileName?.trim() || (msg.channel === "INSTAGRAM" ? "Instagram" : msg.channel === "MESSENGER" ? "Messenger" : "WhatsApp"),
      lastName: "(por identificar)",
      message: msg.text,
      ...idField,
    });
    if (!result.contactId) {
      console.warn(`[messaging] inbound no capturable (${msg.channel}): ${msg.senderId}`);
      return null;
    }
    contact = await prisma.contact.findUnique({
      where: { id: result.contactId },
      include: { assignedTo: { select: { id: true, name: true } } },
    });
    if (!contact) return null;
  }

  const conversation = await prisma.conversation.upsert({
    where: { contactId_channel: { contactId: contact.id, channel: msg.channel } },
    update: { lastMessageAt: new Date(), lastInboundAt: new Date(), unreadCount: { increment: 1 } },
    create: {
      contactId: contact.id,
      channel: msg.channel,
      status: "BOT",
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      unreadCount: 1,
    },
  });

  let message;
  try {
    message = await prisma.message.create({
      data: {
        contactId: contact.id,
        userId: contact.assignedToId,
        channel: msg.channel,
        direction: "INBOUND",
        body: msg.text,
        externalMessageId: msg.externalMessageId,
        mediaUrl: msg.mediaUrl ?? null,
        status: "DELIVERED",
        externalPhone: msg.channel === "WHATSAPP" ? msg.senderId : null,
        conversationId: conversation.id,
        sender: "CONTACT",
      },
    });
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      return prisma.message.findUnique({ where: { externalMessageId: msg.externalMessageId } });
    }
    throw err;
  }

  await prisma.activity.create({
    data: {
      contactId: contact.id,
      userId: contact.assignedToId || contact.id,
      activityType: IN_ACTIVITY[msg.channel],
      subject: `Mensaje ${msg.channel} de ${contact.firstName} ${contact.lastName}`,
      description: msg.text.length > 100 ? msg.text.slice(0, 100) + "..." : msg.text,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contact.id);

  if (conversation.status === "HUMAN") {
    const notifyUserId = conversation.controlledById ?? contact.assignedToId;
    if (notifyUserId) {
      await prisma.notification.create({
        data: {
          userId: notifyUserId,
          title: `${msg.channel} recibido (controlas el hilo)`,
          message: `${contact.firstName} ${contact.lastName}: ${msg.text.slice(0, 80)}`,
          type: "social_inbound",
          link: `/inbox?c=${conversation.id}`,
        },
      });
    }
  } else if (conversation.status === "BOT" && conversation.botEnabled) {
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      await botRespond(contact.id, { channel: msg.channel });
    } catch (err) {
      console.error(`[messaging] botRespond (${msg.channel}) falló:`, err);
    }
  }

  return message;
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run src/lib/messaging/core.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/messaging/core.ts src/lib/messaging/core.test.ts
git commit -m "feat(inbox-social): core handleInboundMessage agnóstico de canal"
```

---

## Task 6: Refactor `handleInboundWhatsApp` → usa el core (no-regresión)

**Files:**
- Modify: `src/lib/twilio/whatsapp.ts:124-266`
- Test: `src/lib/twilio/whatsapp.inbound.test.ts`

**Objetivo:** que el webhook de WhatsApp siga funcionando, ahora delegando en el core. `handleInboundWhatsApp` se reduce a normalizar el payload de WhatsApp a `IncomingMessage` y llamar `handleInboundMessage`, preservando lo específico de WhatsApp: el opt-out por keyword (BAJA/STOP/…) y `whatsappOptOut`.

- [ ] **Step 1: Escribir el test de no-regresión** en `src/lib/twilio/whatsapp.inbound.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const handleInboundMessage = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a) }));

import { handleInboundWhatsApp } from "./whatsapp";

beforeEach(() => handleInboundMessage.mockReset());

describe("handleInboundWhatsApp → core", () => {
  it("normaliza el payload de WhatsApp a IncomingMessage (channel WHATSAPP, senderId E.164, mid)", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1" });
    await handleInboundWhatsApp({
      From: "whatsapp:+5219991112233",
      Body: "hola",
      MessageSid: "wamid.ABC",
      ProfileName: "Ana",
    });
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "WHATSAPP",
        senderId: "+5219991112233",
        externalMessageId: "wamid.ABC",
        text: "hola",
        profileName: "Ana",
      })
    );
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run src/lib/twilio/whatsapp.inbound.test.ts`
Expected: FAIL (todavía no delega en el core).

- [ ] **Step 3: Reescribir `handleInboundWhatsApp`** en `src/lib/twilio/whatsapp.ts` para delegar en el core. Mantener la firma del payload. Cuerpo nuevo:

```typescript
export async function handleInboundWhatsApp(payload: {
  From: string;
  Body: string;
  MessageSid: string;
  NumMedia?: string;
  MediaUrl0?: string;
  ProfileName?: string;
}) {
  const rawPhone = payload.From.replace("whatsapp:", "");

  // Opt-out por keyword (específico de WhatsApp). Si aplica, marca y NO sigue el flujo normal.
  const optOutWords = ["BAJA", "STOP", "ALTO", "UNSUBSCRIBE"];
  if (optOutWords.includes(payload.Body.trim().toUpperCase())) {
    const contact = await findContactByPhone(rawPhone);
    if (contact) {
      await prisma.contact.update({ where: { id: contact.id }, data: { whatsappOptOut: true } });
      const { emitEvent } = await import("@/lib/workflows/events");
      await emitEvent("contact.opted_out", "contact", contact.id, { channel: "WHATSAPP" });
    }
    return null;
  }

  const { handleInboundMessage } = await import("@/lib/messaging/core");
  return handleInboundMessage({
    channel: "WHATSAPP",
    senderId: normalizePhone(rawPhone),
    externalMessageId: payload.MessageSid,
    text: payload.Body,
    mediaUrl: payload.MediaUrl0 || null,
    profileName: payload.ProfileName ?? null,
  });
}
```

> Nota: el core no respeta `whatsappOptOut` para el bot (ese campo es específico de WhatsApp). Como el opt-out se intercepta antes de llamar al core, un contacto con opt-out que escribe una palabra no-keyword aún entraría al bot. Para preservar el comportamiento previo, el core consulta `botEnabled` de la conversación (que el release/opt-out ya apaga). Es aceptable para v1; si se requiere paridad exacta, mover el chequeo `whatsappOptOut` a un guard del adapter WhatsApp en una mejora posterior.

- [ ] **Step 4: Correr los tests (deben pasar)**

Run: `npx vitest run src/lib/twilio/whatsapp.inbound.test.ts src/lib/messaging/core.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores (revisar que no quedaran imports sin usar en whatsapp.ts; quitarlos si los hubiera).

- [ ] **Step 6: Commit**

```bash
git add src/lib/twilio/whatsapp.ts src/lib/twilio/whatsapp.inbound.test.ts
git commit -m "refactor(inbox-social): handleInboundWhatsApp delega en el core agnóstico"
```

---

## Task 7: Helper Graph API + adapter Instagram (parse + send)

**Files:**
- Create: `src/lib/messaging/graph.ts`
- Create: `src/lib/messaging/adapters/instagram.ts`
- Test: `src/lib/messaging/adapters/instagram.test.ts`

- [ ] **Step 1: Crear `src/lib/messaging/graph.ts`**:

```typescript
import type { SendResult } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Envía un mensaje de texto a un PSID/IGSID por la Send API de la página. */
export async function sendGraphMessage(
  pageToken: string,
  recipientId: string,
  text: string
): Promise<SendResult> {
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { code?: number; message?: string };
  };
  if (!res.ok || data.error) {
    const code = data.error?.code;
    // 10/200 = fuera de ventana de 24h / sin permiso de mensajería estándar
    throw new Error(`Graph send ${code ?? res.status}: ${data.error?.message ?? "error"}`);
  }
  return { externalMessageId: data.message_id ?? `graph-${Date.now()}`, status: "SENT" };
}

/** Nombre/usuario del perfil (best-effort; puede fallar por permisos). */
export async function fetchGraphProfileName(pageToken: string, userId: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${userId}?fields=name,username&access_token=${encodeURIComponent(pageToken)}`);
    const data = (await res.json().catch(() => ({}))) as { name?: string; username?: string };
    return data.name ?? data.username ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Escribir el test** del adapter IG en `src/lib/messaging/adapters/instagram.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseInstagramWebhook } from "./instagram";

describe("parseInstagramWebhook", () => {
  it("extrae IncomingMessage de un evento messaging de IG", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          messaging: [
            { sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } },
          ],
        },
      ],
    };
    const out = parseInstagramWebhook(payload);
    expect(out).toEqual([
      { channel: "INSTAGRAM", senderId: "IGSID-1", externalMessageId: "mid-1", text: "hola", mediaUrl: null },
    ]);
  });

  it("ignora echoes (mensajes salientes propios) y eventos sin message", () => {
    const payload = {
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "x", is_echo: true } }, { sender: { id: "Y" }, read: {} }] }],
    };
    expect(parseInstagramWebhook(payload)).toEqual([]);
  });
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

Run: `npx vitest run src/lib/messaging/adapters/instagram.test.ts`
Expected: FAIL (`parseInstagramWebhook` no existe).

- [ ] **Step 4: Crear `src/lib/messaging/adapters/instagram.ts`**:

```typescript
import type { IncomingMessage } from "../types";
import { sendGraphMessage } from "../graph";

interface MetaMessagingEvent {
  sender?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ payload?: { url?: string } }> };
  read?: unknown;
  delivery?: unknown;
}
interface MetaEntry { messaging?: MetaMessagingEvent[] }
interface MetaWebhookBody { object?: string; entry?: MetaEntry[] }

/** Normaliza un webhook `object: "instagram"` a IncomingMessage[]. */
export function parseInstagramWebhook(body: MetaWebhookBody): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m || m.is_echo || !m.mid || !ev.sender?.id) continue; // ignora echoes/reads/deliveries
      out.push({
        channel: "INSTAGRAM",
        senderId: ev.sender.id,
        externalMessageId: m.mid,
        text: m.text ?? (m.attachments?.length ? "[Adjunto]" : "[mensaje]"),
        mediaUrl: m.attachments?.[0]?.payload?.url ?? null,
      });
    }
  }
  return out;
}

/** Envía a un IGSID por la Send API (page token del conector). */
export function sendInstagram(pageToken: string, igsid: string, text: string) {
  return sendGraphMessage(pageToken, igsid, text);
}
```

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `npx vitest run src/lib/messaging/adapters/instagram.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/messaging/graph.ts src/lib/messaging/adapters/instagram.ts src/lib/messaging/adapters/instagram.test.ts
git commit -m "feat(inbox-social): Graph helper + adapter Instagram (parse/send)"
```

---

## Task 8: Adapter Messenger (parse + send)

**Files:**
- Create: `src/lib/messaging/adapters/messenger.ts`
- Test: `src/lib/messaging/adapters/messenger.test.ts`

**Contexto:** el payload de Messenger (`object: "page"`) tiene la misma forma `entry[].messaging[]` que IG; cambia el `channel`.

- [ ] **Step 1: Escribir el test** en `src/lib/messaging/adapters/messenger.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseMessengerWebhook } from "./messenger";

describe("parseMessengerWebhook", () => {
  it("extrae IncomingMessage de un evento messaging de page (Messenger)", () => {
    const payload = {
      object: "page",
      entry: [{ messaging: [{ sender: { id: "PSID-1" }, message: { mid: "mid-9", text: "buenas" } }] }],
    };
    expect(parseMessengerWebhook(payload)).toEqual([
      { channel: "MESSENGER", senderId: "PSID-1", externalMessageId: "mid-9", text: "buenas", mediaUrl: null },
    ]);
  });

  it("ignora echoes", () => {
    const payload = { object: "page", entry: [{ messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "x", is_echo: true } }] }] };
    expect(parseMessengerWebhook(payload)).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run src/lib/messaging/adapters/messenger.test.ts`
Expected: FAIL.

- [ ] **Step 3: Crear `src/lib/messaging/adapters/messenger.ts`**:

```typescript
import type { IncomingMessage } from "../types";
import { sendGraphMessage } from "../graph";

interface MetaMessagingEvent {
  sender?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ payload?: { url?: string } }> };
}
interface MetaWebhookBody { object?: string; entry?: Array<{ messaging?: MetaMessagingEvent[] }> }

/** Normaliza un webhook `object: "page"` (Messenger) a IncomingMessage[]. */
export function parseMessengerWebhook(body: MetaWebhookBody): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m || m.is_echo || !m.mid || !ev.sender?.id) continue;
      out.push({
        channel: "MESSENGER",
        senderId: ev.sender.id,
        externalMessageId: m.mid,
        text: m.text ?? (m.attachments?.length ? "[Adjunto]" : "[mensaje]"),
        mediaUrl: m.attachments?.[0]?.payload?.url ?? null,
      });
    }
  }
  return out;
}

/** Envía a un PSID por la Send API (page token del conector). */
export function sendMessenger(pageToken: string, psid: string, text: string) {
  return sendGraphMessage(pageToken, psid, text);
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run src/lib/messaging/adapters/messenger.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/messaging/adapters/messenger.ts src/lib/messaging/adapters/messenger.test.ts
git commit -m "feat(inbox-social): adapter Messenger (parse/send)"
```

---

## Task 9: Dispatcher de envío `sendChannelMessage`

**Files:**
- Create: `src/lib/messaging/dispatcher.ts`
- Test: `src/lib/messaging/dispatcher.test.ts`

**Contexto:** envío saliente unificado. Para WhatsApp delega en `sendWhatsAppMessage`. Para IG/Messenger: lee el conector activo del provider, descifra `pageAccessToken`, resuelve el `senderId` del contacto, envía por el adapter, crea `Message(OUTBOUND)` + `Activity(<CH>_OUT)` + `meetSlaTimers`.

- [ ] **Step 1: Escribir el test** en `src/lib/messaging/dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendWhatsAppMessage = vi.fn();
const sendInstagram = vi.fn();
const contactFindUnique = vi.fn();
const connectorFindFirst = vi.fn();
const msgCreate = vi.fn();
const convUpsert = vi.fn();

vi.mock("@/lib/twilio/whatsapp", () => ({ sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a) }));
vi.mock("./adapters/instagram", () => ({ sendInstagram: (...a: unknown[]) => sendInstagram(...a) }));
vi.mock("./adapters/messenger", () => ({ sendMessenger: vi.fn() }));
vi.mock("@/lib/intake/connectors", () => ({ readCredentials: () => ({ pageAccessToken: "PAGE_TOKEN" }) }));
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    leadConnector: { findFirst: (...a: unknown[]) => connectorFindFirst(...a) },
    conversation: { upsert: (...a: unknown[]) => convUpsert(...a) },
    message: { create: (...a: unknown[]) => msgCreate(...a) },
    activity: { create: vi.fn() },
  },
}));
vi.mock("@/lib/workflows/sla", () => ({ meetSlaTimers: vi.fn() }));

import { sendChannelMessage } from "./dispatcher";

beforeEach(() => {
  [sendWhatsAppMessage, sendInstagram, contactFindUnique, connectorFindFirst, msgCreate, convUpsert].forEach((m) => m.mockReset());
  convUpsert.mockResolvedValue({ id: "conv1" });
  msgCreate.mockResolvedValue({ id: "m1" });
});

describe("sendChannelMessage", () => {
  it("WHATSAPP delega en sendWhatsAppMessage", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: null, messengerPsid: null });
    sendWhatsAppMessage.mockResolvedValue({ id: "wa-msg" });
    await sendChannelMessage("WHATSAPP", "c1", "hola", "u1");
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("+521999", "hola", "c1", "u1");
  });

  it("INSTAGRAM envía por adapter con el IGSID del contacto y guarda Message OUTBOUND", async () => {
    contactFindUnique.mockResolvedValue({ id: "c1", phone: "+521999", instagramId: "IGSID-1", messengerPsid: null });
    connectorFindFirst.mockResolvedValue({ id: "conn1", credentials: "enc" });
    sendInstagram.mockResolvedValue({ externalMessageId: "mid-out", status: "SENT" });
    await sendChannelMessage("INSTAGRAM", "c1", "hola", "u1");
    expect(sendInstagram).toHaveBeenCalledWith("PAGE_TOKEN", "IGSID-1", "hola");
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "INSTAGRAM", direction: "OUTBOUND", externalMessageId: "mid-out", sender: "ADVISOR" }) })
    );
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run src/lib/messaging/dispatcher.test.ts`
Expected: FAIL (`sendChannelMessage` no existe).

- [ ] **Step 3: Crear `src/lib/messaging/dispatcher.ts`**:

```typescript
import prisma from "@/lib/db";
import { readCredentials } from "@/lib/intake/connectors";
import type { MessagingChannel } from "./types";

const OUT_ACTIVITY: Record<MessagingChannel, "WHATSAPP_OUT" | "INSTAGRAM_OUT" | "MESSENGER_OUT"> = {
  WHATSAPP: "WHATSAPP_OUT",
  INSTAGRAM: "INSTAGRAM_OUT",
  MESSENGER: "MESSENGER_OUT",
};

/** Envío saliente unificado por canal. Devuelve el Message creado. */
export async function sendChannelMessage(
  channel: MessagingChannel,
  contactId: string,
  body: string,
  userId: string
) {
  if (channel === "WHATSAPP") {
    const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true } });
    if (!c?.phone) throw new Error("Contacto sin teléfono");
    const { sendWhatsAppMessage } = await import("@/lib/twilio/whatsapp");
    return sendWhatsAppMessage(c.phone, body, contactId, userId);
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { instagramId: true, messengerPsid: true },
  });
  const recipientId = channel === "INSTAGRAM" ? contact?.instagramId : contact?.messengerPsid;
  if (!recipientId) throw new Error(`Contacto sin id ${channel}`);

  const provider = channel; // ConnectorProvider tiene INSTAGRAM / MESSENGER
  const connector = await prisma.leadConnector.findFirst({
    where: { provider, status: "ACTIVE" },
  });
  if (!connector) throw new Error(`Sin conector activo ${channel}`);
  const creds = readCredentials<{ pageAccessToken: string }>(connector);
  if (!creds?.pageAccessToken) throw new Error(`Conector ${channel} sin pageAccessToken`);

  const send = channel === "INSTAGRAM"
    ? (await import("./adapters/instagram")).sendInstagram
    : (await import("./adapters/messenger")).sendMessenger;
  const result = await send(creds.pageAccessToken, recipientId, body);

  const conversation = await prisma.conversation.upsert({
    where: { contactId_channel: { contactId, channel } },
    update: { lastMessageAt: new Date() },
    create: { contactId, channel, status: "BOT", lastMessageAt: new Date() },
  });

  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel,
      direction: "OUTBOUND",
      body,
      externalMessageId: result.externalMessageId,
      status: result.status,
      conversationId: conversation.id,
      sender: "ADVISOR",
    },
  });

  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: OUT_ACTIVITY[channel],
      subject: `Mensaje ${channel} enviado`,
      description: body.length > 100 ? body.slice(0, 100) + "..." : body,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contactId);

  return message;
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run src/lib/messaging/dispatcher.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/messaging/dispatcher.ts src/lib/messaging/dispatcher.test.ts
git commit -m "feat(inbox-social): dispatcher de envío por canal"
```

---

## Task 10: Webhook `/api/webhooks/meta-dm` (IG + Messenger)

**Files:**
- Create: `src/app/api/webhooks/meta-dm/route.ts`
- Test: `src/app/api/webhooks/meta-dm/route.test.ts`

**Contexto:** patrón del webhook de WhatsApp. GET = challenge contra `META_DM_VERIFY_TOKEN`. POST = valida `x-hub-signature-256` contra `META_DM_APP_SECRET`, parsea según `body.object` (`instagram` → IG adapter, `page` → Messenger adapter), y llama `handleInboundMessage` por cada mensaje.

- [ ] **Step 1: Escribir el test** en `src/app/api/webhooks/meta-dm/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const handleInboundMessage = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a) }));

import { GET, POST } from "./route";

beforeEach(() => {
  handleInboundMessage.mockReset();
  process.env.META_DM_VERIFY_TOKEN = "verifyme";
  delete process.env.META_DM_APP_SECRET; // sin secret → no valida firma (igual que WhatsApp)
});

function req(url: string, init?: RequestInit) { return new Request(url, init) as unknown as import("next/server").NextRequest; }

describe("meta-dm webhook", () => {
  it("GET responde el challenge con verify token correcto", async () => {
    const res = await GET(req("https://x/api/webhooks/meta-dm?hub.mode=subscribe&hub.verify_token=verifyme&hub.challenge=42"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("GET rechaza verify token incorrecto", async () => {
    const res = await GET(req("https://x/api/webhooks/meta-dm?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=42"));
    expect(res.status).toBe(403);
  });

  it("POST de IG enruta cada mensaje al core", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1" });
    const body = JSON.stringify({ object: "instagram", entry: [{ messaging: [{ sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } }] }] });
    const res = await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "INSTAGRAM", senderId: "IGSID-1", externalMessageId: "mid-1" })
    );
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run src/app/api/webhooks/meta-dm/route.test.ts`
Expected: FAIL (route no existe).

- [ ] **Step 3: Crear `src/app/api/webhooks/meta-dm/route.ts`**:

```typescript
// Webhook de Instagram DM + Facebook Messenger (Meta Graph API).
// Configurar en developers.facebook.com → app → Webhooks:
//   Callback URL: https://crm.propyte.com/api/webhooks/meta-dm
//   Verify token: META_DM_VERIFY_TOKEN · Suscribir field `messages` para objetos instagram y page.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { handleInboundMessage } from "@/lib/messaging/core";
import { parseInstagramWebhook } from "@/lib/messaging/adapters/instagram";
import { parseMessengerWebhook } from "@/lib/messaging/adapters/messenger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.META_DM_VERIFY_TOKEN?.trim();
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verify_token inválido" }, { status: 403 });
}

function validSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_DM_APP_SECRET?.trim();
  if (!appSecret) return true; // sin secret no se valida (configurarlo en prod)
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.slice(7), "hex"));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!validSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let body: { object?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const messages =
    body.object === "instagram" ? parseInstagramWebhook(body)
    : body.object === "page" ? parseMessengerWebhook(body)
    : [];

  let processed = 0;
  for (const msg of messages) {
    try {
      await handleInboundMessage(msg);
      processed++;
    } catch (err) {
      console.error("[meta-dm] inbound:", err);
    }
  }
  return NextResponse.json({ ok: true, processed });
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run src/app/api/webhooks/meta-dm/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/meta-dm/route.ts src/app/api/webhooks/meta-dm/route.test.ts
git commit -m "feat(inbox-social): webhook /api/webhooks/meta-dm (IG + Messenger)"
```

---

## Task 11: Inbox — enviar por el canal de la conversación

**Files:**
- Modify: `src/app/api/conversations/[id]/messages/route.ts:50-54`

**Contexto:** hoy el POST llama siempre `sendWhatsAppMessage`. Cambiar a `sendChannelMessage(conv.channel, …)`. La nota interna y el upgrade BOT→HUMAN no cambian.

- [ ] **Step 1: Editar el handler.**

Sustituir el import `import { sendWhatsAppMessage } from "@/lib/twilio/whatsapp";` por:
```typescript
import { sendChannelMessage } from "@/lib/messaging/dispatcher";
import type { MessagingChannel } from "@/lib/messaging/types";
```
Reemplazar la llamada (líneas ~50-54) por:
```typescript
  const message = await sendChannelMessage(
    conv.channel as MessagingChannel,
    conv.contact.id,
    parsed.data.body,
    session.user.id
  );
```
En el bloque de nota interna, reemplazar `channel: conv.channel === "SMS" ? "SMS" : "WHATSAPP",` por `channel: conv.channel,`.

- [ ] **Step 2: Verificar build de tipos**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores. (El `as MessagingChannel` fuerza el tipo; WEB/SMS no envían por este flujo en v1.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/conversations/[id]/messages/route.ts"
git commit -m "feat(inbox-social): el inbox envía por el canal de la conversación"
```

---

## Task 12: Bot — responder por el canal de la conversación

**Files:**
- Modify: `src/lib/bot/bot-respond.ts:68-150`
- Test: `src/lib/bot/bot-respond.channel.test.ts`

**Contexto:** `botRespond(contactId, opts)` hoy crea/usa la conversación WHATSAPP y envía con `sendWhatsAppMessage`. Añadir `opts.channel?: MessagingChannel` (default `"WHATSAPP"`), usar ese canal en el upsert de conversación y enviar con `sendChannelMessage(channel, …)`.

- [ ] **Step 1: Escribir el test** en `src/lib/bot/bot-respond.channel.test.ts`. El test verifica el contrato mínimo: al pasar `channel: "INSTAGRAM"` la respuesta se envía por el dispatcher con ese canal. Mockear las dependencias externas:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendChannelMessage = vi.fn();
const askClaude = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({ sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a) }));
vi.mock("@/lib/bot/claude", () => ({ askClaude: (...a: unknown[]) => askClaude(...a) })); // ajustar al módulo real de askClaude
vi.mock("@/lib/bot/hub-catalog", () => ({ findMatchingDevelopments: vi.fn(async () => []) }), { virtual: true });
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: vi.fn(async () => ({ id: "c1", doNotContact: false, whatsappOptOut: false, language: "ES", firstName: "Ana" })) },
    conversation: { upsert: vi.fn(async () => ({ id: "conv1", channel: "INSTAGRAM" })), findFirst: vi.fn(async () => null) },
    message: { findMany: vi.fn(async () => []) },
  },
}));

import { botRespond } from "./bot-respond";

beforeEach(() => { sendChannelMessage.mockReset(); askClaude.mockReset(); });

describe("botRespond — canal", () => {
  it("envía la respuesta por el dispatcher con el canal indicado", async () => {
    askClaude.mockResolvedValue("Hola, ¿en qué te ayudo?");
    await botRespond("c1", { channel: "INSTAGRAM" });
    expect(sendChannelMessage).toHaveBeenCalledWith("INSTAGRAM", "c1", expect.any(String), expect.any(String));
  });
});
```

> **Nota para el implementador:** ajustar los nombres de los `vi.mock` a los módulos reales que importa `bot-respond.ts` (verificar sus imports: el de Claude, el del catálogo del Hub, el del brand-linter). El objetivo del test es solo fijar el contrato "responde por `sendChannelMessage(channel, …)`". Si algún mock no aplica, quitarlo; no añadir lógica nueva al test.

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npx vitest run src/lib/bot/bot-respond.channel.test.ts`
Expected: FAIL (botRespond aún usa sendWhatsAppMessage / no acepta channel).

- [ ] **Step 3: Editar `src/lib/bot/bot-respond.ts`**:

1. Importar tipo y dispatcher:
```typescript
import type { MessagingChannel } from "@/lib/messaging/types";
import { sendChannelMessage } from "@/lib/messaging/dispatcher";
```
2. Cambiar la firma:
```typescript
export async function botRespond(
  contactId: string,
  opts: { goal?: string; createConversation?: boolean; channel?: MessagingChannel } = {}
): Promise<boolean> {
  const channel: MessagingChannel = opts.channel ?? "WHATSAPP";
```
3. En el `prisma.conversation.upsert`/búsqueda, usar `channel` en lugar del literal `"WHATSAPP"` (en `where: { contactId_channel: { contactId, channel } }` y en `create`).
4. En el envío final de la respuesta, reemplazar `sendWhatsAppMessage(contact.phone, cleanText, contactId, <botUserId>)` por:
```typescript
    await sendChannelMessage(channel, contactId, cleanText, <botUserId>);
```
(conservar el mismo `userId`/identidad del bot; `sendChannelMessage` crea el Message/Activity — eliminar el `prisma.message.create` manual del bot si quedaba, para no doblar el registro).

> **Decisión de implementación:** si separar `aiGenerated` resulta invasivo, para v1 es aceptable que el envío del bot por `sendChannelMessage` no marque `aiGenerated` (el Message queda como `sender: ADVISOR`). Anotarlo; follow-up: parámetro opcional `opts.bot` en el dispatcher para `sender: BOT` + `aiGenerated`.

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npx vitest run src/lib/bot/bot-respond.channel.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar build + suite completa**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc sin errores; todos los tests verdes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/bot-respond.ts src/lib/bot/bot-respond.channel.test.ts
git commit -m "feat(inbox-social): botRespond responde por el canal de la conversación"
```

---

## Task 13: Inbox UI — etiqueta/ícono y filtro por canal

**Files:**
- Modify: `src/components/inbox/inbox-view.tsx`
- Modify (si falta `channel`): `src/app/api/conversations/route.ts`

**Contexto:** mostrar el canal por conversación y permitir filtrar. La API `GET /api/conversations` debe devolver `channel` por conversación (verificar; si no lo incluye, añadirlo al `select`).

- [ ] **Step 1: Añadir un mapa de etiqueta de canal** cerca de `TEMP_CLASS` (línea ~64):

```typescript
const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  WEB: "Web",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
};
```

- [ ] **Step 2: Añadir el filtro de canal.** Estado nuevo:
```typescript
  const [channelFilter, setChannelFilter] = useState<string>("all");
```
y, en el bloque de filtros (tras el `.map` de `FILTERS`, dentro del contenedor `flex gap-1 flex-wrap`), un `<select>`:
```tsx
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="form-input !py-1 text-[11px]"
          aria-label="Filtrar por canal"
        >
          <option value="all">Todos los canales</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="INSTAGRAM">Instagram</option>
          <option value="MESSENGER">Messenger</option>
        </select>
```
Aplicar el filtro al `list` renderizado (donde se hace `list.map`):
```tsx
{list.filter((c) => channelFilter === "all" || c.channel === channelFilter).map((c) => (
```

- [ ] **Step 3: Mostrar la etiqueta de canal en cada item** (línea ~199, en la fila del nombre o sobre el preview):
```tsx
          <span className="badge badge-neutral !text-[10px] !py-0">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
```

- [ ] **Step 4: Verificar build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores. (Si `c.channel` no existe en el tipo, añadir `channel` al `select` de `src/app/api/conversations/route.ts` y al tipo del componente.)

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/inbox-view.tsx src/app/api/conversations/route.ts
git commit -m "feat(inbox-social): inbox muestra y filtra por canal"
```

---

## Task 14: Admin — alta de conector IG/Messenger

**Files:**
- Modify: UI de Admin → Integraciones (CRUD de `LeadConnector`). Localizar con: `grep -rl "LeadConnector\|provider" "src/app/(dashboard)" src/components/admin` y la ruta API de conectores.

**Contexto:** reusar el formulario existente de conectores. Permitir `provider: INSTAGRAM | MESSENGER` y capturar credenciales (`pageId`, `igBusinessId`, `pageAccessToken`, `appSecret`), que se cifran con el flujo existente (`encryptPII`). Sin lógica nueva de cifrado.

- [ ] **Step 1: Localizar el formulario de conectores** y añadir `INSTAGRAM` y `MESSENGER` a las opciones de `provider` y los campos de credenciales (reusar el patrón del proveedor META: `pageId`/`pageAccessToken`/`appSecret`; `igBusinessId` y `verifyToken` van en `config`).

- [ ] **Step 2: Verificar el schema de validación** (`connectorCredentialsMetaSchema` en `rebuild-f1.ts`): reusarlo para IG/Messenger (ya pide pageId/pageAccessToken/appSecret/verifyToken).

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(inbox-social): alta de conector IG/Messenger en Admin"
```

> **Nota:** si el CRUD resulta complejo (formularios dinámicos por provider), acotar v1 a `provider` IG/Messenger + campos META existentes, dejando `igBusinessId`/`verifyToken` en el JSON `config` editable. No bloquear el plan por la UI de admin.

---

## Task 15: Verificación final + gate de migración

- [ ] **Step 1: Suite completa + build**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: todos los tests verdes, sin errores de tipos, build OK.

- [ ] **Step 2: Pedir a Luis aplicar la migración** (gate de BD compartida):

> "Listo para aplicar `prisma/migrations-manual/2026-06-17-inbox-social.sql` a `oaijxdpevakashxshhvm` (aditiva: enums + columnas `instagramId`/`messengerPsid`/`externalMessageId` + `externalPhone` nullable). Los `ALTER TYPE ADD VALUE` se corren por separado del resto. ¿Autorizas 'aplica la migración inbox-social'?"

Tras aplicar: `npx prisma generate` y re-correr `npm run build`.

- [ ] **Step 3: Pendientes de Luis (Meta) para el smoke real** (documentar; el código arranca dormido sin conector):
  - App Meta: permisos `instagram_manage_messages` + `pages_messaging`; suscribir field `messages` para objetos `instagram` y `page`; callback `https://crm.propyte.com/api/webhooks/meta-dm`.
  - Env vars: `META_DM_VERIFY_TOKEN`, `META_DM_APP_SECRET`.
  - Alta del conector IG/Messenger en Admin con `pageAccessToken`/`appSecret`/`pageId`/`igBusinessId`.
  - Vincular IG profesional ↔ página FB.

- [ ] **Step 4: Smoke (tras migración + config Meta)**: DM de prueba a la cuenta IG → entra a `/inbox` como conversación nueva con lead creado; responder desde el inbox → verificar entrega. (Lo valida Luis con permisos vivos.)

---

## Self-Review (cobertura del spec)

- §2 Arquitectura (core + adapters + dispatcher) → Tasks 4,5,7,8,9. ✓
- §3 Datos (enums, columnas, externalPhone nullable, incomingLeadSchema) → Tasks 1,2,3. ✓
- §4 Inbound (webhook, match, captureLead, conversación, mensaje dedup, activity, SLA, bot) → Tasks 5,10. ✓
- §5 Outbound (dispatcher, ventana 24h vía error de Graph) → Task 9. ✓
- §6 Bot por canal → Task 12. ✓
- §7 Inbox UI (badge/filtro canal) → Task 13. ✓
- §8 Admin conector → Task 14. ✓
- §10 Testing → tests por task. ✓
- §11 Pendientes de Luis → Task 15. ✓

**Decisiones de implementación notables (documentadas inline):** (a) el opt-out por keyword de WhatsApp queda como guard previo al core (Task 6); (b) `aiGenerated` puede no marcarse en envíos sociales del bot en v1 (Task 12), follow-up con `opts.bot` en el dispatcher; (c) `igBusinessId`/`verifyToken` pueden vivir en `config` del conector si simplifica la UI (Task 14).
