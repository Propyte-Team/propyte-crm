# IG DM + Messenger Multicuenta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrutar cada DM de Instagram / mensaje de Messenger a su conector correcto (por cuenta) y responder con el token de esa misma cuenta, eliminando el cruce de tokens que hoy causa `findFirst`.

**Architecture:** Se replica el patrón multicuenta de WhatsApp (`src/lib/whatsapp/accounts.ts`) para social: identificadores no-secretos (`pageId`, `igBusinessId`) en `LeadConnector.config` (consultable por JSONB path), secretos (`pageAccessToken`, `appSecret`, `verifyToken`) en `credentials` (cifrado). La recepción captura `entry.id`, resuelve el conector y guarda `connectorId` en la conversación (columna de la migración `2026-06-22`); el envío resuelve el conector desde `opts.connectorId`/la conversación en vez de `findFirst`.

**Tech Stack:** Next.js 14 (App Router), Prisma, Vitest, Meta Graph API v24 (Messenger API for Instagram, Page-based). Rama base: `feat/whatsapp-multicuenta`.

**Spec:** `docs/superpowers/specs/2026-07-10-ig-messenger-multicuenta-design.md`

**Comandos base:**
- Test 1 archivo: `npx vitest run <ruta>`
- Todos los tests: `npm test`
- Build: `npm run build`
- Regenerar cliente Prisma: `npx prisma generate`

**Precondición de rama:** trabajar sobre `feat/whatsapp-multicuenta` (ya rebaseada sobre `origin/main`). Confirmar con `git branch --show-current` y `npx prisma generate` (el schema de esta rama tiene `Conversation.connectorId` y `ConnectorProvider.WHATSAPP`).

---

## Task 1: Capturar la cuenta receptora (`entry.id`) en los parsers sociales

**Files:**
- Modify: `src/lib/messaging/types.ts`
- Modify: `src/lib/messaging/adapters/instagram.ts`
- Modify: `src/lib/messaging/adapters/messenger.ts`
- Test: `src/lib/messaging/adapters/instagram.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/messaging/adapters/instagram.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseInstagramWebhook } from "./instagram";
import { parseMessengerWebhook } from "./messenger";

describe("parseInstagramWebhook", () => {
  it("captura accountId desde entry.id (cuenta IG receptora)", () => {
    const out = parseInstagramWebhook({
      object: "instagram",
      entry: [{ id: "17841453458089530", messaging: [
        { sender: { id: "IGSID_123" }, message: { mid: "m_1", text: "hola" } },
      ] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].accountId).toBe("17841453458089530");
    expect(out[0].channel).toBe("INSTAGRAM");
    expect(out[0].senderId).toBe("IGSID_123");
  });
});

describe("parseMessengerWebhook", () => {
  it("captura accountId desde entry.id (Page ID)", () => {
    const out = parseMessengerWebhook({
      object: "page",
      entry: [{ id: "103981554499114", messaging: [
        { sender: { id: "PSID_9" }, message: { mid: "m_2", text: "buenas" } },
      ] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].accountId).toBe("103981554499114");
    expect(out[0].channel).toBe("MESSENGER");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/messaging/adapters/instagram.test.ts`
Expected: FAIL — `accountId` no existe en el tipo / es `undefined`.

- [ ] **Step 3: Agregar `accountId` a `IncomingMessage`**

En `src/lib/messaging/types.ts`, dentro de `interface IncomingMessage`, agregar tras `connectorId`:

```ts
  /** Id de la cuenta receptora del webhook: IG Business ID (objeto instagram) o Page ID (objeto page). */
  accountId?: string | null;
```

- [ ] **Step 4: Capturar `entry.id` en el parser de Instagram**

En `src/lib/messaging/adapters/instagram.ts`:
- Cambiar la interfaz de entry para incluir `id`:

```ts
interface MetaEntry { id?: string; messaging?: MetaMessagingEvent[] }
```

- En el push, agregar `accountId: entry.id ?? null`:

```ts
      out.push({
        channel: "INSTAGRAM",
        senderId: ev.sender.id,
        externalMessageId: m.mid,
        text: m.text ?? (m.attachments?.length ? "[Adjunto]" : "[mensaje]"),
        mediaUrl: m.attachments?.[0]?.payload?.url ?? null,
        accountId: entry.id ?? null,
      });
```

- [ ] **Step 5: Capturar `entry.id` en el parser de Messenger**

En `src/lib/messaging/adapters/messenger.ts`:
- Cambiar la interfaz de body:

```ts
interface MetaWebhookBody { object?: string; entry?: Array<{ id?: string; messaging?: MetaMessagingEvent[] }> }
```

- En el push, agregar `accountId: entry.id ?? null` (igual que IG, con `channel: "MESSENGER"`).

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/messaging/adapters/instagram.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/messaging/types.ts src/lib/messaging/adapters/instagram.ts src/lib/messaging/adapters/messenger.ts src/lib/messaging/adapters/instagram.test.ts
git commit -m "feat(inbox): parsers sociales capturan accountId (entry.id) para ruteo multicuenta"
```

---

## Task 2: Resolvers de conector social (`social-accounts.ts`)

**Files:**
- Create: `src/lib/messaging/social-accounts.ts`
- Test: `src/lib/messaging/social-accounts.test.ts`

Espejo de `src/lib/whatsapp/accounts.ts`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/messaging/social-accounts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ default: { leadConnector: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import {
  resolveConnectorByIgBusinessId,
  resolveConnectorByPageId,
  getSocialPageToken,
} from "./social-accounts";

beforeEach(() => findFirst.mockReset());

describe("resolveConnectorByIgBusinessId", () => {
  it("consulta por provider INSTAGRAM y config.igBusinessId (JSONB path), no por credentials", async () => {
    findFirst.mockResolvedValue({ id: "conn_ig" });
    const r = await resolveConnectorByIgBusinessId("17841453458089530");
    expect(r?.id).toBe("conn_ig");
    const where = findFirst.mock.calls[0][0].where;
    expect(where.provider).toBe("INSTAGRAM");
    expect(where.status).toBe("ACTIVE");
    expect(where.config).toEqual({ path: ["igBusinessId"], equals: "17841453458089530" });
  });
});

describe("resolveConnectorByPageId", () => {
  it("consulta por provider MESSENGER y config.pageId", async () => {
    findFirst.mockResolvedValue(null);
    await resolveConnectorByPageId("103981554499114");
    const where = findFirst.mock.calls[0][0].where;
    expect(where.provider).toBe("MESSENGER");
    expect(where.config).toEqual({ path: ["pageId"], equals: "103981554499114" });
  });
});

describe("getSocialPageToken", () => {
  it("devuelve el token descifrado y null si falta", () => {
    const conn = { id: "c1" } as never;
    expect(getSocialPageToken(conn, () => ({ pageAccessToken: "T" }))).toBe("T");
    expect(getSocialPageToken(conn, () => ({}))).toBeNull();
    expect(getSocialPageToken(conn, () => null)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/messaging/social-accounts.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `social-accounts.ts`**

Crear `src/lib/messaging/social-accounts.ts`:

```ts
// Resolución de cuenta IG/Messenger: connector ↔ credenciales. config (consultable) +
// credentials (cifradas). Espejo de whatsapp/accounts.ts. Sin side-effects.
import prisma from "@/lib/db";
import type { LeadConnector } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";

/** Connector IG activo cuyo config.igBusinessId == el recibido en el webhook (objeto instagram). */
export async function resolveConnectorByIgBusinessId(igBusinessId: string): Promise<LeadConnector | null> {
  return prisma.leadConnector.findFirst({
    where: { provider: "INSTAGRAM", status: "ACTIVE", deletedAt: null, config: { path: ["igBusinessId"], equals: igBusinessId } },
  });
}

/** Connector Messenger activo cuyo config.pageId == el recibido en el webhook (objeto page). */
export async function resolveConnectorByPageId(pageId: string): Promise<LeadConnector | null> {
  return prisma.leadConnector.findFirst({
    where: { provider: "MESSENGER", status: "ACTIVE", deletedAt: null, config: { path: ["pageId"], equals: pageId } },
  });
}

