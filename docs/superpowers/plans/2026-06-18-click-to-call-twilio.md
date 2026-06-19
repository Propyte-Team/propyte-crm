# Click-to-call + auto-log (Twilio Voice WebRTC) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click-to-call desde el navegador (WebRTC) + recepción de llamadas entrantes, con auto-log determinista (duración, resultado, grabación) en `Activity`, vía Twilio Voice.

**Architecture:** Completa el scaffolding Twilio existente. El browser usa `@twilio/voice-sdk` (`Device` con token); al `connect()`, Twilio invoca el TwiML App → endpoint `/voice/twiml` que **crea la `Activity` con el `callSid`** y devuelve TwiML con aviso de grabación + `<Dial record>`. Los webhooks `status` y `recording` completan la actividad por `callSid`. Entrantes: el número rutea al `<Client>` del asesor asignado; si no contesta → buzón.

**Tech Stack:** Next.js App Router, Prisma (`propyte_crm`), `twilio@^5.13`, `@twilio/voice-sdk@^2.18`, vitest. Migración manual aditiva.

**Spec:** `docs/superpowers/specs/2026-06-18-click-to-call-twilio-design.md`

**Reglas del repo:**
- `params` SÍNCRONO en rutas dinámicas (`{ params }: { params: { id: string } }`).
- Migración NO se aplica autónomamente: dejar el `.sql` y pedir "aplica la migración click-to-call". `prisma generate` normal.
- Respetar el import de prisma que YA usa cada archivo (`src/lib/twilio/voice.ts` usa `import { prisma } from "@/lib/db"`; otros usan default — no cambiar el estilo del archivo).
- Env vars reales del código existente: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_TWIML_APP_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `NEXT_PUBLIC_APP_URL`.
- Autoría git `Propyte-Luis`/`webkoi@webkoi-ai.com`; mensajes en español + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`initiateCall` y `/api/twilio/call` NO se usan en v1 WebRTC** (el browser llama por el SDK). No se borran (fuera de alcance), quedan inertes.

---

## File Structure

**Modificados:**
- `prisma/schema.prisma` — `Activity` += `callSid`/`recordingUrl`; `LeadSource` += `LLAMADA_ENTRANTE`.
- `src/lib/twilio/voice.ts` — reescribir `handleCallStatus` (por `callSid`), `generateVoiceToken` (env + `incomingAllow`), + `handleRecording`.
- `src/app/api/webhooks/twilio/voice/twiml/route.ts` — outbound: firma + crea Activity + TwiML aviso/record.
- `src/app/api/webhooks/twilio/voice/status/route.ts` — pasar `callSid` al handler.
- `src/components/activities/activity-log.tsx` — botón "Llamar" + link grabación.
- `src/components/activities/activity-log-form.tsx` — `outcome` como picklist para CALL.

**Nuevos:**
- `src/lib/twilio/call-outcomes.ts` — constante compartida de resultados.
- `src/app/api/webhooks/twilio/voice/incoming/route.ts` — TwiML entrante.
- `src/app/api/webhooks/twilio/voice/recording/route.ts` — recording callback.
- `src/components/voice/voice-device-provider.tsx` — `Device` global (context) + manejo de entrantes.
- `src/components/voice/call-button.tsx` — botón + estados de llamada + form de outcome.
- `prisma/migrations-manual/2026-06-18-click-to-call.sql`.
- Tests `*.test.ts` por módulo server.

---

## Task 1: Migración + constante de outcomes

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations-manual/2026-06-18-click-to-call.sql`
- Create: `src/lib/twilio/call-outcomes.ts`

- [ ] **Step 1: Editar `prisma/schema.prisma`.**
En `model Activity`, junto a los campos de Google Workspace, añadir:
```prisma
  callSid      String? @unique
  recordingUrl String?
```
En `enum LeadSource` (tras `WHATSAPP` o donde encaje), añadir `LLAMADA_ENTRANTE`.

- [ ] **Step 2: `npx prisma validate`** → schema válido.

- [ ] **Step 3: Crear `prisma/migrations-manual/2026-06-18-click-to-call.sql`:**
```sql
-- Click-to-call Twilio Voice (§5.11.5). Aditivo + idempotente.
ALTER TYPE propyte_crm."LeadSource" ADD VALUE IF NOT EXISTS 'LLAMADA_ENTRANTE';

