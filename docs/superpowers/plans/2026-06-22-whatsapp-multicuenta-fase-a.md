# WhatsApp multicuenta — Fase A (fundación backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el CRM reciba y envíe WhatsApp de **dos números de negocio** (Nativa + Propyte), atribuyendo cada hilo a su cuenta y respondiendo desde el número correcto — sin tocar la UI todavía (Fase B) ni el bot por marca (Fase C).

**Architecture:** Cada número = un `LeadConnector` (`provider: WHATSAPP`) con `phoneNumberId`/`wabaId`/`brand` en `config` (consultable) y `accessToken`/`verifyToken`/`appSecret` en `credentials` cifradas (AES-256-GCM, como IG/Messenger). El inbound se rutea por `metadata.phone_number_id`; el outbound usa las credenciales del connector de la conversación. `Conversation += connectorId` y la unicidad pasa a `[contactId, channel, connectorId]`. Un helper `ensureConversation` reemplaza los `upsert` (Prisma no soporta upsert con clave compuesta nullable).

**Tech Stack:** Next.js 14, TypeScript 5.7, Prisma 6 (PostgreSQL/Supabase, schema `propyte_crm`), Zod 3.24, Vitest 2.

---

## Convenciones de este plan
- **Rama:** `feat/whatsapp-multicuenta` (ya creada, tiene el spec). Antes de cada commit: `git branch --show-current` = esa rama; si no, `git checkout feat/whatsapp-multicuenta` (NO main). Tree compartido con sesión paralela.
- **Autoría git** ya configurada (`Propyte-Luis` / `webkoi@webkoi-ai.com`). Cada commit termina con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **NO PowerShell** (regla deny). Usar Bash tool con bash.
- **Tests:** Vitest. Un archivo: `npx vitest run <ruta>`. Suite: `npm test`. `@/` → `src/`.
- **TDD:** test rojo → mínimo verde → commit. `npm run build` verde antes del commit final de tasks que toquen rutas/schema.
- **Migración (Task 1/Task 2):** el SQL NO se aplica a la BD compartida sin OK explícito de Luis. Se prepara el código + el SQL; se aplica en el gate (Task 7).

---

## File Structure
- **Modify** `prisma/schema.prisma` — `ConnectorProvider += WHATSAPP`; `Conversation += connectorId` + relación + cambio de unicidad.
- **Create** `prisma/migrations-manual/2026-06-22-whatsapp-multicuenta.sql` — enum value + columna + drop/new unique + índice parcial.
- **Modify** `src/lib/validations/rebuild-f1.ts` — `connectorCredentialsWhatsAppSchema`.
- **Create** `src/lib/whatsapp/accounts.ts` — resolución de connector por `phoneNumberId` + extracción de credenciales. Responsabilidad única: mapear (phoneNumberId | connector) → credenciales.
- **Create** `src/lib/messaging/conversations.ts` — `ensureConversation` (find-or-create por `[contactId, channel, connectorId]`).
- **Modify** `src/lib/messaging/core.ts`, `src/lib/messaging/dispatcher.ts`, `src/lib/twilio/whatsapp.ts`, `src/lib/messaging/types.ts` — threading de `connectorId`.
- **Modify** `src/lib/whatsapp/transport.ts` — credenciales por parámetro con fallback a env.
- **Modify** `src/app/api/webhooks/whatsapp/meta/route.ts` — ruteo por `phone_number_id` + verify/firma por connector con fallback.
- **Modify** `src/app/api/conversations/[id]/messages/route.ts` — pasar `conv.connectorId` al envío.
- **Create** `scripts/seed-whatsapp-default-connector.ts` — connector "default" desde env + backfill de hilos existentes.
- **Tests** co-locados `*.test.ts`.

---

## Task 1: Schema — enum WHATSAPP + Conversation.connectorId + unicidad (código + SQL, sin aplicar)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations-manual/2026-06-22-whatsapp-multicuenta.sql`

- [ ] **Step 1: Editar `prisma/schema.prisma` — agregar `WHATSAPP` al enum.**

En `enum ConnectorProvider` (tiene META, INSTAGRAM, MESSENGER, TIKTOK, WEBSITE, ZAPIER, MANUAL, GOOGLE, LINKEDIN, INMUEBLES24, LAMUDI_PROPPIT, PROPIEDADES, VIVANUNCIOS, EASYBROKER, GOOGLE_ADS, YOUTUBE, PINTEREST, CUSTOM) agregar `WHATSAPP` antes del `@@schema`:
```prisma
  CUSTOM
  WHATSAPP

  @@schema("propyte_crm")
```

