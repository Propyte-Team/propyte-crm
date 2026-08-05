# Marcar SPAM desde el Inbox — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desde el Inbox, marcar una conversación como spam bloquea al remitente en Meta, anonimiza y da de baja el contacto, y lo apunta en una lista propia para que no vuelva a entrar.

**Architecture:** Tres módulos aislados en `src/lib/moderation/` (uno de base de datos sin red, uno de Graph sin base de datos, uno de consulta), más una acción nueva en la ruta de acciones del hilo que ya existe. La limpieza del CRM va en transacción; el bloqueo en Meta es best-effort con su estado guardado y reintentable, igual que `CommentRuleLog.dmStatus`.

**Tech Stack:** Next.js 14 (App Router), Prisma 6 sobre Supabase Postgres, zod, vitest, Graph API v24.

**Diseño:** `docs/superpowers/specs/2026-08-05-marcar-spam-inbox-design.md`

**Ya hecho antes de este plan:** la tabla `propyte_crm.blocked_senders` está creada en Supabase y el modelo `BlockedSender` está en `prisma/schema.prisma` (commit `b37da77`). No hay que aplicar ninguna migración.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/moderation/channel.ts` (crear) | Traducir `ConversationChannel` → `MessageChannel` y resolver el identificador del contacto por canal. Sin red, sin base de datos. |
| `src/lib/moderation/is-blocked.ts` (crear) | `isSenderBlocked(channel, identifier)`. Una consulta. |
| `src/lib/moderation/meta-moderation.ts` (crear) | `blockOnMeta(...)`. Solo Graph, `fetch` inyectable, nunca lanza. |
| `src/lib/moderation/block-sender.ts` (crear) | `markConversationAsSpam(...)`. Solo base de datos, en transacción. |
| `src/lib/moderation/roles.ts` (crear) | `CAN_MARK_SPAM_ROLES`, exportado una vez. |
| `src/lib/messaging/core.ts` (modificar) | Puerta de entrada: descartar inbound de remitentes bloqueados. |
| `src/lib/comments/handle-comment.ts` (modificar) | No responder ni mandar DM a un autor bloqueado. |
| `src/app/api/conversations/[id]/actions/route.ts` (modificar) | Acción `mark_spam`. |
| `src/components/inbox/inbox-view.tsx` (modificar) | Botón + confirmación. |
| `src/app/api/admin/blocked-senders/[id]/unblock/route.ts` (crear) | Deshacer el bloqueo. |
| `src/app/api/admin/blocked-senders/[id]/retry/route.ts` (crear) | Reintentar un bloqueo `FAILED`. |

**Fuera de este plan:** la pantalla de admin que lista los bloqueados. Los dos endpoints de arriba quedan completos y probados; la pestaña de UI necesita leer `src/components/admin/admin-content.tsx` para calcar su patrón de tabs, y se hará en un plan aparte para no inventar aquí código de un archivo sin revisar.

---

### Task 1: Traducción de canal e identificador

**Files:**
- Create: `src/lib/moderation/channel.ts`
- Test: `src/lib/moderation/channel.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/moderation/channel.test.ts
import { describe, it, expect } from "vitest";
import { toMessageChannel, identifierFor } from "./channel";

describe("toMessageChannel", () => {
  it("traduce los canales soportados", () => {
    expect(toMessageChannel("INSTAGRAM")).toBe("INSTAGRAM");
    expect(toMessageChannel("MESSENGER")).toBe("MESSENGER");
    expect(toMessageChannel("WHATSAPP")).toBe("WHATSAPP");
    expect(toMessageChannel("SMS")).toBe("SMS");
  });

  it("devuelve null para WEB, que no tiene remitente bloqueable", () => {
    expect(toMessageChannel("WEB")).toBeNull();
  });
});