ALTER TABLE propyte_crm.activities ADD COLUMN IF NOT EXISTS "callSid" text;
ALTER TABLE propyte_crm.activities ADD COLUMN IF NOT EXISTS "recordingUrl" text;
CREATE UNIQUE INDEX IF NOT EXISTS "activities_callSid_key" ON propyte_crm.activities ("callSid") WHERE "callSid" IS NOT NULL;
```

- [ ] **Step 4: Crear `src/lib/twilio/call-outcomes.ts`:**
```typescript
/** Resultados canónicos de una llamada (picklist en el log). */
export const CALL_OUTCOMES = ["Contestó", "No contestó", "Buzón", "Agendó", "No interesó"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Mapea un CallStatus de Twilio (no contestado) a un outcome canónico. */
export function statusToOutcome(callStatus: string): CallOutcome | null {
  switch (callStatus) {
    case "no-answer": return "No contestó";
    case "busy": return "No contestó";
    case "failed": return "No contestó";
    case "completed": return null; // lo elige el asesor
    default: return null;
  }
}
```

- [ ] **Step 5: `npx prisma generate`** → sin errores (si DLL bloqueada por dev server, detenerlo; NO `--no-engine`).

- [ ] **Step 6: Commit**
```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-06-18-click-to-call.sql src/lib/twilio/call-outcomes.ts
git commit -m "feat(call): schema callSid/recordingUrl + LeadSource LLAMADA_ENTRANTE + outcomes"
```

> Gate: la migración NO se aplica aquí (BD compartida con prod). Se pide a Luis al final.

---

## Task 2: `voice.ts` — `handleCallStatus` por callSid, `handleRecording`, token

**Files:**
- Modify: `src/lib/twilio/voice.ts`
- Test: `src/lib/twilio/voice.test.ts`

**Contexto:** hoy `handleCallStatus` busca la Activity por `description.contains(CallSid)` (frágil) y escribe `outcome` libre. Cambiar a buscar por `callSid` y usar `statusToOutcome`. Añadir `handleRecording`. Ajustar `generateVoiceToken` a los nombres de env reales y `incomingAllow: true` (ya está; confirmar).

- [ ] **Step 1: Escribir el test** `src/lib/twilio/voice.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { activity: { findFirst: (...a: unknown[]) => findFirst(...a), update: (...a: unknown[]) => update(...a) } } }));

import { handleCallStatus, handleRecording } from "./voice";

beforeEach(() => { findFirst.mockReset(); update.mockReset(); findFirst.mockResolvedValue({ id: "a1", outcome: null }); update.mockResolvedValue({}); });

describe("handleCallStatus", () => {
  it("localiza la Activity por callSid y completa duración + status", async () => {
    await handleCallStatus({ CallSid: "CA1", CallStatus: "completed", CallDuration: "125", From: "+52", To: "+52" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ callSid: "CA1" }) }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETADA", duration_minutes: 3 }) }));
  });
  it("no-answer fija outcome 'No contestó'", async () => {
    await handleCallStatus({ CallSid: "CA2", CallStatus: "no-answer", From: "+52", To: "+52" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ outcome: "No contestó" }) }));
  });
  it("completed NO sobreescribe un outcome ya elegido por el asesor", async () => {
    findFirst.mockResolvedValue({ id: "a1", outcome: "Agendó" });
    await handleCallStatus({ CallSid: "CA3", CallStatus: "completed", CallDuration: "60", From: "+52", To: "+52" });
    const arg = update.mock.calls[0][0].data;
    expect(arg.outcome).toBeUndefined(); // no toca outcome existente
  });
});