- [ ] **Step 2: Editar `Conversation` — agregar `connectorId` + relación y cambiar la unicidad.**

En `model Conversation`:
- Agregar el campo y la relación (después de `controlledBy`):
```prisma
  connectorId    String?
  connector      LeadConnector?      @relation(fields: [connectorId], references: [id])
```
- Cambiar `@@unique([contactId, channel])` por:
```prisma
  @@unique([contactId, channel, connectorId])
```
En `model LeadConnector`, agregar el reverso de la relación (junto a `leadLogs ConnectorLeadLog[]`):
```prisma
  conversations Conversation[]
```

- [ ] **Step 3: Crear la migración manual SQL.**

Create `prisma/migrations-manual/2026-06-22-whatsapp-multicuenta.sql`:
```sql
-- WhatsApp multicuenta (Fase A). Aditivo + reescritura de la unicidad de Conversation.
-- 1) Nuevo valor de enum (ADD VALUE fuera de transacción).
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'WHATSAPP';

-- 2) Columna connectorId (nullable) + FK.
ALTER TABLE "propyte_crm"."conversations"
  ADD COLUMN IF NOT EXISTS "connectorId" TEXT;
ALTER TABLE "propyte_crm"."conversations"
  ADD CONSTRAINT "conversations_connectorId_fkey"
  FOREIGN KEY ("connectorId") REFERENCES "propyte_crm"."lead_connectors"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Reemplazar la unicidad: de (contactId, channel) a (contactId, channel, connectorId).
DROP INDEX IF EXISTS "propyte_crm"."conversations_contactId_channel_key";
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_contactId_channel_connectorId_key"
  ON "propyte_crm"."conversations" ("contactId", "channel", "connectorId");

-- 4) Índice único parcial para hilos sin connector (WEB/SMS/legacy): 1 por (contacto, canal).
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_contactId_channel_nullconn_key"
  ON "propyte_crm"."conversations" ("contactId", "channel")
  WHERE "connectorId" IS NULL;
```
(El nombre real del índice viejo puede variar; verificar con `\d conversations` o `list_tables` antes de aplicar. El backfill de los hilos WhatsApp existentes va en el seed de Task 2, tras crear el connector default.)

- [ ] **Step 4: Validar el schema OFFLINE (NO tocar BD, NO `prisma generate`).**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 5: Commit**
```bash
git branch --show-current
git add prisma/schema.prisma prisma/migrations-manual/2026-06-22-whatsapp-multicuenta.sql
git commit -m "feat(db): WhatsApp multicuenta — ConnectorProvider.WHATSAPP + Conversation.connectorId

Unicidad pasa a (contactId, channel, connectorId) + índice parcial para
hilos sin connector. Migración additiva; se aplica con OK de Luis.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Resolución de cuenta WhatsApp + credenciales (sin BD)

**Files:**
- Modify: `src/lib/validations/rebuild-f1.ts`
- Create: `src/lib/whatsapp/accounts.ts`
- Test: `src/lib/whatsapp/accounts.test.ts`

> Diseño: `phoneNumberId`/`wabaId`/`brand` viven en `LeadConnector.config` (JSON, consultable por Prisma — NO es secreto). `accessToken`/`verifyToken`/`appSecret` viven en `credentials` cifradas. Así se puede rutear el inbound por `config.phoneNumberId`.

- [ ] **Step 1: Agregar el zod de credenciales WhatsApp en `rebuild-f1.ts`** (junto a `connectorCredentialsMetaSchema`):
```ts
export const connectorCredentialsWhatsAppSchema = z.object({
  accessToken: z.string().min(1),
  verifyToken: z.string().min(1),
  appSecret: z.string().min(1),
});
```

- [ ] **Step 2: Escribir el test (rojo).** Create `src/lib/whatsapp/accounts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getWhatsAppCredentials } from "./accounts";

const fakeConnector = (config: any, creds: any) => ({
  id: "c1", provider: "WHATSAPP", config,
  // credentials cifradas se descifran vía readCredentials; el test inyecta el connector ya descifrado:
  __decrypted: creds,
} as any);