/** Page Access Token descifrado del conector (para la Send API). `decrypt` inyectable para test. */
export function getSocialPageToken(
  connector: LeadConnector,
  decrypt: (c: LeadConnector) => { pageAccessToken?: string } | null = (c) => readCredentials<{ pageAccessToken?: string }>(c),
): string | null {
  const token = decrypt(connector)?.pageAccessToken;
  return token && token.length ? token : null;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/messaging/social-accounts.test.ts`
Expected: PASS (4 asserts, 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/messaging/social-accounts.ts src/lib/messaging/social-accounts.test.ts
git commit -m "feat(inbox): resolvers de conector social por igBusinessId/pageId"
```

---

## Task 3: El webhook `meta-dm` resuelve el conector por mensaje

**Files:**
- Modify: `src/app/api/webhooks/meta-dm/route.ts`
- Test: `src/app/api/webhooks/meta-dm/route.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `src/app/api/webhooks/meta-dm/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const handleInboundMessage = vi.fn();
const resolveByIg = vi.fn();
const resolveByPage = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a) }));
vi.mock("@/lib/messaging/social-accounts", () => ({
  resolveConnectorByIgBusinessId: (...a: unknown[]) => resolveByIg(...a),
  resolveConnectorByPageId: (...a: unknown[]) => resolveByPage(...a),
}));

import { POST } from "./route";

beforeEach(() => {
  handleInboundMessage.mockReset(); resolveByIg.mockReset(); resolveByPage.mockReset();
  delete process.env.META_DM_APP_SECRET; // sin secret → validSignature=true
});