describe("handleRecording", () => {
  it("guarda recordingUrl por callSid", async () => {
    await handleRecording({ CallSid: "CA1", RecordingUrl: "https://api.twilio.com/rec/abc" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1" }, data: { recordingUrl: "https://api.twilio.com/rec/abc.mp3" } }));
  });
});
```

- [ ] **Step 2: Correr (debe fallar)**
Run: `npx vitest run src/lib/twilio/voice.test.ts` → FAIL (`handleRecording` no existe; handleCallStatus busca por description).

- [ ] **Step 3: Editar `src/lib/twilio/voice.ts`.** Reemplazar `handleCallStatus` y añadir `handleRecording` (mantener `import { prisma }` y `generateVoiceToken`/`initiateCall` existentes):
```typescript
import { statusToOutcome } from "./call-outcomes";

export async function handleCallStatus(payload: {
  CallSid: string;
  CallStatus: string;
  CallDuration?: string;
  From: string;
  To: string;
}) {
  const { CallSid, CallStatus, CallDuration } = payload;
  const activity = await prisma.activity.findFirst({ where: { callSid: CallSid } });
  if (!activity) return;
  if (!["completed", "no-answer", "busy", "failed"].includes(CallStatus)) return;

  const data: Record<string, unknown> = {
    status: "COMPLETADA",
    completedAt: new Date(),
    duration_minutes: CallDuration ? Math.ceil(parseInt(CallDuration) / 60) : null,
  };
  const auto = statusToOutcome(CallStatus);
  // Solo fija outcome automático si no contestó Y el asesor no eligió uno antes
  if (auto && !activity.outcome) data.outcome = auto;
  await prisma.activity.update({ where: { id: activity.id }, data });
}

export async function handleRecording(payload: { CallSid: string; RecordingUrl: string }) {
  const activity = await prisma.activity.findFirst({ where: { callSid: payload.CallSid } });
  if (!activity) return;
  await prisma.activity.update({
    where: { id: activity.id },
    data: { recordingUrl: payload.RecordingUrl.endsWith(".mp3") ? payload.RecordingUrl : `${payload.RecordingUrl}.mp3` },
  });
}
```
En `generateVoiceToken`, confirmar que usa `TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET` y `VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: true })` (ya está; no cambiar si correcto).

- [ ] **Step 4: Correr (debe pasar)**
Run: `npx vitest run src/lib/twilio/voice.test.ts` → PASS (4).

- [ ] **Step 5: `npx tsc --noEmit -p tsconfig.json`** → sin errores.

- [ ] **Step 6: Commit**
```bash
git add src/lib/twilio/voice.ts src/lib/twilio/voice.test.ts
git commit -m "feat(call): handleCallStatus por callSid + handleRecording (auto-log robusto)"
```

---

## Task 3: TwiML de salida — crea Activity con callSid + grabación

**Files:**
- Modify: `src/app/api/webhooks/twilio/voice/twiml/route.ts`
- Test: `src/app/api/webhooks/twilio/voice/twiml/route.test.ts`

**Contexto:** el browser hace `device.connect({ To, contactId, userId })`. Twilio invoca este endpoint (POST form-encoded) con `CallSid`, `From`, `To` + params custom `contactId`/`userId`. El endpoint: valida firma, crea `Activity(CALL_OUTBOUND, callSid, contactId, userId, PENDIENTE)` y responde TwiML con aviso bilingüe + `<Dial record>`.

- [ ] **Step 1: Escribir el test** `…/twiml/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { activity: { create: (...a: unknown[]) => create(...a) }, contact: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("@/lib/twilio/client", () => ({ validateTwilioSignature: vi.fn(async () => true) }));

import { POST } from "./route";

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return new Request("https://crm.propyte.com/api/webhooks/twilio/voice/twiml", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => { create.mockReset(); findUnique.mockReset(); create.mockResolvedValue({ id: "a1" }); findUnique.mockResolvedValue({ preferredLanguage: "ES" }); });

describe("voice/twiml (salida)", () => {
  it("crea Activity CALL_OUTBOUND con callSid+contactId y devuelve TwiML con Dial+record", async () => {
    const res = await POST(formReq({ CallSid: "CA1", To: "+529991112233", contactId: "c1", userId: "u1" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activityType: "CALL_OUTBOUND", callSid: "CA1", contactId: "c1", userId: "u1", status: "PENDIENTE" }) }));
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(xml).toContain("<Dial");
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain("+529991112233");
  });
});
```

- [ ] **Step 2: Correr (debe fallar)** → FAIL.

- [ ] **Step 3: Reescribir `…/twiml/route.ts`:**
```typescript
// TwiML de SALIDA (click-to-call WebRTC). Twilio invoca este endpoint cuando el
// browser hace device.connect({ To, contactId, userId }). Crea la Activity con el
// CallSid y devuelve TwiML con aviso de grabación + Dial grabado.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateTwilioSignature } from "@/lib/twilio/client";