describe("getWhatsAppCredentials", () => {
  it("combina phoneNumberId (config) + secretos (credentials)", () => {
    const conn = fakeConnector(
      { phoneNumberId: "111", brand: "Nativa" },
      { accessToken: "tok", verifyToken: "vt", appSecret: "sec" },
    );
    const creds = getWhatsAppCredentials(conn, () => conn.__decrypted);
    expect(creds).toEqual({ phoneNumberId: "111", accessToken: "tok", verifyToken: "vt", appSecret: "sec", brand: "Nativa" });
  });
  it("retorna null si falta phoneNumberId o accessToken", () => {
    expect(getWhatsAppCredentials(fakeConnector({}, { accessToken: "t" }), (c) => (c as any).__decrypted)).toBeNull();
    expect(getWhatsAppCredentials(fakeConnector({ phoneNumberId: "1" }, {}), (c) => (c as any).__decrypted)).toBeNull();
  });
});
```

- [ ] **Step 3: Correr → FALLA** (`accounts.ts` no existe): `npx vitest run src/lib/whatsapp/accounts.test.ts`

- [ ] **Step 4: Implementar `src/lib/whatsapp/accounts.ts`.**
```ts
// Resolución de cuenta WhatsApp: connector ↔ credenciales. config (consultable) +
// credentials (cifradas). Responsabilidad única, sin side-effects.
import prisma from "@/lib/db";
import type { LeadConnector } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  verifyToken?: string;
  appSecret?: string;
  brand?: string;
}

type Secrets = { accessToken?: string; verifyToken?: string; appSecret?: string };

/** Combina config (phoneNumberId/brand) + secretos descifrados. `decrypt` inyectable para test. */
export function getWhatsAppCredentials(
  connector: LeadConnector,
  decrypt: (c: LeadConnector) => Secrets | null = (c) => readCredentials<Secrets>(c),
): WhatsAppCredentials | null {
  const config = (connector.config ?? {}) as { phoneNumberId?: string; brand?: string };
  const secrets = decrypt(connector) ?? {};
  if (!config.phoneNumberId || !secrets.accessToken) return null;
  return {
    phoneNumberId: config.phoneNumberId,
    accessToken: secrets.accessToken,
    verifyToken: secrets.verifyToken,
    appSecret: secrets.appSecret,
    brand: config.brand,
  };
}

/** Connector WhatsApp activo cuyo config.phoneNumberId == el recibido en el webhook. */
export async function resolveConnectorByPhoneNumberId(phoneNumberId: string): Promise<LeadConnector | null> {
  return prisma.leadConnector.findFirst({
    where: { provider: "WHATSAPP", status: "ACTIVE", deletedAt: null, config: { path: ["phoneNumberId"], equals: phoneNumberId } },
  });
}

/** Todos los connectors WhatsApp activos (para verify GET que no trae phone_number_id). */
export async function activeWhatsAppConnectors(): Promise<LeadConnector[]> {
  return prisma.leadConnector.findMany({ where: { provider: "WHATSAPP", status: "ACTIVE", deletedAt: null } });
}
```

- [ ] **Step 5: Correr → PASA:** `npx vitest run src/lib/whatsapp/accounts.test.ts`

- [ ] **Step 6: Crear el seed del connector default + backfill** (se ejecuta en el gate, Task 7). Create `scripts/seed-whatsapp-default-connector.ts`:
```ts
// Crea el LeadConnector "default" de WhatsApp desde los env vars actuales y backfillea
// los hilos WhatsApp existentes a ese connector. Idempotente.
import prisma from "@/lib/db";
import { writeCredentials } from "@/lib/intake/connectors";