function req(body: unknown) {
  return new Request("https://x/api/webhooks/meta-dm", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/webhooks/meta-dm", () => {
  it("resuelve el conector IG por igBusinessId y setea connectorId en el mensaje", async () => {
    resolveByIg.mockResolvedValue({ id: "conn_ig" });
    await POST(req({ object: "instagram", entry: [{ id: "17841", messaging: [
      { sender: { id: "IGSID" }, message: { mid: "m1", text: "hi" } },
    ] }] }));
    expect(resolveByIg).toHaveBeenCalledWith("17841");
    expect(handleInboundMessage.mock.calls[0][0].connectorId).toBe("conn_ig");
  });

  it("procesa igual (connectorId null) si no hay conector para la cuenta", async () => {
    resolveByIg.mockResolvedValue(null);
    await POST(req({ object: "instagram", entry: [{ id: "999", messaging: [
      { sender: { id: "IGSID" }, message: { mid: "m2", text: "hi" } },
    ] }] }));
    expect(handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(handleInboundMessage.mock.calls[0][0].connectorId ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/app/api/webhooks/meta-dm/route.test.ts`
Expected: FAIL — hoy el route no llama a los resolvers ni setea `connectorId`.

- [ ] **Step 3: Implementar la resolución en el route**

En `src/app/api/webhooks/meta-dm/route.ts`:
- Agregar import:

```ts
import { resolveConnectorByIgBusinessId, resolveConnectorByPageId } from "@/lib/messaging/social-accounts";
```

- Reemplazar el bucle `for (const msg of messages)` por:

```ts
  let processed = 0;
  for (const msg of messages) {
    try {
      if (msg.accountId) {
        const connector = msg.channel === "INSTAGRAM"
          ? await resolveConnectorByIgBusinessId(msg.accountId)
          : await resolveConnectorByPageId(msg.accountId);
        if (connector) msg.connectorId = connector.id;
        else console.warn(`[meta-dm] sin conector activo para ${msg.channel} accountId=${msg.accountId}`);
      }
      await handleInboundMessage(msg);
      processed++;
    } catch (err) {
      console.error("[meta-dm] inbound:", err);
    }
  }
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/app/api/webhooks/meta-dm/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/meta-dm/route.ts src/app/api/webhooks/meta-dm/route.test.ts
git commit -m "feat(inbox): meta-dm resuelve conector por cuenta y adjunta connectorId al inbound"
```

---

## Task 4: El envío usa el conector de la conversación (fin del `findFirst`)

**Files:**
- Modify: `src/lib/messaging/dispatcher.ts`
- Test: `src/lib/messaging/dispatcher.test.ts` (actualizar)

- [ ] **Step 1: Actualizar/escribir los tests que fallan**

En `src/lib/messaging/dispatcher.test.ts`:
- Asegurar que el mock de prisma incluye `leadConnector.findUnique` (además de lo existente). Añadir al objeto mock de prisma: `leadConnector: { findUnique: (...a) => leadConnectorFindUnique(...a) }` con `const leadConnectorFindUnique = vi.fn()` declarado arriba.
- Reemplazar los 3 casos INSTAGRAM que hoy llaman sin `connectorId`. El happy-path queda:

```ts
  it("INSTAGRAM: usa el conector indicado en opts.connectorId (no findFirst)", async () => {
    leadConnectorFindUnique.mockResolvedValue({ id: "conn_ig", status: "ACTIVE", credentials: "enc" });
    // ...mocks existentes de contact.findUnique (instagramId), ensureConversation, message.create, activity.create, meetSlaTimers, adapter send...
    await sendChannelMessage("INSTAGRAM", "c1", "hola", "u1", { connectorId: "conn_ig" });
    expect(leadConnectorFindUnique).toHaveBeenCalledWith({ where: { id: "conn_ig" } });
  });

  it("INSTAGRAM: lanza si no se pasa connectorId", async () => {
    await expect(sendChannelMessage("INSTAGRAM", "c1", "hola", "u1")).rejects.toThrow(/connectorId/i);
  });
```

(Mantener los mocks de `readCredentials` → `{ pageAccessToken: "T" }` y del adapter `sendInstagram/sendMessenger` que ya existen en el archivo.)

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run src/lib/messaging/dispatcher.test.ts`
Expected: FAIL — el social path aún usa `findFirst` e ignora `opts.connectorId`.

- [ ] **Step 3: Implementar la resolución por conector en el dispatcher**

En `src/lib/messaging/dispatcher.ts`, reemplazar el bloque social (desde `const provider = channel;` hasta la línea que crea `connector` con `findFirst`) por:

```ts
  if (!opts.connectorId) throw new Error(`Falta connectorId para enviar ${channel} (conversación sin cuenta resuelta)`);
  const connector = await prisma.leadConnector.findUnique({ where: { id: opts.connectorId } });
  if (!connector || connector.status !== "ACTIVE") throw new Error(`Conector ${channel} inválido o inactivo`);
  const creds = readCredentials<{ pageAccessToken: string }>(connector);
  if (!creds?.pageAccessToken) throw new Error(`Conector ${channel} sin pageAccessToken`);
```

Y en `ensureConversation` usar `connector.id` (ya lo hace: `ensureConversation({ contactId, channel, connectorId: connector.id })`).

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run src/lib/messaging/dispatcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/messaging/dispatcher.ts src/lib/messaging/dispatcher.test.ts
git commit -m "fix(inbox): envío social usa el conector de la conversación (elimina cruce de tokens de findFirst)"
```

---

## Task 5: La ruta de envío del inbox pasa `connectorId` de la conversación

**Files:**
- Modify: `src/app/api/conversations/[id]/messages/route.ts`

> `botRespond` ya pasa `conv.connectorId` (verificado en `src/lib/bot/bot-respond.ts:132`), así que solo falta la ruta del asesor.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/app/api/conversations/[id]/messages/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendChannelMessage = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => ({ user: { id: "u1", role: "ASESOR" } }) }));
vi.mock("@/lib/messaging/dispatcher", () => ({ sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a) }));
vi.mock("@/lib/db", () => ({ default: {
  conversation: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) },
  message: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
} }));

import { POST } from "./route";

beforeEach(() => { sendChannelMessage.mockReset().mockResolvedValue({ id: "m1" }); findUnique.mockReset(); update.mockReset(); });

it("pasa connectorId de la conversación a sendChannelMessage", async () => {
  findUnique.mockResolvedValue({ id: "conv1", channel: "INSTAGRAM", status: "HUMAN", connectorId: "conn_ig", contact: { id: "c1", phone: null, doNotContact: false } });
  const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
  await POST(r, { params: { id: "conv1" } });
  expect(sendChannelMessage).toHaveBeenCalledWith("INSTAGRAM", "c1", "hola", "u1", { connectorId: "conn_ig" });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run "src/app/api/conversations/[id]/messages/route.test.ts"`
Expected: FAIL — hoy se llama sin el 5º argumento `{ connectorId }`.

- [ ] **Step 3: Implementar**

En `src/app/api/conversations/[id]/messages/route.ts`:
- Asegurar que el `findUnique` selecciona `connectorId` (con `include` los escalares vienen; si se cambiara a `select`, añadir `connectorId: true`).
- Cambiar la llamada:

```ts
    message = await sendChannelMessage(
      conv.channel as MessagingChannel,
      conv.contact.id,
      parsed.data.body,
      session.user.id,
      { connectorId: conv.connectorId }
    );
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run "src/app/api/conversations/[id]/messages/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/conversations/[id]/messages/route.ts" "src/app/api/conversations/[id]/messages/route.test.ts"
git commit -m "feat(inbox): la ruta de envío pasa el connectorId de la conversación"
```

---

## Task 6: Split `config` / `credentials` para conectores sociales (schema + API + UI)

**Files:**
- Modify: `src/lib/validations/rebuild-f1.ts`
- Modify: `src/app/api/admin/connectors/route.ts`
- Modify: `src/components/admin/connectors-section.tsx`
- Test: `src/lib/validations/rebuild-f1.test.ts` (extender o crear pequeño test)

> NO tocar `connectorCredentialsMetaSchema` (lo usa META Lead Ads). Se crean schemas nuevos para social.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/validations/social-connector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { connectorCredentialsSocialSchema, connectorConfigSocialSchema } from "./rebuild-f1";

describe("schemas sociales", () => {
  it("credentials social = token+appSecret+verifyToken, sin pageId", () => {
    expect(connectorCredentialsSocialSchema.safeParse({ pageAccessToken: "T", appSecret: "S", verifyToken: "V" }).success).toBe(true);
    expect(connectorCredentialsSocialSchema.safeParse({ appSecret: "S", verifyToken: "V" }).success).toBe(false);
  });
  it("config social requiere pageId; igBusinessId opcional", () => {
    expect(connectorConfigSocialSchema.safeParse({ pageId: "P", igBusinessId: "IG", brand: "Propyte" }).success).toBe(true);
    expect(connectorConfigSocialSchema.safeParse({ pageId: "P" }).success).toBe(true);
    expect(connectorConfigSocialSchema.safeParse({ igBusinessId: "IG" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/validations/social-connector.test.ts`
Expected: FAIL — schemas no existen.

- [ ] **Step 3: Agregar los schemas sociales**

En `src/lib/validations/rebuild-f1.ts`, tras `connectorCredentialsMetaSchema`:

```ts
// Social (IG DM / Messenger): secretos en credentials; identificadores en config.
export const connectorCredentialsSocialSchema = z.object({
  pageAccessToken: z.string().min(1),
  appSecret: z.string().min(1),
  verifyToken: z.string().min(1),
});
export const connectorConfigSocialSchema = z.object({
  pageId: z.string().min(1),
  igBusinessId: z.string().optional(),
  brand: z.string().optional(),
});
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/validations/social-connector.test.ts`
Expected: PASS.

- [ ] **Step 5: Enrutar social a los nuevos schemas + validar config en la API**

En `src/app/api/admin/connectors/route.ts`:
- Importar los nuevos schemas junto a los existentes.
- Cambiar `credentialsSchemaFor`:

```ts
function credentialsSchemaFor(provider: string) {
  if (provider === "INSTAGRAM" || provider === "MESSENGER") return connectorCredentialsSocialSchema;
  if (provider === "META") return connectorCredentialsMetaSchema;
  if (provider === "TIKTOK") return connectorCredentialsTikTokSchema;
  if (provider === "WEBSITE") return connectorCredentialsWebsiteSchema;
  if (provider === "GOOGLE_ADS") return connectorCredentialsGoogleAdsSchema;
  if (provider === "LINKEDIN") return connectorCredentialsLinkedInSchema;
  return z.record(z.string());
}
```

- En `POST`, antes de crear, validar el config social (y exigir `igBusinessId` para INSTAGRAM):

```ts
  if (parsed.data.provider === "INSTAGRAM" || parsed.data.provider === "MESSENGER") {
    const cfg = connectorConfigSocialSchema.safeParse(parsed.data.config ?? {});
    if (!cfg.success) return NextResponse.json({ error: cfg.error.flatten() }, { status: 400 });
    if (parsed.data.provider === "INSTAGRAM" && !cfg.data.igBusinessId) {
      return NextResponse.json({ error: "igBusinessId requerido para Instagram" }, { status: 400 });
    }
  }
```

- [ ] **Step 6: UI — separar campos config (texto) de credenciales (password)**

En `src/components/admin/connectors-section.tsx`:
- Definir campos de config para social y quitar `pageId` de credenciales sociales:

```ts
const SOCIAL_CONFIG_FIELDS = [
  { key: "pageId", label: "Page ID" },
  { key: "igBusinessId", label: "Instagram Business ID (solo IG)" },
  { key: "brand", label: "Marca (opcional)" },
];
const SOCIAL_CRED_FIELDS = [
  { key: "pageAccessToken", label: "Page Access Token (long-lived)" },
  { key: "appSecret", label: "App Secret" },
  { key: "verifyToken", label: "Verify Token" },
];
```

- En `CRED_FIELDS`, dejar `META: META_CRED_FIELDS` y cambiar `INSTAGRAM`/`MESSENGER` → `SOCIAL_CRED_FIELDS`.
- Agregar estado `const [cfg, setCfg] = useState<Record<string, string>>({});` y limpiarlo en el `onValueChange` del proveedor (`setCfg({})`).
- Definir `const isSocial = provider === "INSTAGRAM" || provider === "MESSENGER";` y renderizar, arriba de los CRED_FIELDS, los `SOCIAL_CONFIG_FIELDS` cuando `isSocial` (inputs de texto normal, NO password).
- En `create()`, incluir config y exigir `pageId` (e `igBusinessId` si IG):

```ts
    const body: Record<string, unknown> = { name: name.trim(), provider, credentials: creds };
    if (isSocial) {
      if (!cfg.pageId?.trim() || (provider === "INSTAGRAM" && !cfg.igBusinessId?.trim())) {
        setError("Instagram requiere Page ID + Instagram Business ID; Messenger requiere Page ID");
        return;
      }
      body.config = { pageId: cfg.pageId.trim(), igBusinessId: cfg.igBusinessId?.trim() || undefined, brand: cfg.brand?.trim() || undefined };
    }
    const res = await fetch("/api/admin/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
```

- En el `setCreds({})` de éxito, agregar `setCfg({})`.

- [ ] **Step 7: Correr build + tests**

Run: `npx vitest run src/lib/validations/social-connector.test.ts && npm run build`
Expected: tests PASS; build sin errores de tipo en la sección de conectores.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validations/rebuild-f1.ts src/lib/validations/social-connector.test.ts src/app/api/admin/connectors/route.ts src/components/admin/connectors-section.tsx
git commit -m "feat(conexiones): split config/credentials para conectores IG/Messenger (pageId+igBusinessId en config)"
```

---

## Task 7: Validación / diagnóstico por conector (requisito #4)

**Files:**
- Create: `src/lib/messaging/connector-health.ts`
- Create: `src/app/api/admin/connectors/health/route.ts`
- Test: `src/lib/messaging/connector-health.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/messaging/connector-health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkSocialConnector } from "./connector-health";

const base = { provider: "INSTAGRAM", config: { pageId: "P", igBusinessId: "IG" } } as never;

describe("checkSocialConnector", () => {
  it("ok cuando pageId+igBusinessId+pageAccessToken están presentes (IG)", () => {
    const r = checkSocialConnector(base, () => ({ pageAccessToken: "T" }));
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it("reporta faltantes sin exponer valores", () => {
    const r = checkSocialConnector({ provider: "INSTAGRAM", config: { pageId: "P" } } as never, () => ({}));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("config.igBusinessId");
    expect(r.missing).toContain("credentials.pageAccessToken");
  });
  it("Messenger no exige igBusinessId", () => {
    const r = checkSocialConnector({ provider: "MESSENGER", config: { pageId: "P" } } as never, () => ({ pageAccessToken: "T" }));
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/messaging/connector-health.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `connector-health.ts`**

Crear `src/lib/messaging/connector-health.ts`:

```ts
// Diagnóstico de conectores sociales: confirma presencia de los 3 campos SIN exponer secretos.
import type { LeadConnector } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";

export interface ConnectorHealth { ok: boolean; missing: string[] }

export function checkSocialConnector(
  connector: LeadConnector,
  decrypt: (c: LeadConnector) => { pageAccessToken?: string } | null = (c) => readCredentials<{ pageAccessToken?: string }>(c),
): ConnectorHealth {
  const config = (connector.config ?? {}) as { pageId?: string; igBusinessId?: string };
  const creds = decrypt(connector) ?? {};
  const missing: string[] = [];
  if (!config.pageId) missing.push("config.pageId");
  if (connector.provider === "INSTAGRAM" && !config.igBusinessId) missing.push("config.igBusinessId");
  if (!creds.pageAccessToken) missing.push("credentials.pageAccessToken");
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/messaging/connector-health.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Endpoint de salud (sin secretos)**

Crear `src/app/api/admin/connectors/health/route.ts`:

```ts
// GET diagnóstico: por conector social, si los 3 campos están presentes. NUNCA devuelve valores de secretos.
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { checkSocialConnector } from "@/lib/messaging/connector-health";

export const dynamic = "force-dynamic";
const ALLOWED = ["ADMIN", "DIRECTOR", "GERENTE"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const connectors = await prisma.leadConnector.findMany({
    where: { provider: { in: ["INSTAGRAM", "MESSENGER"] }, deletedAt: null },
    orderBy: { name: "asc" },
  });
  const data = connectors.map((c) => {
    const h = checkSocialConnector(c);
    return { id: c.id, name: c.name, provider: c.provider, status: c.status, ok: h.ok, missing: h.missing };
  });
  return NextResponse.json({ data });
}
```

- [ ] **Step 6: Log de arranque (opcional, no bloqueante)**

Si `src/instrumentation.ts` NO existe, crearlo y habilitar el hook en `next.config.js` (`experimental: { instrumentationHook: true }`). Contenido:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const [{ default: prisma }, { checkSocialConnector }] = await Promise.all([
      import("@/lib/db"), import("@/lib/messaging/connector-health"),
    ]);
    const conns = await prisma.leadConnector.findMany({
      where: { provider: { in: ["INSTAGRAM", "MESSENGER"] }, status: "ACTIVE", deletedAt: null },
    });
    for (const c of conns) {
      const h = checkSocialConnector(c);
      if (!h.ok) console.warn(`[connector-health] "${c.name}" (${c.provider}) incompleto: falta ${h.missing.join(", ")}`);
    }
  } catch (err) {
    console.warn("[connector-health] no se pudo verificar en arranque:", err);
  }
}
```

Run: `npm run build`
Expected: build OK. (Si el hook de instrumentación complica el build en esta versión, omitir este step: el endpoint de salud ya cubre la validación del requisito #4.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/messaging/connector-health.ts src/lib/messaging/connector-health.test.ts src/app/api/admin/connectors/health/route.ts
git add src/instrumentation.ts next.config.js 2>/dev/null || true
git commit -m "feat(conexiones): diagnóstico de conectores sociales (health endpoint + log de arranque)"
```

---

## Task 8: Subir la Graph API de v21 a v24 (requisito #3)

**Files:**
- Modify: `src/lib/messaging/graph.ts`
- Modify: `src/lib/connectors/test-connection.ts`

- [ ] **Step 1: Cambiar la versión en `graph.ts`**

En `src/lib/messaging/graph.ts` línea 3:

```ts
const GRAPH = "https://graph.facebook.com/v24.0";
```

- [ ] **Step 2: Cambiar la versión en `test-connection.ts`**

En `src/lib/connectors/test-connection.ts:23`, reemplazar `v21.0` por `v24.0` en la URL de `graph.facebook.com`.

- [ ] **Step 3: Verificar tests y build**

Run: `npx vitest run src/lib/connectors/test-connection.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 4: Commit**

```bash
git add src/lib/messaging/graph.ts src/lib/connectors/test-connection.ts
git commit -m "chore(inbox): Graph API v21 -> v24 en envío y test de conexión"
```

---

## Task 9: Migración, regeneración de cliente y verificación final

**Files:**
- Aplicar: `prisma/migrations-manual/2026-06-22-whatsapp-multicuenta.sql` (ya escrita; **aditiva**)

- [ ] **Step 1: Autorización + aplicación de la migración (Luis)**

La migración agrega `ConnectorProvider.WHATSAPP` + `conversations.connectorId` + unicidad. Se aplica en la Supabase compartida `oaijxdpevakashxshhvm`. **Requiere frase de autorización explícita de Luis con objetivo nombrado** (ver `feedback_autorizacion_explicita_infra`). Aplicar en **2 envíos** (ADD VALUE fuera de transacción):
- Envío 1: paso 1 (`ALTER TYPE ... ADD VALUE 'WHATSAPP'`).
- Envío 2: pasos 2–4 (columna `connectorId` + FK + índices).

- [ ] **Step 2: Regenerar cliente Prisma**

Run: `npx prisma generate`
Expected: cliente con `Conversation.connectorId` y `ConnectorProvider.WHATSAPP`.

- [ ] **Step 3: Suite completa + build**

Run: `npm test && npm run build`
Expected: todos los tests verdes (incluye los nuevos de Tasks 1–7 + regresión WhatsApp de la rama), build exit 0.

- [ ] **Step 4: Verificación de no-exposición de secretos**

Run: `git grep -nE "pageAccessToken|appSecret" -- src | grep -iE "console\.(log|warn|error)"`
Expected: **sin resultados** (ningún log imprime valores de secretos).

- [ ] **Step 5: Merge + deploy**

Con Luis: merge de `feat/whatsapp-multicuenta` a `main` → auto-deploy Hostinger. Reiniciar app tras cargar env vars/credenciales (Passenger).

---

## Verificación E2E (Luis, tras cargar credenciales por conector)

Hasta pasar App Review, los DMs de IG solo funcionan con cuentas que tengan rol (admin/dev/tester) en la app "Propyte CRM".

- [ ] Por cada cuenta IG (Nativa/Propyte/Market): enviar DM desde una cuenta con rol → aparece en el inbox, canal Instagram.
- [ ] Responder desde el inbox → el mensaje **llega desde esa misma cuenta** (no cruzado). Verificar en la app de IG receptora.
- [ ] Repetir para Messenger (tras suscribir `messages` al objeto `page` + crear conectores MESSENGER).
- [ ] `GET /api/admin/connectors/health` reporta `ok: true` para los 6 conectores.

---

## Self-Review (cobertura del spec)

- §3.2 modelo de datos → Tasks 6 (config/credentials) + 9 (migración connectorId). ✅
- §3.3 resolvers → Task 2. ✅
- §3.4 recepción (entry.id + resolución) → Tasks 1 + 3. ✅
- §3.5 envío por conector → Tasks 4 + 5 (+ botRespond ya listo). ✅
- §3.6 UI admin config/credentials + igBusinessId → Task 6. ✅
- §3.7 validación/diagnóstico → Task 7. ✅
- §3.8 v24 → Task 8. ✅
- §4 infra/migración → Task 9. ✅
- §6 testing (unit + regresión + no-secretos) → tests por task + Task 9 steps 3–4. ✅
- §7 checklist Meta / E2E → sección E2E. ✅