const PHONE_REGEX = /^\+?[\d\s\-()]{8,20}$/;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const valid = await validateTwilioSignature(`${appUrl}/api/webhooks/twilio/voice/twiml`, params);
  if (!valid) return new NextResponse("Firma inválida", { status: 403 });

  const to = params.To ?? "";
  if (!PHONE_REGEX.test(to)) return xml(`<Say language="es-MX">Número inválido.</Say>`);

  // Idioma del aviso de grabación según el contacto (best-effort)
  let lang = "es-MX";
  let notice = "Esta llamada puede ser grabada con fines de calidad.";
  if (params.contactId) {
    const c = await prisma.contact.findUnique({ where: { id: params.contactId }, select: { preferredLanguage: true } });
    if (c?.preferredLanguage === "EN") { lang = "en-US"; notice = "This call may be recorded for quality purposes."; }
  }

  // Auto-log: crear la Activity ligada al CallSid
  if (params.CallSid && params.contactId && params.userId) {
    await prisma.activity.create({
      data: {
        contactId: params.contactId,
        userId: params.userId,
        activityType: "CALL_OUTBOUND",
        subject: "Llamada saliente",
        status: "PENDIENTE",
        callSid: params.CallSid,
      },
    }).catch(() => {}); // idempotente: si Twilio reintenta, el unique de callSid evita duplicar
  }

  const recordingCb = `${appUrl}/api/webhooks/twilio/voice/recording`;
  const safeTo = escapeXml(to);
  const callerId = escapeXml(process.env.TWILIO_PHONE_NUMBER ?? "");
  return xml(
    `<Say language="${lang}">${escapeXml(notice)}</Say>` +
    `<Dial callerId="${callerId}" record="record-from-answer-dual" recordingStatusCallback="${escapeXml(recordingCb)}" recordingStatusCallbackEvent="completed">` +
    `<Number>${safeTo}</Number></Dial>`
  );
}
```

- [ ] **Step 4: Correr (debe pasar)** → PASS.
- [ ] **Step 5: `npx tsc --noEmit`** → limpio.
- [ ] **Step 6: Commit**
```bash
git add "src/app/api/webhooks/twilio/voice/twiml/route.ts" "src/app/api/webhooks/twilio/voice/twiml/route.test.ts"
git commit -m "feat(call): TwiML salida crea Activity por callSid + aviso de grabación + Dial grabado"
```

---

## Task 4: webhooks status + recording

**Files:**
- Modify: `src/app/api/webhooks/twilio/voice/status/route.ts`
- Create: `src/app/api/webhooks/twilio/voice/recording/route.ts`
- Test: `src/app/api/webhooks/twilio/voice/recording/route.test.ts`

- [ ] **Step 1:** El `status/route.ts` ya valida firma y llama `handleCallStatus`. Verificar que pase `CallSid` (lo hace). No requiere cambios salvo confirmar. Si pasa el test de Task 2, queda.

- [ ] **Step 2: Escribir test** `…/recording/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
const handleRecording = vi.fn();
vi.mock("@/lib/twilio/voice", () => ({ handleRecording: (...a: unknown[]) => handleRecording(...a) }));
vi.mock("@/lib/twilio/client", () => ({ validateTwilioSignature: vi.fn(async () => true) }));
import { POST } from "./route";
function formReq(fields: Record<string, string>) {
  return new Request("https://crm.propyte.com/api/webhooks/twilio/voice/recording", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(),
  }) as unknown as import("next/server").NextRequest;
}
beforeEach(() => handleRecording.mockReset());
describe("voice/recording", () => {
  it("pasa CallSid + RecordingUrl al handler", async () => {
    const res = await POST(formReq({ CallSid: "CA1", RecordingUrl: "https://api.twilio.com/rec/abc" }));
    expect(res.status).toBe(200);
    expect(handleRecording).toHaveBeenCalledWith({ CallSid: "CA1", RecordingUrl: "https://api.twilio.com/rec/abc" });
  });
});
```

- [ ] **Step 3: Correr (falla)** → FAIL.

- [ ] **Step 4: Crear `…/recording/route.ts`:**
```typescript
// Recording status callback de Twilio → guarda recordingUrl en la Activity.
import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio/client";
import { handleRecording } from "@/lib/twilio/voice";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/voice/recording`;
  if (!(await validateTwilioSignature(url, params))) return NextResponse.json({ error: "Firma inválida" }, { status: 403 });
  if (params.CallSid && params.RecordingUrl) {
    await handleRecording({ CallSid: params.CallSid, RecordingUrl: params.RecordingUrl });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Correr (pasa)** → PASS. `npx tsc --noEmit` limpio.
- [ ] **Step 6: Commit**
```bash
git add "src/app/api/webhooks/twilio/voice/recording/route.ts" "src/app/api/webhooks/twilio/voice/recording/route.test.ts"
git commit -m "feat(call): recording callback guarda recordingUrl por callSid"
```

---

## Task 5: TwiML de entrada (inbound + buzón)

**Files:**
- Create: `src/app/api/webhooks/twilio/voice/incoming/route.ts`
- Test: `src/app/api/webhooks/twilio/voice/incoming/route.test.ts`

**Contexto:** el número Twilio recibe → este endpoint. Match `From`→contacto (`findContactByPhone`, ya existe en `lib/twilio/utils.ts`); desconocido → `captureLead({source:"LLAMADA_ENTRANTE"})`. Crea `Activity(CALL_INBOUND, callSid)`. TwiML: aviso + `<Dial timeout=20 record><Client>{asesor}</Client></Dial>`; si el contacto no tiene asesor o como fallback de no-respuesta, `<Record>` buzón (action a recording).

- [ ] **Step 1: Escribir test** `…/incoming/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
const findContactByPhone = vi.fn();
const captureLead = vi.fn();
const create = vi.fn();
vi.mock("@/lib/twilio/utils", () => ({ findContactByPhone: (...a: unknown[]) => findContactByPhone(...a) }));
vi.mock("@/lib/intake/capture-lead", () => ({ captureLead: (...a: unknown[]) => captureLead(...a) }));
vi.mock("@/lib/db", () => ({ prisma: { activity: { create: (...a: unknown[]) => create(...a) } } }));
vi.mock("@/lib/twilio/client", () => ({ validateTwilioSignature: vi.fn(async () => true) }));
import { POST } from "./route";
function formReq(fields: Record<string, string>) {
  return new Request("https://crm.propyte.com/api/webhooks/twilio/voice/incoming", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(),
  }) as unknown as import("next/server").NextRequest;
}
beforeEach(() => { [findContactByPhone, captureLead, create].forEach(m => m.mockReset()); create.mockResolvedValue({ id: "a1" }); });