async function main() {
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.META_WA_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) throw new Error("Faltan META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN");

  const existing = await prisma.leadConnector.findFirst({
    where: { provider: "WHATSAPP", config: { path: ["phoneNumberId"], equals: phoneNumberId } },
  });
  const connector = existing ?? await prisma.leadConnector.create({
    data: {
      name: "WhatsApp Propyte (default)",
      provider: "WHATSAPP",
      direction: "BOTH",
      status: "ACTIVE",
      config: { phoneNumberId, brand: "Propyte" },
      credentials: writeCredentials({
        accessToken,
        verifyToken: process.env.META_WA_VERIFY_TOKEN?.trim() ?? "",
        appSecret: process.env.META_WA_APP_SECRET?.trim() ?? "",
      }),
    },
  });

  const backfilled = await prisma.conversation.updateMany({
    where: { channel: "WHATSAPP", connectorId: null },
    data: { connectorId: connector.id },
  });
  console.log(`Connector default ${connector.id}; hilos backfilleados: ${backfilled.count}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 7: Build + commit** (`npm run build` valida tipos; el script no corre aún):
```bash
git branch --show-current
git add src/lib/validations/rebuild-f1.ts src/lib/whatsapp/accounts.ts src/lib/whatsapp/accounts.test.ts scripts/seed-whatsapp-default-connector.ts
git commit -m "feat(whatsapp): resolución de cuenta por phoneNumberId + seed connector default

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `ensureConversation` (find-or-create por connector) + refactor de los 3 upserts

**Files:**
- Create: `src/lib/messaging/conversations.ts`
- Test: `src/lib/messaging/conversations.test.ts`
- Modify: `src/lib/messaging/core.ts`, `src/lib/messaging/dispatcher.ts`, `src/lib/twilio/whatsapp.ts`

> Prisma no soporta `upsert` con clave compuesta que incluya un campo nullable. Se reemplaza por find-or-create con retry P2002.

- [ ] **Step 1: Test (rojo) de la lógica pura de selección de clave.** Create `src/lib/messaging/conversations.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sameConversationKey } from "./conversations";

describe("sameConversationKey", () => {
  it("igual contacto+canal pero distinto connector → claves distintas", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
      { contactId: "a", channel: "WHATSAPP", connectorId: "n2" },
    )).toBe(false);
  });
  it("mismo contacto+canal+connector → misma clave", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
    )).toBe(true);
  });
  it("connector null en ambos → misma clave", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WEB", connectorId: null },
      { contactId: "a", channel: "WEB", connectorId: null },
    )).toBe(true);
  });
});
```

- [ ] **Step 2: Correr → FALLA:** `npx vitest run src/lib/messaging/conversations.test.ts`

- [ ] **Step 3: Implementar `src/lib/messaging/conversations.ts`.**
```ts
import prisma from "@/lib/db";
import type { Conversation, ConversationChannel } from "@prisma/client";

export interface ConvKey { contactId: string; channel: ConversationChannel; connectorId: string | null }

export function sameConversationKey(a: ConvKey, b: ConvKey): boolean {
  return a.contactId === b.contactId && a.channel === b.channel && (a.connectorId ?? null) === (b.connectorId ?? null);
}

/** Devuelve la conversación del (contacto, canal, connector); la crea si no existe. Maneja carrera P2002. */
export async function ensureConversation(key: ConvKey): Promise<Conversation> {
  const connectorId = key.connectorId ?? null;
  const where = { contactId: key.contactId, channel: key.channel, connectorId };
  const found = await prisma.conversation.findFirst({ where });
  if (found) return found;
  try {
    return await prisma.conversation.create({
      data: { contactId: key.contactId, channel: key.channel, connectorId, status: "BOT", lastMessageAt: new Date() },
    });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      const retry = await prisma.conversation.findFirst({ where });
      if (retry) return retry;
    }
    throw err;
  }
}
```

- [ ] **Step 4: Correr → PASA:** `npx vitest run src/lib/messaging/conversations.test.ts`

- [ ] **Step 5: Refactor `src/lib/messaging/core.ts` (inbound).**
Reemplazar el bloque `const conversation = await prisma.conversation.upsert({ where: { contactId_channel: ... }, ... })` (líneas ~67-78) por:
```ts
  const { ensureConversation } = await import("./conversations");
  const conv = await ensureConversation({ contactId: contact.id, channel: msg.channel, connectorId: msg.connectorId ?? null });
  const conversation = await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastInboundAt: new Date(), unreadCount: { increment: 1 } },
  });
```
(`msg.connectorId` se agrega al tipo en Task 4. Para IG/Messenger seguirá siendo el connectorId que ya resuelve el flujo; si llega `undefined`, se trata como null — el comportamiento previo se preserva para esos canales en esta fase porque su connectorId será null aquí.)

- [ ] **Step 6: Refactor `src/lib/messaging/dispatcher.ts` (IG/Messenger outbound).**
Reemplazar el `prisma.conversation.upsert({ where: { contactId_channel: { contactId, channel } }, ... })` (líneas ~54-58) por:
```ts
  const { ensureConversation } = await import("./conversations");
  const conv0 = await ensureConversation({ contactId, channel, connectorId: connector.id });
  const conversation = await prisma.conversation.update({ where: { id: conv0.id }, data: { lastMessageAt: new Date() } });
```
(IG/Messenger ya tienen `connector` en scope — ahora su conversación queda atada a ese connector, consistente con el nuevo modelo.)

- [ ] **Step 7: Refactor `src/lib/twilio/whatsapp.ts` (outbound).**
En `sendWhatsAppMessage`, reemplazar el `prisma.conversation.upsert(...)` (líneas ~22-26) por find-or-create con el `connectorId` recibido (parámetro nuevo). Cambiar la firma a:
```ts
export async function sendWhatsAppMessage(to: string, body: string, contactId: string, userId: string, connectorId?: string | null) {
```
y el bloque de la conversación:
```ts
  const { ensureConversation } = await import("@/lib/messaging/conversations");
  const conv0 = await ensureConversation({ contactId, channel: "WHATSAPP", connectorId: connectorId ?? null });
  const conversation = await prisma.conversation.update({ where: { id: conv0.id }, data: { lastMessageAt: new Date() } });
```
(El uso real de `connectorId` para elegir credenciales de envío llega en Task 5; aquí solo se ata el hilo a la cuenta.)

- [ ] **Step 8: Build + tests + commit.**
Run: `npm run build` → verde. Run: `npx vitest run src/lib/messaging/conversations.test.ts` → PASS.
```bash
git branch --show-current
git add src/lib/messaging/conversations.ts src/lib/messaging/conversations.test.ts src/lib/messaging/core.ts src/lib/messaging/dispatcher.ts src/lib/twilio/whatsapp.ts
git commit -m "refactor(messaging): ensureConversation por (contacto,canal,connector)

Reemplaza upsert (Prisma no soporta clave compuesta nullable). Hilos
separados por cuenta WhatsApp; IG/Messenger atados a su connector.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Threading inbound — webhook rutea por `phone_number_id`

**Files:**
- Modify: `src/lib/messaging/types.ts`, `src/lib/twilio/whatsapp.ts`, `src/app/api/webhooks/whatsapp/meta/route.ts`
- Test: `src/app/api/webhooks/whatsapp/meta/route.test.ts` (crear)

- [ ] **Step 1: `IncomingMessage += connectorId`.** En `src/lib/messaging/types.ts`, agregar al interface `IncomingMessage`:
```ts
  /** Cuenta (LeadConnector) que recibió el mensaje; null para canales sin cuenta. */
  connectorId?: string | null;
```

- [ ] **Step 2: `handleInboundWhatsApp` acepta y propaga `connectorId`.** En `src/lib/twilio/whatsapp.ts`, cambiar la firma y el objeto pasado a `handleInboundMessage`:
```ts
export async function handleInboundWhatsApp(payload: {
  From: string; Body: string; MessageSid: string; NumMedia?: string; MediaUrl0?: string; ProfileName?: string;
  connectorId?: string | null;
}) {
```
y en la llamada a `handleInboundMessage({...})` agregar `connectorId: payload.connectorId ?? null,`.

- [ ] **Step 3: Test (rojo) del ruteo por phone_number_id.** Create `src/app/api/webhooks/whatsapp/meta/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const handleInbound = vi.fn();
vi.mock("@/lib/twilio/whatsapp", () => ({ handleInboundWhatsApp: (...a: any[]) => handleInbound(...a) }));
const resolveByPhone = vi.fn();
vi.mock("@/lib/whatsapp/accounts", () => ({
  resolveConnectorByPhoneNumberId: (...a: any[]) => resolveByPhone(...a),
  activeWhatsAppConnectors: vi.fn(async () => []),
  getWhatsAppCredentials: vi.fn(() => null),
}));
vi.mock("@/lib/db", () => ({ default: { message: { updateMany: vi.fn(async () => ({})) } } }));

import { POST } from "./route";

function reqWith(body: any) {
  return new Request("https://x/api/webhooks/whatsapp/meta", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => { handleInbound.mockReset(); resolveByPhone.mockReset(); process.env.META_WA_APP_SECRET = ""; });

describe("webhook WhatsApp rutea por phone_number_id", () => {
  it("resuelve el connector y lo pasa al inbound", async () => {
    resolveByPhone.mockResolvedValue({ id: "conn-nativa" });
    const body = { entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "PN_NATIVA" },
      contacts: [{ profile: { name: "Ana" }, wa_id: "5219990000000" }],
      messages: [{ id: "wamid.1", from: "5219990000000", type: "text", text: { body: "hola" } }],
    } }] }] };
    const res = await POST(reqWith(body));
    expect(res.status).toBe(200);
    expect(resolveByPhone).toHaveBeenCalledWith("PN_NATIVA");
    expect(handleInbound).toHaveBeenCalledWith(expect.objectContaining({ connectorId: "conn-nativa" }));
  });

  it("phone_number_id sin connector → no llama inbound (no crea hilo huérfano)", async () => {
    resolveByPhone.mockResolvedValue(null);
    const body = { entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "PN_DESCONOCIDO" },
      messages: [{ id: "wamid.2", from: "521999", type: "text", text: { body: "x" } }],
    } }] }] };
    const res = await POST(reqWith(body));
    expect(res.status).toBe(200);
    expect(handleInbound).not.toHaveBeenCalled();
  });
});
```
(El `validSignature` retorna `true` cuando `META_WA_APP_SECRET` está vacío — por eso el test lo limpia.)

- [ ] **Step 4: Correr → FALLA:** `npx vitest run src/app/api/webhooks/whatsapp/meta/route.test.ts`

- [ ] **Step 5: Implementar el ruteo en `route.ts`.**
- Extender el tipo del payload para incluir `metadata`:
```ts
        value?: {
          metadata?: { phone_number_id?: string; display_phone_number?: string };
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: MetaMessage[];
          statuses?: MetaStatus[];
        };