describe("identifierFor", () => {
  const contacto = { instagramId: "IGSID-1", messengerPsid: "PSID-1", phone: "+5219981234567" };

  it("elige el campo del canal", () => {
    expect(identifierFor("INSTAGRAM", contacto)).toBe("IGSID-1");
    expect(identifierFor("MESSENGER", contacto)).toBe("PSID-1");
    expect(identifierFor("WHATSAPP", contacto)).toBe("+5219981234567");
  });

  it("devuelve null si el contacto no tiene ese identificador", () => {
    expect(identifierFor("INSTAGRAM", { instagramId: null, messengerPsid: "PSID-1", phone: null })).toBeNull();
  });

  it("devuelve null para SMS, que se identifica por teléfono pero no se bloquea en Meta", () => {
    expect(identifierFor("SMS", contacto)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/moderation/channel.test.ts`
Expected: FAIL — `Failed to resolve import "./channel"`

- [ ] **Step 3: Implementación mínima**

```ts
// src/lib/moderation/channel.ts
// Traducción entre el canal de la conversación y el canal de la lista de bloqueados,
// y resolución del identificador que Meta entiende para cada canal.
import type { ConversationChannel, MessageChannel } from "@prisma/client";

/** ConversationChannel incluye WEB, que no tiene un remitente bloqueable. */
export function toMessageChannel(channel: ConversationChannel): MessageChannel | null {
  switch (channel) {
    case "INSTAGRAM":
      return "INSTAGRAM";
    case "MESSENGER":
      return "MESSENGER";
    case "WHATSAPP":
      return "WHATSAPP";
    case "SMS":
      return "SMS";
    case "WEB":
      return null;
  }
}

export interface ContactIdentifiers {
  instagramId: string | null;
  messengerPsid: string | null;
  phone: string | null;
}

/** SMS devuelve null a propósito: no hay a quién bloquear del lado de Meta. */
export function identifierFor(channel: MessageChannel, contact: ContactIdentifiers): string | null {
  switch (channel) {
    case "INSTAGRAM":
      return contact.instagramId || null;
    case "MESSENGER":
      return contact.messengerPsid || null;
    case "WHATSAPP":
      return contact.phone || null;
    case "SMS":
      return null;
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/moderation/channel.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/moderation/channel.ts src/lib/moderation/channel.test.ts
git commit -m "feat(moderation): traducción de canal e identificador del remitente"
```

---

### Task 2: `isSenderBlocked`

**Files:**
- Create: `src/lib/moderation/is-blocked.ts`
- Test: `src/lib/moderation/is-blocked.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/moderation/is-blocked.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { blockedSender: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import { isSenderBlocked } from "./is-blocked";

beforeEach(() => {
  findUnique.mockReset();
});

describe("isSenderBlocked", () => {
  it("true si hay fila sin desbloquear", async () => {
    findUnique.mockResolvedValue({ unblockedAt: null });
    await expect(isSenderBlocked("INSTAGRAM", "IGSID-1")).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { channel_identifier: { channel: "INSTAGRAM", identifier: "IGSID-1" } },
      select: { unblockedAt: true },
    });
  });

  it("false si la fila ya fue desbloqueada", async () => {
    findUnique.mockResolvedValue({ unblockedAt: new Date("2026-08-05T00:00:00Z") });
    await expect(isSenderBlocked("INSTAGRAM", "IGSID-1")).resolves.toBe(false);
  });

  it("false si no hay fila", async () => {
    findUnique.mockResolvedValue(null);
    await expect(isSenderBlocked("MESSENGER", "PSID-9")).resolves.toBe(false);
  });

  it("no consulta con identificador vacío", async () => {
    await expect(isSenderBlocked("INSTAGRAM", "")).resolves.toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("false si la consulta truena — nunca bloquea la ingesta", async () => {
    findUnique.mockRejectedValue(new Error("db caída"));
    await expect(isSenderBlocked("INSTAGRAM", "IGSID-1")).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/moderation/is-blocked.test.ts`
Expected: FAIL — `Failed to resolve import "./is-blocked"`

- [ ] **Step 3: Implementación mínima**

```ts
// src/lib/moderation/is-blocked.ts
// Consulta de la lista de bloqueados. Se llama en el camino caliente del intake:
// si truena, devuelve false y deja pasar el mensaje — nunca mata la ingesta.
import prisma from "@/lib/db";
import type { MessageChannel } from "@prisma/client";

export async function isSenderBlocked(channel: MessageChannel, identifier: string): Promise<boolean> {
  if (!identifier) return false;
  try {
    const row = await prisma.blockedSender.findUnique({
      where: { channel_identifier: { channel, identifier } },
      select: { unblockedAt: true },
    });
    return !!row && row.unblockedAt === null;
  } catch (err) {
    console.warn(`[moderation] isSenderBlocked falló (${channel}/${identifier}):`, err);
    return false;
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/moderation/is-blocked.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/moderation/is-blocked.ts src/lib/moderation/is-blocked.test.ts
git commit -m "feat(moderation): isSenderBlocked"
```

---

### Task 3: Puerta de entrada en el intake

**Files:**
- Modify: `src/lib/messaging/core.ts` — dentro de `handleInboundMessage`, justo después de `if (msg.isEcho) return handleEchoMessage(msg);` (línea 187)
- Modify: `src/lib/messaging/core.test.ts` — **este archivo YA EXISTE** (11 bloques `describe`, mocks propios de `@/lib/db` en las líneas 21-46). No lo recrees: añade el mock nuevo, el reset y un `describe` al final.

- [ ] **Step 1: Añadir el mock del módulo nuevo**

En `src/lib/messaging/core.test.ts`, junto a los otros `vi.mock` (después del de `./profile`,
sobre la línea 57 — los `vi.mock` se izan, así que el sitio exacto entre ellos no importa, pero
**tiene que estar antes del `import { handleInboundMessage } from "./core";` de la línea 73**):

```ts
const isSenderBlocked = vi.fn();
vi.mock("@/lib/moderation/is-blocked", () => ({
  isSenderBlocked: (...a: unknown[]) => isSenderBlocked(...a),
}));
```

- [ ] **Step 2: Dejar el mock en falso por defecto**

En el `beforeEach` de nivel superior (línea 75), añade:

```ts
  isSenderBlocked.mockReset();
  isSenderBlocked.mockResolvedValue(false);
```

Esto es obligatorio: sin el `mockResolvedValue(false)` el mock devuelve `undefined` y, aunque
`undefined` es falsy y los 11 `describe` que ya existen seguirían pasando, el comportamiento
quedaría implícito. Que sea explícito.

- [ ] **Step 3: Añadir el test que falla, al final del archivo**

```ts
describe("handleInboundMessage — remitente bloqueado", () => {
  it("descarta el mensaje sin tocar contactos", async () => {
    isSenderBlocked.mockResolvedValue(true);

    const res = await handleInboundMessage({
      channel: "INSTAGRAM",
      senderId: "IGSID-1",
      externalMessageId: "MID-BLOQ-1",
      text: "hola",
    } as never);

    expect(res).toBeNull();
    expect(isSenderBlocked).toHaveBeenCalledWith("INSTAGRAM", "IGSID-1");
    expect(contactFindFirst).not.toHaveBeenCalled();
  });

  it("consulta la lista con el canal y el senderId de WhatsApp", async () => {
    isSenderBlocked.mockResolvedValue(true);

    await handleInboundMessage({
      channel: "WHATSAPP",
      senderId: "+5219981234567",
      externalMessageId: "MID-BLOQ-2",
      text: "hola",
    } as never);

    expect(isSenderBlocked).toHaveBeenCalledWith("WHATSAPP", "+5219981234567");
    expect(contactFindFirst).not.toHaveBeenCalled();
  });

  it("un remitente no bloqueado sigue el camino normal", async () => {
    isSenderBlocked.mockResolvedValue(false);

    await handleInboundMessage({
      channel: "INSTAGRAM",
      senderId: "IGSID-2",
      externalMessageId: "MID-BLOQ-3",
      text: "hola",
    } as never);

    expect(contactFindFirst).toHaveBeenCalled();
  });
});
```

`contactFindFirst` ya está declarado en la línea 3 del archivo: no lo redeclares.

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/messaging/core.test.ts`
Expected: FAIL en los dos primeros tests nuevos — `isSenderBlocked` no fue llamado y `contactFindFirst` sí, porque el módulo todavía no consulta la lista. Los 11 `describe` que ya existían siguen pasando.

- [ ] **Step 5: Implementación mínima**

En `src/lib/messaging/core.ts`, dentro de `handleInboundMessage`, sustituye:

```ts
  if (msg.isEcho) return handleEchoMessage(msg);

  let contact = await findContactByChannel(msg.channel, msg.senderId);
```

por:

```ts
  if (msg.isEcho) return handleEchoMessage(msg);

  // Remitente marcado como spam: se descarta antes de crear nada. Un solo punto
  // cubre WhatsApp, Instagram y Messenger. Ver lib/moderation/block-sender.ts.
  const { isSenderBlocked } = await import("@/lib/moderation/is-blocked");
  if (await isSenderBlocked(msg.channel, msg.senderId)) {
    console.warn(`[messaging] inbound de remitente bloqueado (${msg.channel}): ${msg.senderId} — descartado`);
    return null;
  }

  let contact = await findContactByChannel(msg.channel, msg.senderId);
```

Nota: `msg.channel` es `MessagingChannel` (`WHATSAPP|INSTAGRAM|MESSENGER`), que es un subconjunto de `MessageChannel`, así que se pasa tal cual sin traducir.

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/messaging/core.test.ts`
Expected: PASS — los 3 tests nuevos y todos los que ya había

- [ ] **Step 7: Correr la suite completa para confirmar que no rompiste el intake**

Run: `npx vitest run`
Expected: PASS — todos los archivos (base antes de este plan: 160 archivos / 1271 tests)

- [ ] **Step 8: Commit**

```bash
git add src/lib/messaging/core.ts src/lib/messaging/core.test.ts
git commit -m "feat(moderation): descartar inbound de remitentes bloqueados"
```

---

### Task 4: Puerta en las reglas de comentarios

**Files:**
- Modify: `src/lib/comments/handle-comment.ts` — añadir `"bloqueado"` a `CommentOutcome` (líneas 14-22) y la comprobación tras el anti-loop `"propio"`
- Test: `src/lib/comments/handle-comment.test.ts` — añadir un `describe`

- [ ] **Step 1: Escribir el test que falla**

Añade al final de `src/lib/comments/handle-comment.test.ts`. Requiere un mock nuevo, que va **junto a los demás `vi.mock` del principio del archivo** (los `vi.mock` se izan, no pueden ir dentro del `describe`):

```ts
// AL PRINCIPIO del archivo, junto a los otros vi.mock:
const isSenderBlocked = vi.fn();
vi.mock("@/lib/moderation/is-blocked", () => ({
  isSenderBlocked: (...a: unknown[]) => isSenderBlocked(...a),
}));
```

```ts
// AL FINAL del archivo:
describe("handleComment — autor bloqueado", () => {
  it("no responde en público ni manda DM", async () => {
    resolveByIg.mockResolvedValue(IG_CONNECTOR);
    isSenderBlocked.mockResolvedValue(true);

    const res = await handleComment(comment());

    expect(res.status).toBe("bloqueado");
    expect(replyToComment).not.toHaveBeenCalled();
    expect(sendPrivateReply).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("consulta la lista con el canal INSTAGRAM y el authorId", async () => {
    resolveByIg.mockResolvedValue(IG_CONNECTOR);
    isSenderBlocked.mockResolvedValue(true);

    await handleComment(comment({ authorId: "IGSID-42" }));

    expect(isSenderBlocked).toHaveBeenCalledWith("INSTAGRAM", "IGSID-42");
  });

  it("un comentario de Facebook consulta el canal MESSENGER", async () => {
    resolveByPage.mockResolvedValue({ id: "conn-fb", provider: "MESSENGER", config: { pageId: "PAGE-1" } });
    isSenderBlocked.mockResolvedValue(true);

    await handleComment(comment({ platform: "FACEBOOK", accountId: "PAGE-1", authorId: "PSID-7" }));

    expect(isSenderBlocked).toHaveBeenCalledWith("MESSENGER", "PSID-7");
  });
});
```

Añade también, en el `beforeEach` que ya existe en ese archivo, el reset del mock nuevo:

```ts
  isSenderBlocked.mockReset();
  isSenderBlocked.mockResolvedValue(false);
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/comments/handle-comment.test.ts`
Expected: FAIL — `expected "bloqueado", received "sin-match"` (todavía no se consulta la lista)

- [ ] **Step 3: Implementación mínima**

En `src/lib/comments/handle-comment.ts`, extiende la unión (líneas 14-22):

```ts
export type CommentOutcome =
  | "sin-conector"
  | "propio"
  | "bloqueado"
  | "anidado"
  | "duplicado"
  | "sin-match"
  | "cuota"
  | "sin-token"
  | "procesado";
```

Y justo después del bloque anti-loop `"propio"`, antes de `if (comment.isNested)`:

```ts
  // Autor marcado como spam: ni respuesta pública ni DM. Sin esto seguiría
  // disparando reglas aunque tenga el DM bloqueado.
  const { isSenderBlocked } = await import("@/lib/moderation/is-blocked");
  const blockChannel = comment.platform === "INSTAGRAM" ? "INSTAGRAM" : "MESSENGER";
  if (await isSenderBlocked(blockChannel, comment.authorId)) {
    console.warn(`[comments] autor bloqueado (${comment.platform}): ${comment.authorId} — se ignora`);
    return { status: "bloqueado" };
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/comments/handle-comment.test.ts`
Expected: PASS — los tests que ya había más 3 nuevos

- [ ] **Step 5: Verificar que nadie hace un `switch` exhaustivo sobre `CommentOutcome`**

Run: `npx tsc --noEmit`
Expected: 0 errores. Si sale un error de exhaustividad, añade el caso `"bloqueado"` donde lo pida — el compilador te dice el archivo y la línea exactos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/comments/handle-comment.ts src/lib/comments/handle-comment.test.ts
git commit -m "feat(moderation): las reglas de comentarios ignoran autores bloqueados"
```

---

### Task 5: Bloqueo en Meta

**Files:**
- Create: `src/lib/moderation/meta-moderation.ts`
- Test: `src/lib/moderation/meta-moderation.test.ts`

Dos llamadas separadas y no una con las dos acciones: así `metaBlockStatus` y `metaSpamStatus` son independientes y se sabe cuál de las dos falló.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/moderation/meta-moderation.test.ts
import { describe, it, expect, vi } from "vitest";
import { blockOnMeta } from "./meta-moderation";

function fetchOk(body: unknown = { success: true }) {
  return vi.fn().mockResolvedValue({ status: 200, json: async () => body } as unknown as Response);
}

function fetchErr(code: number, message = "boom") {
  return vi.fn().mockResolvedValue({
    status: 400,
    json: async () => ({ error: { code, message } }),
  } as unknown as Response);
}

describe("blockOnMeta — Instagram", () => {
  it("manda block_user y move_to_spam en dos llamadas a moderate_conversations", async () => {
    const f = fetchOk();
    const res = await blockOnMeta({
      channel: "INSTAGRAM",
      pageId: "PAGE-1",
      token: "TOKEN",
      identifier: "IGSID-1",
      fetchImpl: f,
    });

    expect(res).toEqual({ blockStatus: "SENT", spamStatus: "SENT" });
    expect(f).toHaveBeenCalledTimes(2);

    const [url1, init1] = f.mock.calls[0];
    expect(String(url1)).toBe("https://graph.facebook.com/v24.0/PAGE-1/moderate_conversations");
    expect(init1.method).toBe("POST");
    expect(JSON.parse(init1.body)).toEqual({
      user_ids: [{ id: "IGSID-1" }],
      actions: ["block_user"],
      access_token: "TOKEN",
    });

    expect(JSON.parse(f.mock.calls[1][1].body).actions).toEqual(["move_to_spam"]);
  });

  it("si el bloqueo falla no intenta el spam", async () => {
    const f = fetchErr(3801);
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1", fetchImpl: f,
    });

    expect(res.blockStatus).toBe("FAILED");
    expect(res.spamStatus).toBe("SKIPPED");
    expect(res.error).toContain("tope de personas bloqueadas");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("traduce el 3802 a un mensaje entendible", async () => {
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1", fetchImpl: fetchErr(3802),
    });
    expect(res.error).toContain("desbloqueaste");
  });

  it("explica el caso de que no exista conversación previa", async () => {
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1",
      fetchImpl: fetchErr(100, "No conversation exists between the user and the business"),
    });
    expect(res.blockStatus).toBe("FAILED");
    expect(res.error).toContain("conversación");
  });
});

describe("blockOnMeta — Messenger", () => {
  it("usa /blocked con psid y marca el spam como SKIPPED", async () => {
    const f = fetchOk();
    const res = await blockOnMeta({
      channel: "MESSENGER", pageId: "PAGE-1", token: "TOKEN", identifier: "PSID-1", fetchImpl: f,
    });

    expect(res).toEqual({ blockStatus: "SENT", spamStatus: "SKIPPED" });
    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.pathname).toBe("/v24.0/PAGE-1/blocked");
    expect(url.searchParams.get("psid")).toBe('["PSID-1"]');
    expect(url.searchParams.get("access_token")).toBe("TOKEN");
  });
});

describe("blockOnMeta — casos sin salida", () => {
  it("sin token devuelve SKIPPED sin llamar a nadie", async () => {
    const f = fetchOk();
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: null, identifier: "IGSID-1", fetchImpl: f,
    });
    expect(res).toEqual({ blockStatus: "SKIPPED", spamStatus: "SKIPPED", error: "conector sin pageAccessToken" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sin pageId devuelve SKIPPED", async () => {
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: null, token: "TOKEN", identifier: "IGSID-1", fetchImpl: fetchOk(),
    });
    expect(res.blockStatus).toBe("SKIPPED");
  });

  it("WhatsApp no tiene API de bloqueo: SKIPPED", async () => {
    const res = await blockOnMeta({
      channel: "WHATSAPP", pageId: "PAGE-1", token: "TOKEN", identifier: "+52199", fetchImpl: fetchOk(),
    });
    expect(res).toEqual({
      blockStatus: "SKIPPED",
      spamStatus: "SKIPPED",
      error: "WhatsApp no tiene API de bloqueo",
    });
  });

  it("nunca lanza: un fetch que revienta se convierte en FAILED", async () => {
    const f = vi.fn().mockRejectedValue(new Error("red caída"));
    const res = await blockOnMeta({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1", fetchImpl: f,
    });
    expect(res.blockStatus).toBe("FAILED");
    expect(res.error).toContain("red caída");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/moderation/meta-moderation.test.ts`
Expected: FAIL — `Failed to resolve import "./meta-moderation"`

- [ ] **Step 3: Implementación mínima**

```ts
// src/lib/moderation/meta-moderation.ts
// Bloqueo del remitente en Meta. Solo Graph: no toca la base de datos y NUNCA lanza —
// el estado que devuelve se guarda en BlockedSender y se puede reintentar.
//
// Instagram: POST /{page-id}/moderate_conversations con block_user y move_to_spam.
//   Exige que la conversación ya exista (limitación de Meta, no un bug nuestro).
// Messenger: POST /{page-id}/blocked con psid. No hay carpeta de spam por API.
// WhatsApp: no existe API de bloqueo.
import type { CommentActionStatus, MessageChannel } from "@prisma/client";

const V = "v24.0";
const ERROR_MAX = 500;

export interface MetaModerationResult {
  blockStatus: CommentActionStatus;
  spamStatus: CommentActionStatus;
  error?: string;
}

export interface BlockOnMetaArgs {
  channel: MessageChannel;
  pageId: string | null;
  token: string | null;
  identifier: string;
  fetchImpl?: typeof fetch;
}

/** Traduce los códigos de Meta a algo que un humano pueda leer en la UI. */
function humanError(code: number | undefined, message: string): string {
  if (code === 3801) return "Meta rechazó el bloqueo: el tope de personas bloqueadas de la Página está alcanzado.";
  if (code === 3802) return "Meta rechazó el bloqueo: desbloqueaste a esta persona hace muy poco, hay que esperar.";
  if (/no conversation/i.test(message)) {
    return "Instagram exige una conversación previa para bloquear. Este spam llegó solo por comentario, así que Meta no lo acepta; queda bloqueado en el CRM.";
  }
  return message.slice(0, ERROR_MAX);
}

async function post(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchImpl(url, init);
  const json = (await res.json().catch(() => null)) as { error?: { code?: number; message?: string } } | null;
  if (res.status >= 200 && res.status < 300 && !json?.error) return { ok: true };
  return { ok: false, error: humanError(json?.error?.code, json?.error?.message ?? `HTTP ${res.status}`) };
}

async function moderateIg(
  pageId: string,
  token: string,
  identifier: string,
  action: "block_user" | "move_to_spam",
  fetchImpl: typeof fetch
) {
  return post(
    `https://graph.facebook.com/${V}/${pageId}/moderate_conversations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_ids: [{ id: identifier }], actions: [action], access_token: token }),
    },
    fetchImpl
  );
}

export async function blockOnMeta(args: BlockOnMetaArgs): Promise<MetaModerationResult> {
  const { channel, pageId, token, identifier } = args;
  const fetchImpl = args.fetchImpl ?? fetch;

  if (channel === "WHATSAPP" || channel === "SMS") {
    return {
      blockStatus: "SKIPPED",
      spamStatus: "SKIPPED",
      error: channel === "WHATSAPP" ? "WhatsApp no tiene API de bloqueo" : "SMS no tiene API de bloqueo",
    };
  }
  if (!token) return { blockStatus: "SKIPPED", spamStatus: "SKIPPED", error: "conector sin pageAccessToken" };
  if (!pageId) return { blockStatus: "SKIPPED", spamStatus: "SKIPPED", error: "conector sin pageId" };

  try {
    if (channel === "MESSENGER") {
      const url = new URL(`https://graph.facebook.com/${V}/${pageId}/blocked`);
      url.searchParams.set("psid", JSON.stringify([identifier]));
      url.searchParams.set("access_token", token);
      const r = await post(url.toString(), { method: "POST" }, fetchImpl);
      return r.ok
        ? { blockStatus: "SENT", spamStatus: "SKIPPED" }
        : { blockStatus: "FAILED", spamStatus: "SKIPPED", error: r.error };
    }

    const block = await moderateIg(pageId, token, identifier, "block_user", fetchImpl);
    if (!block.ok) return { blockStatus: "FAILED", spamStatus: "SKIPPED", error: block.error };

    const spam = await moderateIg(pageId, token, identifier, "move_to_spam", fetchImpl);
    return spam.ok
      ? { blockStatus: "SENT", spamStatus: "SENT" }
      : { blockStatus: "SENT", spamStatus: "FAILED", error: spam.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { blockStatus: "FAILED", spamStatus: "SKIPPED", error: message.slice(0, ERROR_MAX) };
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/moderation/meta-moderation.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/moderation/meta-moderation.ts src/lib/moderation/meta-moderation.test.ts
git commit -m "feat(moderation): blockOnMeta para Instagram y Messenger"
```

---

### Task 6: La transacción del CRM

**Files:**
- Create: `src/lib/moderation/block-sender.ts`
- Create: `src/lib/moderation/roles.ts`
- Test: `src/lib/moderation/block-sender.test.ts`

- [ ] **Step 1: Escribir `roles.ts` (no necesita test propio: es una constante)**

```ts
// src/lib/moderation/roles.ts
// Mismo conjunto que ya puede borrar contactos en src/app/api/contacts/route.ts
// (unión de FULL_ACCESS_ROLES y PLAZA_ACCESS_ROLES tal como están escritos ahí).
// Se declara UNA vez aquí porque marcar spam borra datos: no debe divergir de
// quién puede borrar un contacto.
export const CAN_MARK_SPAM_ROLES = [
  "ADMIN",
  "DIRECTOR",
  "GERENTE",
  "DEVELOPER_EXT",
  "MANTENIMIENTO",
] as const;

export function canMarkSpam(role: string): boolean {
  return (CAN_MARK_SPAM_ROLES as readonly string[]).includes(role);
}
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// src/lib/moderation/block-sender.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const convFindUnique = vi.fn();
const dealCount = vi.fn();
const walkInCount = vi.fn();
const blockedUpsert = vi.fn();
const contactUpdate = vi.fn();
const convUpdate = vi.fn();
const blockedUpdate = vi.fn();

const tx = {
  blockedSender: {
    upsert: (...a: unknown[]) => blockedUpsert(...a),
    update: (...a: unknown[]) => blockedUpdate(...a),
  },
  contact: { update: (...a: unknown[]) => contactUpdate(...a) },
  conversation: { update: (...a: unknown[]) => convUpdate(...a) },
};

vi.mock("@/lib/db", () => ({
  default: {
    conversation: { findUnique: (...a: unknown[]) => convFindUnique(...a) },
    deal: { count: (...a: unknown[]) => dealCount(...a) },
    walkIn: { count: (...a: unknown[]) => walkInCount(...a) },
    blockedSender: { update: (...a: unknown[]) => blockedUpdate(...a) },
  },
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_opts: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx),
}));

import { markConversationAsSpam } from "./block-sender";

const CONV = {
  id: "conv-1",
  channel: "INSTAGRAM",
  connectorId: "conn-ig",
  contact: {
    id: "contact-1",
    instagramId: "IGSID-1",
    messengerPsid: null,
    phone: null,
    tags: ["lead"],
  },
};

beforeEach(() => {
  [convFindUnique, dealCount, walkInCount, blockedUpsert, contactUpdate, convUpdate, blockedUpdate].forEach((m) =>
    m.mockReset()
  );
  convFindUnique.mockResolvedValue(CONV);
  dealCount.mockResolvedValue(0);
  walkInCount.mockResolvedValue(0);
  blockedUpsert.mockResolvedValue({ id: "blocked-1" });
});

describe("markConversationAsSpam — salvaguardas", () => {
  it("404 si la conversación no existe", async () => {
    convFindUnique.mockResolvedValue(null);
    const res = await markConversationAsSpam({ conversationId: "nope", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "no-existe" });
  });

  it("aborta si el contacto tiene deals", async () => {
    dealCount.mockResolvedValue(2);
    const res = await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "tiene-negocio", deals: 2, walkIns: 0 });
    expect(blockedUpsert).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("aborta si el contacto tiene walk-ins", async () => {
    walkInCount.mockResolvedValue(1);
    const res = await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "tiene-negocio", deals: 0, walkIns: 1 });
  });

  it("aborta si el canal no tiene identificador bloqueable", async () => {
    convFindUnique.mockResolvedValue({ ...CONV, channel: "WEB" });
    const res = await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "sin-identificador" });
  });

  it("aborta si el contacto no tiene el id social del canal", async () => {
    convFindUnique.mockResolvedValue({ ...CONV, contact: { ...CONV.contact, instagramId: null } });
    const res = await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "sin-identificador" });
  });
});

describe("markConversationAsSpam — la transacción", () => {
  it("da de alta el bloqueo, anonimiza el contacto y cierra el hilo", async () => {
    const res = await markConversationAsSpam({
      conversationId: "conv-1",
      actorId: "user-1",
      reason: "spam de cripto",
    });

    expect(res).toEqual({
      ok: true,
      blockedSenderId: "blocked-1",
      channel: "INSTAGRAM",
      identifier: "IGSID-1",
      connectorId: "conn-ig",
    });

    expect(blockedUpsert).toHaveBeenCalledWith({
      where: { channel_identifier: { channel: "INSTAGRAM", identifier: "IGSID-1" } },
      create: {
        channel: "INSTAGRAM",
        identifier: "IGSID-1",
        reason: "spam de cripto",
        blockedById: "user-1",
        contactId: "contact-1",
      },
      update: {
        reason: "spam de cripto",
        blockedById: "user-1",
        contactId: "contact-1",
        unblockedAt: null,
        metaBlockStatus: "PENDING",
        metaSpamStatus: "PENDING",
        metaError: null,
      },
      select: { id: true },
    });

    const contactArgs = contactUpdate.mock.calls[0][0];
    expect(contactArgs.where).toEqual({ id: "contact-1" });
    expect(contactArgs.data).toMatchObject({
      email: null,
      phone: null,
      secondaryPhone: null,
      instagramId: null,
      messengerPsid: null,
      contactStatus: "DESCARTADO",
      doNotContact: true,
    });
    expect(contactArgs.data.firstName).toBe("Spam");
    expect(contactArgs.data.tags).toEqual(["lead", "SPAM"]);
    expect(contactArgs.data.deletedAt).toBeInstanceOf(Date);

    expect(convUpdate).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { status: "CLOSED", botEnabled: false, unreadCount: 0, controlledById: null },
    });
  });

  it("no duplica la etiqueta SPAM si ya estaba", async () => {
    convFindUnique.mockResolvedValue({ ...CONV, contact: { ...CONV.contact, tags: ["SPAM"] } });
    await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(contactUpdate.mock.calls[0][0].data.tags).toEqual(["SPAM"]);
  });
});

describe("recordMetaResult", () => {
  it("guarda el estado devuelto por Meta", async () => {
    const { recordMetaResult } = await import("./block-sender");
    blockedUpdate.mockResolvedValue({});
    await recordMetaResult("blocked-1", { blockStatus: "SENT", spamStatus: "FAILED", error: "boom" });
    expect(blockedUpdate).toHaveBeenCalledWith({
      where: { id: "blocked-1" },
      data: { metaBlockStatus: "SENT", metaSpamStatus: "FAILED", metaError: "boom" },
    });
  });

  it("no lanza si la escritura falla", async () => {
    const { recordMetaResult } = await import("./block-sender");
    blockedUpdate.mockRejectedValue(new Error("db caída"));
    await expect(
      recordMetaResult("blocked-1", { blockStatus: "SENT", spamStatus: "SENT" })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/moderation/block-sender.test.ts`
Expected: FAIL — `Failed to resolve import "./block-sender"`

- [ ] **Step 4: Implementación mínima**

```ts
// src/lib/moderation/block-sender.ts
// Marcar una conversación como spam, lado CRM. Solo base de datos: ninguna llamada de red.
// El bloqueo en Meta lo hace lib/moderation/meta-moderation.ts y su resultado se guarda
// después con recordMetaResult — mismo patrón que CommentRuleLog.dmStatus.
//
// No hay borrado duro: 11 tablas apuntan a contacts con RESTRICT/NO ACTION, así que un
// DELETE fallaría. Se anonimiza y se marca deletedAt, que además ya excluye al contacto
// de dashboard.ts y reports.ts.
import prisma from "@/lib/db";
import { withChangeSource } from "@/lib/audit/change-context";
import { toMessageChannel, identifierFor } from "./channel";
import type { MessageChannel } from "@prisma/client";
import type { MetaModerationResult } from "./meta-moderation";

const SPAM_TAG = "SPAM";

export type MarkSpamResult =
  | { ok: false; code: "no-existe" }
  | { ok: false; code: "sin-identificador" }
  | { ok: false; code: "tiene-negocio"; deals: number; walkIns: number }
  | {
      ok: true;
      blockedSenderId: string;
      channel: MessageChannel;
      identifier: string;
      connectorId: string | null;
    };

export async function markConversationAsSpam(args: {
  conversationId: string;
  actorId: string;
  reason?: string;
}): Promise<MarkSpamResult> {
  const conv = await prisma.conversation.findUnique({
    where: { id: args.conversationId },
    select: {
      id: true,
      channel: true,
      connectorId: true,
      contact: {
        select: { id: true, instagramId: true, messengerPsid: true, phone: true, tags: true },
      },
    },
  });
  if (!conv?.contact) return { ok: false, code: "no-existe" };

  const channel = toMessageChannel(conv.channel);
  if (!channel) return { ok: false, code: "sin-identificador" };
  const identifier = identifierFor(channel, conv.contact);
  if (!identifier) return { ok: false, code: "sin-identificador" };

  // Salvaguarda: un spammer no tiene negocio abierto. Las cotizaciones cuelgan de Deal
  // (Quote.dealId), no del contacto: sin deals no puede haber cotizaciones.
  const [deals, walkIns] = await Promise.all([
    prisma.deal.count({ where: { contactId: conv.contact.id } }),
    prisma.walkIn.count({ where: { contactId: conv.contact.id } }),
  ]);
  if (deals > 0 || walkIns > 0) return { ok: false, code: "tiene-negocio", deals, walkIns };

  const tags = conv.contact.tags.includes(SPAM_TAG) ? conv.contact.tags : [...conv.contact.tags, SPAM_TAG];

  const blockedSenderId = await withChangeSource(
    { source: "inbox_spam", actorId: args.actorId },
    async (tx) => {
      const blocked = await tx.blockedSender.upsert({
        where: { channel_identifier: { channel, identifier } },
        create: {
          channel,
          identifier,
          reason: args.reason ?? null,
          blockedById: args.actorId,
          contactId: conv.contact!.id,
        },
        update: {
          reason: args.reason ?? null,
          blockedById: args.actorId,
          contactId: conv.contact!.id,
          unblockedAt: null,
          metaBlockStatus: "PENDING",
          metaSpamStatus: "PENDING",
          metaError: null,
        },
        select: { id: true },
      });

      // instagramId y messengerPsid se limpian OBLIGATORIAMENTE: sus índices únicos son
      // parciales (WHERE ... IS NOT NULL), así que dejarlos aquí impediría para siempre
      // crear un contacto legítimo futuro con ese mismo id. Ya están en blocked_senders.
      await tx.contact.update({
        where: { id: conv.contact!.id },
        data: {
          firstName: "Spam",
          lastName: "(bloqueado)",
          email: null,
          phone: null,
          secondaryPhone: null,
          instagramId: null,
          messengerPsid: null,
          tags,
          contactStatus: "DESCARTADO",
          doNotContact: true,
          deletedAt: new Date(),
        },
      });

      await tx.conversation.update({
        where: { id: conv.id },
        data: { status: "CLOSED", botEnabled: false, unreadCount: 0, controlledById: null },
      });

      return blocked.id;
    }
  );

  return { ok: true, blockedSenderId, channel, identifier, connectorId: conv.connectorId };
}

/** Guarda el resultado del bloqueo en Meta. Best-effort: no puede tumbar la respuesta. */
export async function recordMetaResult(
  blockedSenderId: string,
  result: MetaModerationResult
): Promise<void> {
  try {
    await prisma.blockedSender.update({
      where: { id: blockedSenderId },
      data: {
        metaBlockStatus: result.blockStatus,
        metaSpamStatus: result.spamStatus,
        metaError: result.error ?? null,
      },
    });
  } catch (err) {
    console.error(`[moderation] no se pudo guardar el resultado de Meta (${blockedSenderId}):`, err);
  }
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/moderation/block-sender.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/moderation/block-sender.ts src/lib/moderation/roles.ts src/lib/moderation/block-sender.test.ts
git commit -m "feat(moderation): markConversationAsSpam en transacción"
```

---

### Task 7: La acción `mark_spam` en la ruta del hilo

**Files:**
- Modify: `src/app/api/conversations/[id]/actions/route.ts`
- Test: `src/app/api/conversations/[id]/actions/route.test.ts` (crear)

**Ojo — conflicto de permisos que hay que respetar:** esta ruta ya tiene su propio gate
(`isOwner || MANAGER_ROLES`) que se evalúa antes del `switch`. Si `mark_spam` se dejara caer ahí:
un **asesor** dueño del hilo podría borrar el contacto (no debe), y **DEVELOPER_EXT** o
**MANTENIMIENTO** serían rechazados aunque el borrado de contactos sí se lo permite. Por eso
`mark_spam` se resuelve **antes** de ese gate, con su propia comprobación de rol.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/app/api/conversations/[id]/actions/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const convFindUnique = vi.fn();
const connFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: { findUnique: (...a: unknown[]) => convFindUnique(...a), update: vi.fn() },
    leadConnector: { findUnique: (...a: unknown[]) => connFindUnique(...a) },
    activity: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const markConversationAsSpam = vi.fn();
const recordMetaResult = vi.fn();
vi.mock("@/lib/moderation/block-sender", () => ({
  markConversationAsSpam: (...a: unknown[]) => markConversationAsSpam(...a),
  recordMetaResult: (...a: unknown[]) => recordMetaResult(...a),
}));

const blockOnMeta = vi.fn();
vi.mock("@/lib/moderation/meta-moderation", () => ({
  blockOnMeta: (...a: unknown[]) => blockOnMeta(...a),
}));

const getSocialPageToken = vi.fn();
vi.mock("@/lib/messaging/social-accounts", () => ({
  getSocialPageToken: (...a: unknown[]) => getSocialPageToken(...a),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/conversations/conv-1/actions", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const PARAMS = { params: { id: "conv-1" } };

beforeEach(() => {
  [getServerSession, convFindUnique, connFindUnique, markConversationAsSpam, recordMetaResult, blockOnMeta, getSocialPageToken].forEach(
    (m) => m.mockReset()
  );
  getServerSession.mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } });
  markConversationAsSpam.mockResolvedValue({
    ok: true,
    blockedSenderId: "blocked-1",
    channel: "INSTAGRAM",
    identifier: "IGSID-1",
    connectorId: "conn-ig",
  });
  connFindUnique.mockResolvedValue({ id: "conn-ig", config: { pageId: "PAGE-1" } });
  getSocialPageToken.mockReturnValue("TOKEN");
  blockOnMeta.mockResolvedValue({ blockStatus: "SENT", spamStatus: "SENT" });
});

describe("POST mark_spam", () => {
  it("403 si el rol no puede borrar contactos, aunque sea dueño del hilo", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user-1", role: "ASESOR" } });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(403);
    expect(markConversationAsSpam).not.toHaveBeenCalled();
  });

  it("permite MANTENIMIENTO, que el gate genérico de la ruta rechazaría", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user-9", role: "MANTENIMIENTO" } });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(200);
  });

  it("409 con el detalle si el contacto tiene negocio", async () => {
    markConversationAsSpam.mockResolvedValue({ ok: false, code: "tiene-negocio", deals: 2, walkIns: 0 });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("2");
    expect(blockOnMeta).not.toHaveBeenCalled();
  });

  it("422 si no hay identificador bloqueable", async () => {
    markConversationAsSpam.mockResolvedValue({ ok: false, code: "sin-identificador" });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(422);
  });

  it("404 si la conversación no existe", async () => {
    markConversationAsSpam.mockResolvedValue({ ok: false, code: "no-existe" });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(404);
  });

  it("limpia el CRM, bloquea en Meta y devuelve las dos mitades", async () => {
    const res = await POST(req({ action: "mark_spam", reason: "cripto" }), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { blockedSenderId: "blocked-1", meta: { blockStatus: "SENT", spamStatus: "SENT" } },
    });
    expect(markConversationAsSpam).toHaveBeenCalledWith({
      conversationId: "conv-1",
      actorId: "user-1",
      reason: "cripto",
    });
    expect(blockOnMeta).toHaveBeenCalledWith({
      channel: "INSTAGRAM",
      pageId: "PAGE-1",
      token: "TOKEN",
      identifier: "IGSID-1",
    });
    expect(recordMetaResult).toHaveBeenCalledWith("blocked-1", { blockStatus: "SENT", spamStatus: "SENT" });
  });

  it("un fallo de Meta NO tumba la respuesta: 200 con el estado FAILED", async () => {
    blockOnMeta.mockResolvedValue({ blockStatus: "FAILED", spamStatus: "SKIPPED", error: "tope alcanzado" });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.meta.blockStatus).toBe("FAILED");
    expect(body.data.meta.error).toBe("tope alcanzado");
  });

  it("sin conector, Meta queda SKIPPED y el CRM igual se limpia", async () => {
    markConversationAsSpam.mockResolvedValue({
      ok: true, blockedSenderId: "blocked-1", channel: "INSTAGRAM", identifier: "IGSID-1", connectorId: null,
    });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(200);
    expect(blockOnMeta).toHaveBeenCalledWith({
      channel: "INSTAGRAM", pageId: null, token: null, identifier: "IGSID-1",
    });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run "src/app/api/conversations/[id]/actions/route.test.ts"`
Expected: FAIL — el schema de zod rechaza `"mark_spam"`, así que devuelve 400 en vez de 403/200

- [ ] **Step 3: Implementación mínima**

En `src/app/api/conversations/[id]/actions/route.ts`:

Cambia el encabezado y el schema:

```ts
// Acciones del hilo (Anexo B §I.5): takeover · release · close · snooze · toggle-bot · mark-spam.
// POST { action: "takeover"|"release"|"close"|"snooze"|"toggle_bot"|"mark_spam", until?, reason? }
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canMarkSpam } from "@/lib/moderation/roles";

const MANAGER_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];

const actionSchema = z.object({
  action: z.enum(["takeover", "release", "close", "snooze", "toggle_bot", "mark_spam"]),
  until: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
});
```

Y justo después del `safeParse` (antes del `findUnique` de la conversación), inserta el bloque
de `mark_spam`, que **no pasa por el gate genérico**:

```ts
  // mark_spam se resuelve ANTES del gate genérico de esta ruta a propósito: borra datos,
  // así que usa el mismo conjunto de roles que el borrado de contactos y NO le vale ser
  // dueño del hilo. Ver src/lib/moderation/roles.ts.
  if (parsed.data.action === "mark_spam") {
    if (!canMarkSpam(session.user.role)) {
      return NextResponse.json({ error: "No tienes permiso para marcar spam" }, { status: 403 });
    }

    const { markConversationAsSpam, recordMetaResult } = await import("@/lib/moderation/block-sender");
    const result = await markConversationAsSpam({
      conversationId: params.id,
      actorId: session.user.id,
      reason: parsed.data.reason,
    });

    if (!result.ok) {
      if (result.code === "no-existe") return NextResponse.json({ error: "No existe" }, { status: 404 });
      if (result.code === "sin-identificador") {
        return NextResponse.json(
          { error: "Esta conversación no tiene un remitente que se pueda bloquear" },
          { status: 422 }
        );
      }
      return NextResponse.json(
        {
          error: `No se marcó como spam: el contacto tiene ${result.deals} negocio(s) y ${result.walkIns} visita(s). Revísalo a mano.`,
        },
        { status: 409 }
      );
    }

    // Meta es best-effort: su fallo queda registrado y reintentable, nunca tumba la respuesta.
    const connector = result.connectorId
      ? await prisma.leadConnector.findUnique({ where: { id: result.connectorId } })
      : null;
    const { getSocialPageToken } = await import("@/lib/messaging/social-accounts");
    const { blockOnMeta } = await import("@/lib/moderation/meta-moderation");
    const meta = await blockOnMeta({
      channel: result.channel,
      pageId: connector ? ((connector.config ?? {}) as { pageId?: string }).pageId ?? null : null,
      token: connector ? getSocialPageToken(connector) : null,
      identifier: result.identifier,
    });
    await recordMetaResult(result.blockedSenderId, meta);

    return NextResponse.json({ data: { blockedSenderId: result.blockedSenderId, meta } });
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run "src/app/api/conversations/[id]/actions/route.test.ts"`
Expected: PASS — 8 tests

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errores

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/conversations/[id]/actions/route.ts" "src/app/api/conversations/[id]/actions/route.test.ts"
git commit -m "feat(moderation): acción mark_spam en la ruta del hilo"
```

---

### Task 8: Botón y confirmación en el Inbox

**Files:**
- Modify: `src/components/inbox/inbox-view.tsx` — `doAction` (líneas 329-343) y la barra de acciones del hilo (líneas 502-522)

- [ ] **Step 1: Añadir el import del icono**

En la línea de imports de `lucide-react` de `src/components/inbox/inbox-view.tsx`, añade `ShieldBan` a la lista que ya existe (junto a `User`, `RotateCcw`, `Power`, `X`).

- [ ] **Step 2: Añadir la función que confirma y llama**

Justo después de `doAction` (que termina en la línea 343), añade:

```tsx
  async function markSpam() {
    if (!selectedId || !thread) return;
    const nombre = `${thread.contact.firstName} ${thread.contact.lastName}`.trim();
    const ok = confirm(
      `¿Marcar como spam la conversación con ${nombre}?\n\n` +
        `• Se bloquea a esta persona en Meta: no podrá escribirte ni ver tu perfil, publicaciones ni historias.\n` +
        `• La conversación se archiva y el bot deja de responderle.\n` +
        `• El contacto se da de baja y sus datos personales se borran.\n\n` +
        `Los datos personales NO se pueden recuperar. El bloqueo sí se puede deshacer.`
    );
    if (!ok) return;

    const res = await fetch(`/api/conversations/${selectedId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_spam" }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error ?? "No se pudo marcar como spam");
      return;
    }
    // El CRM ya está limpio aunque Meta haya fallado: se avisa sin dar marcha atrás.
    if (data.data?.meta?.blockStatus === "FAILED") {
      alert(
        `Limpiado en el CRM, pero Meta rechazó el bloqueo:\n\n${data.data.meta.error}\n\n` +
          `Esta persona ya no puede volver a entrar al CRM. Puedes reintentar el bloqueo desde Admin.`
      );
    }
    setSelectedId(null);
    await loadList();
  }
```

- [ ] **Step 3: Añadir el botón**

En la barra de acciones del hilo, justo después del botón de cerrar conversación
(el que tiene `title="Cerrar conversación"`, línea 519-521) y antes del `</div>` que la cierra:

```tsx
                {canMarkSpam(userRole) && (
                  <button
                    className="btn-secondary !py-1.5 !px-2 text-[12px]"
                    title="Marcar como spam: bloquea en Meta y da de baja el contacto"
                    onClick={markSpam}
                  >
                    <ShieldBan className="h-3.5 w-3.5" style={{ color: "var(--color-error)" }} />
                  </button>
                )}
```

Y añade el import arriba del archivo:

```tsx
import { canMarkSpam } from "@/lib/moderation/roles";
```

**Ojo con `userRole`:** la firma del componente (línea 177) es
`export function InboxView({ userId }: { userId: string; userRole: string })` — la prop está
**tipada pero no desestructurada**, así que hoy no existe como variable dentro del componente.
`src/app/(dashboard)/inbox/page.tsx` ya la pasa, así que basta con añadirla a la
desestructuración:

```tsx
export function InboxView({ userId, userRole }: { userId: string; userRole: string }) {
```

- [ ] **Step 4: Verificar que compila y que la suite sigue verde**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 errores de tipos; todos los tests en verde

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build exitoso

- [ ] **Step 6: Commit**

```bash
git add src/components/inbox/inbox-view.tsx
git commit -m "feat(inbox): botón de marcar como spam"
```

---

### Task 9: Deshacer y reintentar (API)

**Files:**
- Create: `src/app/api/admin/blocked-senders/[id]/unblock/route.ts`
- Create: `src/app/api/admin/blocked-senders/[id]/retry/route.ts`
- Test: `src/app/api/admin/blocked-senders/[id]/unblock/route.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/app/api/admin/blocked-senders/[id]/unblock/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const blockedFindUnique = vi.fn();
const blockedUpdate = vi.fn();
const contactUpdate = vi.fn();
const connFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    blockedSender: {
      findUnique: (...a: unknown[]) => blockedFindUnique(...a),
      update: (...a: unknown[]) => blockedUpdate(...a),
    },
    contact: { update: (...a: unknown[]) => contactUpdate(...a) },
    leadConnector: { findFirst: (...a: unknown[]) => connFindFirst(...a) },
  },
}));

const unblockOnMeta = vi.fn();
vi.mock("@/lib/moderation/meta-moderation", () => ({
  unblockOnMeta: (...a: unknown[]) => unblockOnMeta(...a),
}));

vi.mock("@/lib/messaging/social-accounts", () => ({ getSocialPageToken: () => "TOKEN" }));

import { POST } from "./route";

const PARAMS = { params: { id: "blocked-1" } };
const request = () => new Request("http://x", { method: "POST" }) as never;

beforeEach(() => {
  [getServerSession, blockedFindUnique, blockedUpdate, contactUpdate, connFindFirst, unblockOnMeta].forEach((m) =>
    m.mockReset()
  );
  getServerSession.mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } });
  blockedFindUnique.mockResolvedValue({
    id: "blocked-1",
    channel: "INSTAGRAM",
    identifier: "IGSID-1",
    contactId: "contact-1",
    unblockedAt: null,
  });
  connFindFirst.mockResolvedValue(null);
  unblockOnMeta.mockResolvedValue({ ok: true });
  blockedUpdate.mockResolvedValue({});
  contactUpdate.mockResolvedValue({});
});

describe("POST unblock", () => {
  it("403 si el rol no puede", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u", role: "ASESOR" } });
    expect((await POST(request(), PARAMS)).status).toBe(403);
  });

  it("404 si no existe", async () => {
    blockedFindUnique.mockResolvedValue(null);
    expect((await POST(request(), PARAMS)).status).toBe(404);
  });

  it("marca unblockedAt y reactiva el contacto", async () => {
    const res = await POST(request(), PARAMS);
    expect(res.status).toBe(200);

    expect(blockedUpdate.mock.calls[0][0].where).toEqual({ id: "blocked-1" });
    expect(blockedUpdate.mock.calls[0][0].data.unblockedAt).toBeInstanceOf(Date);

    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: { deletedAt: null, doNotContact: false },
    });
  });

  it("no toca el contacto si el bloqueo no tenía contactId", async () => {
    blockedFindUnique.mockResolvedValue({
      id: "blocked-1", channel: "INSTAGRAM", identifier: "IGSID-1", contactId: null, unblockedAt: null,
    });
    await POST(request(), PARAMS);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("avisa de que la PII no vuelve", async () => {
    const body = await (await POST(request(), PARAMS)).json();
    expect(body.data.aviso).toContain("datos personales");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run "src/app/api/admin/blocked-senders/[id]/unblock/route.test.ts"`
Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 3: Añadir `unblockOnMeta` a `meta-moderation.ts`**

Al final de `src/lib/moderation/meta-moderation.ts`:

```ts
/** Deshace el bloqueo. Nunca lanza: el desbloqueo del CRM no depende de que Meta responda. */
export async function unblockOnMeta(args: BlockOnMetaArgs): Promise<{ ok: boolean; error?: string }> {
  const { channel, pageId, token, identifier } = args;
  const fetchImpl = args.fetchImpl ?? fetch;

  if (channel === "WHATSAPP" || channel === "SMS") return { ok: true };
  if (!token || !pageId) return { ok: false, error: "conector sin token o sin pageId" };

  try {
    if (channel === "MESSENGER") {
      const url = new URL(`https://graph.facebook.com/${V}/${pageId}/blocked`);
      url.searchParams.set("psid", JSON.stringify([identifier]));
      url.searchParams.set("access_token", token);
      return await post(url.toString(), { method: "DELETE" }, fetchImpl);
    }
    return await moderateIg(pageId, token, identifier, "unblock_user", fetchImpl);
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX) };
  }
}
```

Y amplía la firma de `moderateIg` para aceptar la acción nueva:

```ts
  action: "block_user" | "move_to_spam" | "unblock_user",
```

`post` devuelve `{ ok, error? }`, que es exactamente lo que `unblockOnMeta` promete, pero
`post` está tipado como `Promise<{ ok: boolean; error?: string }>` y `fetchImpl` puede lanzar,
por eso el `try/catch`.

- [ ] **Step 4: Escribir la ruta de desbloqueo**

```ts
// src/app/api/admin/blocked-senders/[id]/unblock/route.ts
// Deshace un bloqueo: lo quita en Meta, marca unblockedAt y reactiva el contacto.
// La PII anonimizada NO se recupera — se avisa en la respuesta.
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canMarkSpam } from "@/lib/moderation/roles";
import { unblockOnMeta } from "@/lib/moderation/meta-moderation";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canMarkSpam(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const blocked = await prisma.blockedSender.findUnique({ where: { id: params.id } });
  if (!blocked) return NextResponse.json({ error: "No existe" }, { status: 404 });

  // BlockedSender no guarda connectorId, así que se toma el primer conector activo del
  // canal. Con tres páginas esto puede elegir la equivocada: en ese caso Meta responde que
  // el usuario no existe para esa página, el desbloqueo del CRM se hace igual y el error
  // queda en metaError. La solución limpia (añadir connectorId) está en "Pendiente".
  const connector = await prisma.leadConnector.findFirst({
    where: {
      provider: blocked.channel === "INSTAGRAM" ? "INSTAGRAM" : "MESSENGER",
      status: "ACTIVE",
      deletedAt: null,
    },
  });

  const meta = await unblockOnMeta({
    channel: blocked.channel,
    pageId: connector ? ((connector.config ?? {}) as { pageId?: string }).pageId ?? null : null,
    token: connector ? getSocialPageToken(connector) : null,
    identifier: blocked.identifier,
  });

  await prisma.blockedSender.update({
    where: { id: blocked.id },
    data: { unblockedAt: new Date(), metaError: meta.ok ? null : meta.error ?? null },
  });

  if (blocked.contactId) {
    await prisma.contact.update({
      where: { id: blocked.contactId },
      data: { deletedAt: null, doNotContact: false },
    });
  }

  return NextResponse.json({
    data: {
      meta,
      aviso: "El bloqueo se deshizo. Los datos personales que se borraron al marcar spam no se recuperan.",
    },
  });
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run "src/app/api/admin/blocked-senders/[id]/unblock/route.test.ts"`
Expected: PASS — 5 tests

- [ ] **Step 6: Escribir la ruta de reintento**

```ts
// src/app/api/admin/blocked-senders/[id]/retry/route.ts
// Reintenta el bloqueo en Meta de un BlockedSender que quedó FAILED.
// Mismo patrón que /api/admin/comment-rules/logs/[id]/retry.
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canMarkSpam } from "@/lib/moderation/roles";
import { blockOnMeta } from "@/lib/moderation/meta-moderation";
import { recordMetaResult } from "@/lib/moderation/block-sender";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canMarkSpam(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const blocked = await prisma.blockedSender.findUnique({ where: { id: params.id } });
  if (!blocked) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (blocked.unblockedAt) {
    return NextResponse.json({ error: "Este remitente ya está desbloqueado" }, { status: 409 });
  }

  const connector = await prisma.leadConnector.findFirst({
    where: {
      provider: blocked.channel === "INSTAGRAM" ? "INSTAGRAM" : "MESSENGER",
      status: "ACTIVE",
      deletedAt: null,
    },
  });

  const meta = await blockOnMeta({
    channel: blocked.channel,
    pageId: connector ? ((connector.config ?? {}) as { pageId?: string }).pageId ?? null : null,
    token: connector ? getSocialPageToken(connector) : null,
    identifier: blocked.identifier,
  });
  await recordMetaResult(blocked.id, meta);

  return NextResponse.json({ data: { meta } });
}
```

- [ ] **Step 7: Gates completos**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: todos los tests verdes, 0 errores de tipos, build exitoso

- [ ] **Step 8: Commit**

```bash
git add "src/app/api/admin/blocked-senders" src/lib/moderation/meta-moderation.ts
git commit -m "feat(moderation): endpoints de desbloqueo y reintento"
```

---

## Pendiente para un plan aparte

- **Pantalla de admin** que liste `blocked_senders` con los botones de desbloquear y reintentar.
  Requiere leer `src/components/admin/admin-content.tsx` para calcar su patrón de tabs y
  `src/components/admin/comments/` como referencia de tabla. Los endpoints ya existen.
- **Resolución del conector en el desbloqueo:** `BlockedSender` no guarda `connectorId`, así que
  la ruta de desbloqueo no puede elegir la Página correcta cuando hay tres. Hoy desbloquea solo
  en el CRM y lo reporta. Si esto molesta en la práctica, la solución limpia es añadir
  `connectorId` a `blocked_senders` — otra migración, otra autorización.