describe("voice/incoming", () => {
  it("contacto conocido con asesor → Dial al Client del asesor + crea Activity CALL_INBOUND", async () => {
    findContactByPhone.mockResolvedValue({ id: "c1", assignedToId: "u1" });
    const res = await POST(formReq({ CallSid: "CA9", From: "+529991112233", To: "+52..." }));
    const xml = await res.text();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activityType: "CALL_INBOUND", callSid: "CA9", contactId: "c1" }) }));
    expect(xml).toContain("<Client>u1</Client>");
  });
  it("desconocido → captureLead LLAMADA_ENTRANTE y va a buzón si no hay asesor", async () => {
    findContactByPhone.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c2", assignedToId: null });
    const res = await POST(formReq({ CallSid: "CA10", From: "+521000000000", To: "+52..." }));
    const xml = await res.text();
    expect(captureLead).toHaveBeenCalledWith(expect.objectContaining({ source: "LLAMADA_ENTRANTE", phone: "+521000000000" }));
    expect(xml).toContain("<Record");
  });
});
```

- [ ] **Step 2: Correr (falla)** → FAIL.

- [ ] **Step 3: Crear `…/incoming/route.ts`:**
```typescript
// TwiML de ENTRADA: rutea la llamada entrante al Client del asesor asignado;
// si no hay asesor / no contesta → buzón grabado. Auto-log Activity(CALL_INBOUND).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateTwilioSignature } from "@/lib/twilio/client";
import { findContactByPhone } from "@/lib/twilio/utils";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!(await validateTwilioSignature(`${appUrl}/api/webhooks/twilio/voice/incoming`, params))) {
    return new NextResponse("Firma inválida", { status: 403 });
  }

  const from = params.From ?? "";
  let contact = await findContactByPhone(from);
  if (!contact) {
    const { captureLead } = await import("@/lib/intake/capture-lead");
    const r = await captureLead({ source: "LLAMADA_ENTRANTE", firstName: "Llamada", lastName: "(entrante)", phone: from });
    if (r.contactId) contact = { id: r.contactId, assignedToId: r.assignedToId } as { id: string; assignedToId: string | null };
  }

  if (contact && params.CallSid) {
    await prisma.activity.create({
      data: { contactId: contact.id, userId: contact.assignedToId ?? contact.id, activityType: "CALL_INBOUND", subject: "Llamada entrante", status: "PENDIENTE", callSid: params.CallSid },
    }).catch(() => {});
  }

  const recordingCb = escapeXml(`${appUrl}/api/webhooks/twilio/voice/recording`);
  const notice = `<Say language="es-MX">Esta llamada puede ser grabada con fines de calidad.</Say>`;
  const voicemail = `<Say language="es-MX">En este momento no podemos atenderte. Deja tu mensaje después del tono.</Say><Record maxLength="120" recordingStatusCallback="${recordingCb}" />`;

  if (contact?.assignedToId) {
    return xml(
      notice +
      `<Dial timeout="20" record="record-from-answer-dual" recordingStatusCallback="${recordingCb}" recordingStatusCallbackEvent="completed">` +
      `<Client>${escapeXml(contact.assignedToId)}</Client></Dial>` +
      voicemail // si el Dial no conecta/cuelga, cae al buzón
    );
  }
  return xml(notice + voicemail);
}
```

- [ ] **Step 4: Correr (pasa)** → PASS. `npx tsc --noEmit` limpio.
- [ ] **Step 5: Commit**
```bash
git add "src/app/api/webhooks/twilio/voice/incoming/route.ts" "src/app/api/webhooks/twilio/voice/incoming/route.test.ts"
git commit -m "feat(call): TwiML entrada rutea al asesor + buzón + auto-log CALL_INBOUND"
```

---

## Task 6: VoiceDeviceProvider (browser) + montaje

**Files:**
- Create: `src/components/voice/voice-device-provider.tsx`
- Modify: `src/components/layout/providers.tsx`

**Contexto:** un context que pide el token a `/api/twilio/token`, registra un `Device` de `@twilio/voice-sdk`, expone `startCall(to, contactId, userId)` y maneja entrantes (`device.on("incoming")` → auto-accept o prompt). Se monta dentro de `SessionProvider` para tener sesión. SSR-safe (todo en `useEffect`, `"use client"`).

- [ ] **Step 1: Crear `src/components/voice/voice-device-provider.tsx`:**
```tsx
"use client";
import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Device, type Call } from "@twilio/voice-sdk";