```
- Dentro del loop `for (const change of ...)`, antes de procesar `messages`, resolver el connector:
```ts
      const phoneNumberId = value.metadata?.phone_number_id;
      const { resolveConnectorByPhoneNumberId } = await import("@/lib/whatsapp/accounts");
      const connector = phoneNumberId ? await resolveConnectorByPhoneNumberId(phoneNumberId) : null;
      if (phoneNumberId && !connector) {
        console.warn(`[whatsapp-meta] phone_number_id sin connector activo: ${phoneNumberId} — mensajes descartados`);
      }
```
- En el loop de `messages`, saltar cuando hay `phoneNumberId` pero no connector, y propagar `connectorId`:
```ts
      for (const msg of value.messages ?? []) {
        if (phoneNumberId && !connector) continue; // no crear hilo huérfano
        try {
          await handleInboundWhatsApp({
            From: `whatsapp:+${msg.from}`, Body: extractBody(msg), MessageSid: msg.id,
            ProfileName: profileName, connectorId: connector?.id ?? null,
          });
          processed++;
        } catch (err) { console.error("[whatsapp-meta] inbound:", err); }
      }
```
(Cuando NO viene `phone_number_id` —p. ej. payloads de Twilio o legacy— `connector` es null pero `phoneNumberId` también, así que NO se salta: cae al connector default vía null → el seed de Task 2 ya backfilleó esos hilos; el envío usará fallback env. Mantiene compatibilidad.)

- [ ] **Step 6: Verify token per-connector en el GET (multi-app) con fallback al env.**
Reemplazar el cuerpo del `GET` para aceptar el token del env **o** el de cualquier connector WhatsApp activo:
```ts
  if (mode === "subscribe" && challenge) {
    const envToken = process.env.META_WA_VERIFY_TOKEN?.trim();
    if (envToken && token === envToken) return new NextResponse(challenge, { status: 200 });
    const { activeWhatsAppConnectors, getWhatsAppCredentials } = await import("@/lib/whatsapp/accounts");
    const conns = await activeWhatsAppConnectors();
    const match = conns.some((c) => { const wa = getWhatsAppCredentials(c); return !!wa?.verifyToken && wa.verifyToken === token; });
    if (match) return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verify_token inválido" }, { status: 403 });
```
(Firma POST: se mantiene la validación con `META_WA_APP_SECRET` app-level por ahora — los 2 números bajo la misma app comparten secreto. Soporte per-connector de firma queda anotado como mejora si llegaran a vivir en apps distintas; no se necesita para el caso de Luis.)

- [ ] **Step 7: Correr tests + build + commit.**
Run: `npx vitest run src/app/api/webhooks/whatsapp/meta/route.test.ts` → PASS. `npm run build` → verde.
```bash
git branch --show-current
git add src/lib/messaging/types.ts src/lib/twilio/whatsapp.ts src/app/api/webhooks/whatsapp/meta/route.ts src/app/api/webhooks/whatsapp/meta/route.test.ts
git commit -m "feat(whatsapp): webhook rutea inbound por phone_number_id al connector

Verify GET acepta token del env o de cualquier connector activo. phone_number_id
sin connector → descarta (no crea hilo huérfano).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Threading outbound — responder desde el número correcto

**Files:**
- Modify: `src/lib/whatsapp/transport.ts`, `src/lib/twilio/whatsapp.ts`, `src/lib/messaging/dispatcher.ts`, `src/app/api/conversations/[id]/messages/route.ts`
- Test: `src/lib/whatsapp/transport.test.ts` (crear)

- [ ] **Step 1: Test (rojo) del transporte con credenciales por parámetro.** Create `src/lib/whatsapp/transport.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deliverWhatsApp } from "./transport";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.WHATSAPP_PROVIDER = "meta_cloud";
  process.env.META_WA_PHONE_NUMBER_ID = "ENV_PN";
  process.env.META_WA_ACCESS_TOKEN = "ENV_TOK";
});

describe("deliverWhatsApp con credenciales por cuenta", () => {
  it("usa el phoneNumberId/token del connector cuando se pasan", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.x" }] }) });
    await deliverWhatsApp("+5219990000000", "hola", { phoneNumberId: "PN_NATIVA", accessToken: "TOK_NATIVA" });
    const url = fetchMock.mock.calls[0][0] as string;
    const headers = (fetchMock.mock.calls[0][1] as any).headers;
    expect(url).toContain("/PN_NATIVA/messages");
    expect(headers.Authorization).toBe("Bearer TOK_NATIVA");
  });
  it("cae a env cuando no se pasan credenciales", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.y" }] }) });
    await deliverWhatsApp("+5219990000000", "hola");
    expect(fetchMock.mock.calls[0][0]).toContain("/ENV_PN/messages");
  });
});
```

- [ ] **Step 2: Correr → FALLA:** `npx vitest run src/lib/whatsapp/transport.test.ts`

- [ ] **Step 3: Refactor `transport.ts` para aceptar credenciales.**
- `deliverViaMetaCloud(toE164, body, creds?)`:
```ts
async function deliverViaMetaCloud(
  toE164: string, body: string, creds?: { phoneNumberId: string; accessToken: string },
): Promise<DeliveryResult> {
  const phoneNumberId = creds?.phoneNumberId ?? process.env.META_WA_PHONE_NUMBER_ID?.trim();
  const token = creds?.accessToken ?? process.env.META_WA_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !token) throw new Error("META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN no configurados");
  // ...resto igual (usa phoneNumberId y token)...
}
```
- `deliverMetaTemplate(toE164, templateName, language, bodyParams = [], creds?)`: mismo patrón de fallback al inicio.
- `deliverWhatsApp(toE164, body, creds?)`:
```ts
export async function deliverWhatsApp(
  toE164: string, body: string, creds?: { phoneNumberId: string; accessToken: string },
): Promise<DeliveryResult> {
  return activeProvider() === "meta_cloud" ? deliverViaMetaCloud(toE164, body, creds) : deliverViaTwilio(toE164, body);
}
```

- [ ] **Step 4: Correr → PASA:** `npx vitest run src/lib/whatsapp/transport.test.ts`

- [ ] **Step 5: `sendWhatsAppMessage` resuelve credenciales del connector y las pasa al transporte.**
En `src/lib/twilio/whatsapp.ts` `sendWhatsAppMessage` (la firma ya tiene `connectorId?` desde Task 3), reemplazar la llamada `const delivery = await deliverWhatsApp(normalized, body);` por:
```ts
  let creds: { phoneNumberId: string; accessToken: string } | undefined;
  if (connectorId) {
    const c = await prisma.leadConnector.findUnique({ where: { id: connectorId } });
    if (c) {
      const { getWhatsAppCredentials } = await import("@/lib/whatsapp/accounts");
      const wa = getWhatsAppCredentials(c);
      if (wa) creds = { phoneNumberId: wa.phoneNumberId, accessToken: wa.accessToken };
    }
  }
  const { deliverWhatsApp } = await import("@/lib/whatsapp/transport");
  const delivery = await deliverWhatsApp(normalized, body, creds);
```

- [ ] **Step 6: `sendChannelMessage` propaga `connectorId`.**
En `src/lib/messaging/dispatcher.ts`, cambiar la firma de `sendChannelMessage` para aceptar `connectorId` en `opts` y pasarlo a `sendWhatsAppMessage`:
```ts
export async function sendChannelMessage(
  channel: MessagingChannel, contactId: string, body: string, userId: string,
  opts: { bot?: boolean; connectorId?: string | null } = {},
) {
  if (channel === "WHATSAPP") {
    const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true } });
    if (!c?.phone) throw new Error("Contacto sin teléfono");
    const { sendWhatsAppMessage } = await import("@/lib/twilio/whatsapp");
    const message = await sendWhatsAppMessage(c.phone, body, contactId, userId, opts.connectorId ?? null);
    // ...resto igual (bloque opts.bot)...
```

- [ ] **Step 7: La ruta de respuesta pasa el connector del hilo.**
Leer `src/app/api/conversations/[id]/messages/route.ts`. Donde carga la conversación, incluir `connectorId` (si usa `select`, agregarlo; si carga el objeto completo, ya viene). En la llamada existente a `sendChannelMessage(conv.channel, contactId, body, userId, { ... })`, agregar `connectorId: conv.connectorId`. Si el bot envía por la misma ruta/otro helper, propagar igual `connectorId`.

- [ ] **Step 8: Build + tests + commit.**
Run: `npm run build` → verde. Run: `npx vitest run src/lib/whatsapp/transport.test.ts` → PASS.
```bash
git branch --show-current
git add src/lib/whatsapp/transport.ts src/lib/whatsapp/transport.test.ts src/lib/twilio/whatsapp.ts src/lib/messaging/dispatcher.ts "src/app/api/conversations/[id]/messages/route.ts"
git commit -m "feat(whatsapp): outbound responde desde el número del connector del hilo

deliverWhatsApp acepta credenciales por cuenta (fallback a env). El reply
del inbox usa conversation.connectorId.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Verificación de la suite + build

**Files:** ninguno (verificación).

- [ ] **Step 1: Suite completa verde.** Run: `npm test` → todos PASS (incl. los nuevos: accounts, conversations, webhook route, transport).
- [ ] **Step 2: Build verde.** Run: `npm run build` → sin errores de tipo.
- [ ] **Step 3: Revisar que no queden referencias al upsert viejo** `contactId_channel` en `core.ts`/`dispatcher.ts`/`twilio/whatsapp.ts` (deben usar `ensureConversation`). Buscar con Grep `contactId_channel`. Si queda alguno fuera de un path connector-aware, corregir.

---

## Task 7: [GATE — requiere OK explícito de Luis] aplicar migración + seed + alta del 2º número

Solo tras "aplica la migración WhatsApp" (o equivalente).

- [ ] **Step 1: Aplicar la migración** a `oaijxdpevakashxshhvm` (MCP Supabase `apply_migration`/`execute_sql` o SQL Editor) con el contenido de `prisma/migrations-manual/2026-06-22-whatsapp-multicuenta.sql`. **Antes:** verificar el nombre real del índice único viejo de `conversations` (`list_tables` / `\d`) y ajustar el `DROP INDEX` si difiere.
- [ ] **Step 2: Regenerar cliente:** `npx prisma generate`. Verificar `ConnectorProvider` incluye `WHATSAPP` y `Conversation.connectorId` existe.
- [ ] **Step 3: Seed del connector default + backfill:** `npx tsx scripts/seed-whatsapp-default-connector.ts`. Verificar en BD: existe 1 LeadConnector WHATSAPP ACTIVE y los hilos WhatsApp tienen `connectorId`.
- [ ] **Step 4: Alta del 2º número (Nativa)** — tras el Coexistence onboarding de Luis (que entrega `phoneNumberId` + token): crear el 2º `LeadConnector` (provider WHATSAPP, `config.phoneNumberId` + `config.brand="Nativa"`, credentials cifradas). En Fase A puede ser vía un script/seed equivalente; el alta por UI llega en Fase B.
- [ ] **Step 5: Merge ff a main** (deploy Hostinger) — autorizado para esta línea de trabajo; verificar autoría Propyte-Luis antes del push.
```bash
git checkout main && git pull --ff-only && git merge --ff-only feat/whatsapp-multicuenta && git push origin main
```
- [ ] **Step 6: Verificación real** (no con la test tool de Meta, que manda dummies): un mensaje real a cada número crea hilos separados con el `connectorId` correcto; responder desde el inbox sale por el número correcto.

---

## Self-Review (cobertura del spec)
- §4 connector por-cuenta (config phoneNumberId + creds cifradas) → Task 1/2 ✓
- §4 inbound por phone_number_id → Task 4 ✓
- §4 outbound por-cuenta (fallback env) → Task 5 ✓
- §4 bot por cuenta → **Fase C** (fuera de Fase A) ✓
- §5 Conversation.connectorId + unicidad + índice parcial + backfill → Task 1 (DDL) + Task 2 (backfill) ✓
- §5 actualizar upserts (core/dispatcher/whatsapp) → Task 3 ✓
- §8 manejo de errores (phone_number_id sin connector → log+descartar; outbound fallback) → Task 4/5 ✓
- §9 pruebas (unit ruteo/creds/conversación separada/outbound) → Tasks 2-5 ✓; Playwright/E2E real → Task 7 (gate)
- §12 proceso (TDD, autoría, ff a main, migración gateada) → convenciones + Task 7 ✓

Consistencia de tipos: `connectorId?: string | null` en `IncomingMessage`, `sendWhatsAppMessage(...connectorId?)`, `sendChannelMessage(...opts.connectorId)`, `ensureConversation({contactId, channel, connectorId})`, `getWhatsAppCredentials`/`resolveConnectorByPhoneNumberId` usados consistentemente. Verify GET usa `getWhatsAppCredentials(c).verifyToken`. Outbound `deliverWhatsApp(to, body, creds?)`.

**Nota:** Fase A deja la UI sin cambios (el inbox aún no muestra badge por cuenta — Fase B). Funcionalmente los 2 números ya entran y salen por su cuenta correcta; la distinción visual y el alta por UI son Fase B.