type CallState = "idle" | "connecting" | "ringing" | "in-call";
interface VoiceCtx {
  ready: boolean;
  state: CallState;
  activeContactId: string | null;
  startCall: (to: string, contactId: string, userId: string) => Promise<void>;
  hangup: () => void;
}
const Ctx = createContext<VoiceCtx | null>(null);
export const useVoice = () => useContext(Ctx);

export function VoiceDeviceProvider({ userId, children }: { userId?: string; children: React.ReactNode }) {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<CallState>("idle");
  const [activeContactId, setActiveContactId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/twilio/token");
        if (!res.ok) return;
        const { token } = await res.json();
        if (cancelled || !token) return;
        const device = new Device(token, { logLevel: "error" });
        device.on("incoming", (call: Call) => {
          callRef.current = call;
          setState("ringing");
          call.on("disconnect", () => { setState("idle"); callRef.current = null; });
          call.accept(); // v1: auto-acepta en el browser del asesor asignado
          setState("in-call");
        });
        await device.register();
        deviceRef.current = device;
        if (!cancelled) setReady(true);
      } catch { /* sin Twilio configurado → degrada silencioso */ }
    })();
    return () => { cancelled = true; deviceRef.current?.destroy(); deviceRef.current = null; };
  }, [userId]);

  const startCall = useCallback(async (to: string, contactId: string, uid: string) => {
    if (!deviceRef.current) return;
    setState("connecting"); setActiveContactId(contactId);
    const call = await deviceRef.current.connect({ params: { To: to, contactId, userId: uid } });
    callRef.current = call;
    call.on("accept", () => setState("in-call"));
    call.on("ringing", () => setState("ringing"));
    call.on("disconnect", () => { setState("idle"); setActiveContactId(null); callRef.current = null; });
    call.on("error", () => { setState("idle"); setActiveContactId(null); });
  }, []);

  const hangup = useCallback(() => { callRef.current?.disconnect(); setState("idle"); setActiveContactId(null); }, []);

  return <Ctx.Provider value={{ ready, state, activeContactId, startCall, hangup }}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 2: Montar en `src/components/layout/providers.tsx`.** El provider necesita el `userId`. `providers.tsx` está dentro de `SessionProvider`; usar `useSession` requeriría que `Providers` sea client (ya lo es). Envolver children con `<VoiceDeviceProvider userId={...}>`. Como `Providers` no tiene la sesión a mano sin un hook, crear un pequeño wrapper client que lea `useSession`:
```tsx
// dentro de providers.tsx, debajo de los imports
"use client";
import { useSession } from "next-auth/react";
import { VoiceDeviceProvider } from "@/components/voice/voice-device-provider";

function VoiceWithSession({ children }: { children: React.ReactNode }) {
  const { data } = useSession();
  return <VoiceDeviceProvider userId={(data?.user as { id?: string })?.id}>{children}</VoiceDeviceProvider>;
}
```
y envolver: dentro de `<ThemeProvider>`, cambiar `{children}` por `<VoiceWithSession>{children}</VoiceWithSession>`. (Mantener el resto igual.)

- [ ] **Step 3: Verificar build**
Run: `npx tsc --noEmit -p tsconfig.json` → sin errores. (Si `@twilio/voice-sdk` no exporta `type Call`, importar `Call` sin `type` o usar `ReturnType`.)
Run: `npm run build` → compila (el provider es client, no rompe SSR porque todo va en useEffect).

- [ ] **Step 4: Commit**
```bash
git add src/components/voice/voice-device-provider.tsx src/components/layout/providers.tsx
git commit -m "feat(call): VoiceDeviceProvider (SDK browser) montado en providers"
```

> No hay test unitario (SDK de browser). Se valida con build + smoke manual de Luis.

---

## Task 7: Botón "Llamar" + picklist outcome + link grabación

**Files:**
- Create: `src/components/voice/call-button.tsx`
- Modify: `src/components/activities/activity-log.tsx`
- Modify: `src/components/activities/activity-log-form.tsx`

- [ ] **Step 1: Crear `src/components/voice/call-button.tsx`:**
```tsx
"use client";
import { Phone, PhoneOff } from "lucide-react";
import { useVoice } from "./voice-device-provider";

export function CallButton({ phone, contactId, userId, doNotContact }: { phone: string; contactId: string; userId: string; doNotContact?: boolean }) {
  const voice = useVoice();
  if (!voice?.ready) return null; // Twilio no configurado / Device no listo
  const busy = voice.state !== "idle" && voice.activeContactId === contactId;
  if (doNotContact) {
    return <button className="btn-secondary text-[13px]" disabled title="Contacto marcado No contactar"><Phone className="h-3.5 w-3.5" /> Llamar</button>;
  }
  if (busy) {
    return <button className="btn-secondary text-[13px]" onClick={() => voice.hangup()}><PhoneOff className="h-3.5 w-3.5" /> {voice.state === "in-call" ? "Colgar" : "Cancelar"}</button>;
  }
  return <button className="btn-secondary text-[13px]" onClick={() => voice.startCall(phone, contactId, userId)}><Phone className="h-3.5 w-3.5" /> Llamar</button>;
}
```

- [ ] **Step 2: Insertar el botón en `activity-log.tsx`.** En la fila de acciones del encabezado (junto a "Enviar email"/"Registrar actividad"), añadir. El componente ya recibe `contactId`; necesita `phone`, `userId` y `doNotContact`. Añadir a `ActivityLogProps`: `contactPhone?: string; doNotContact?: boolean; currentUserId: string`. Render:
```tsx
{contactPhone && (
  <CallButton phone={contactPhone} contactId={contactId} userId={currentUserId} doNotContact={doNotContact} />
)}
```
Importar `CallButton`. Pasar las nuevas props desde `contact-detail.tsx` y `deal-detail-client.tsx` (el teléfono del contacto, `doNotContact`, y el `userId` de la sesión — que ya disponen para otras cosas; si no, leerlo de `useSession`).

- [ ] **Step 3: `outcome` como picklist para CALL en `activity-log-form.tsx`.** Donde hoy el campo "Resultado" es `<input>`, cuando `activityType` es `CALL_OUTBOUND`/`CALL_INBOUND` renderizar un `<select>` con `CALL_OUTCOMES`:
```tsx
import { CALL_OUTCOMES } from "@/lib/twilio/call-outcomes";
// ...
{isCall ? (
  <select className="form-input text-[13px]" value={outcome ?? ""} onChange={(e) => setOutcome(e.target.value)}>
    <option value="">Resultado…</option>
    {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
) : (
  <input className="form-input text-[13px]" value={outcome ?? ""} onChange={(e) => setOutcome(e.target.value)} placeholder="Resultado de la actividad…" maxLength={1000} />
)}
```
donde `const isCall = activityType === "CALL_OUTBOUND" || activityType === "CALL_INBOUND";`.

- [ ] **Step 4: Link "Escuchar grabación" en `activity-log.tsx`.** En el render de cada actividad, si `a.recordingUrl`, añadir:
```tsx
{a.recordingUrl && (
  <a href={a.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] underline" style={{ color: "var(--text-secondary)" }}>Escuchar grabación</a>
)}
```
Añadir `recordingUrl?: string | null` al tipo de actividad que el componente consume (y al `select`/shape del endpoint `/api/activities` si filtra campos; si hace `select *` o incluye todo, no hace falta).

- [ ] **Step 5: Verificar**
Run: `npx tsc --noEmit -p tsconfig.json` → sin errores.
Run: `npm run build` → compila.

- [ ] **Step 6: Commit**
```bash
git add src/components/voice/call-button.tsx src/components/activities/activity-log.tsx src/components/activities/activity-log-form.tsx src/components/contacts/contact-detail.tsx "src/components/deals/deal-detail-client.tsx"
git commit -m "feat(call): botón Llamar + picklist de resultado + link a grabación"
```

---

## Task 8: Verificación final + gate de migración

- [ ] **Step 1: Suite + build**
Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: tests verdes, tipos limpios, build OK.

- [ ] **Step 2: Pedir a Luis aplicar la migración**
> "Listo para aplicar `prisma/migrations-manual/2026-06-18-click-to-call.sql` a `oaijxdpevakashxshhvm` (aditiva: `activities.callSid`+`recordingUrl`, índice único parcial, `LeadSource += LLAMADA_ENTRANTE`). El `ALTER TYPE ADD VALUE` se corre aparte. ¿Autorizas 'aplica la migración click-to-call'?"
Tras aplicar: `npx prisma generate` + re-`npm run build`.

- [ ] **Step 3: Prerequisitos de Luis (Twilio) — documentar:**
  - Cuenta Twilio + número de voz con permisos MX.
  - **TwiML App**: Voice Request URL → `https://crm.propyte.com/api/webhooks/twilio/voice/twiml`; status callback → `…/voice/status`.
  - Número entrante: Voice webhook → `…/voice/incoming`.
  - **API Key/Secret** para Access Tokens.
  - Env (Hostinger + local): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_TWIML_APP_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `NEXT_PUBLIC_APP_URL`.

- [ ] **Step 4: Smoke (tras config Twilio, lo hace Luis):** abrir CRM (concede micrófono) → "Llamar" en un contacto → escuchar aviso → contestar en el otro teléfono → colgar → ver `Activity(CALL_OUTBOUND)` con duración + elegir resultado + aparece "Escuchar grabación". Llamar al número Twilio desde fuera → suena en el browser del asesor asignado; si offline → buzón crea `Activity(CALL_INBOUND, Buzón)` con grabación.

---

## Self-Review (cobertura del spec)
- §3 Datos (callSid/recordingUrl/LLAMADA_ENTRANTE/outcome picklist) → Task 1,7. ✓
- §4 Saliente (token, connect, TwiML crea Activity, aviso+record) → Task 2,3,6,7. ✓
- §5 Entrante (match/captureLead, Dial Client, buzón) → Task 5. ✓
- §6 Auto-log (status por callSid, recording) → Task 2,4. ✓
- §7 UI (botón, picklist, link grabación, Device global) → Task 6,7. ✓
- §8 Compliance (aviso bilingüe, doNotContact) → Task 3,7. ✓
- §9 Testing → tests server por task (UI WebRTC = smoke manual). ✓
- §10 Prerequisitos → Task 8. ✓

**Notas:** (a) `initiateCall`/`/api/twilio/call` quedan inertes en v1 (WebRTC usa el SDK) — no se borran, fuera de alcance. (b) Tasks 6-7 (WebRTC/UI) no tienen test unitario por depender del SDK de browser; se cubren con build + smoke manual. (c) Nombres de env alineados al código existente (`TWILIO_API_KEY_SID/SECRET`), no a los del spec §10 — actualizar el spec si se quiere paridad exacta.
