# Centro de Conexiones Multicuenta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un Centro de Conexiones en `/conexiones` donde un admin conecte (modo asistido, wizard) múltiples cuentas por plataforma y jale (PULL) sus leads al CRM, reutilizando la tubería existente.

**Architecture:** Registro config-driven de proveedores (`lib/connectors/registry.ts`) que alimenta UI y servidor. Página por-plataforma (layout A) + wizard de conexión que valida la credencial contra la API real (`POST /api/admin/connectors/test`) antes de activar. Adapters de pull nuevos para Google Ads (webhook Lead Form) y LinkedIn (cron Lead Gen Forms); Meta/IG y TikTok ya jalan. Todo lead nuevo entra por `processIncomingLead` → `captureLead` → ruteo/SLA (sin cambios).

**Tech Stack:** Next.js 14 (App Router), Prisma + Supabase PostgreSQL (`oaijxdpevakashxshhvm`, schema `propyte_crm`), zod, vitest, AES-256-GCM (`lib/crypto`), shadcn/ui + clases B/N propias (`form-input`/`btn-primary`/`badge`).

---

## Convenciones del repo (leer antes de empezar)

- **Tests:** `npx vitest run <ruta>` (un archivo) · `npm run build` (verde obligatorio antes de cerrar fase).
- **Rutas dinámicas:** este repo usa `params` **SÍNCRONO** (no `Promise<params>`).
- **Migraciones:** SQL aditivo en `prisma/migrations-manual/`. **NO aplicar a la BD compartida sin que Luis diga "aplica la migración …".** `ALTER TYPE … ADD VALUE` corre fuera de transacción y antes de usar el valor.
- **Crypto/credenciales:** `writeCredentials(obj)` cifra, `readCredentials<T>(connector)` descifra. NUNCA devolver credenciales al cliente. NUNCA loguear el objeto de error completo (puede llevar secretos) — loguear solo `e.message`.
- **Git autoría:** commits deben quedar como `Propyte-Luis` (el repo se ensucia a WebKoi). Verificar `git config user.email` antes de commitear.
- **Crons Hostinger:** header `x-cron-secret` (NO `Authorization: Bearer` — el CDN lo stripea).

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `prisma/migrations-manual/2026-06-19-conexiones-multicuenta.sql` | Enum `ConnectorProvider += GOOGLE_ADS/YOUTUBE/PINTEREST`; `LeadSource += GOOGLE_ADS` si falta | Crear |
| `prisma/schema.prisma` | Reflejar enum nuevos | Modificar |
| `src/lib/connectors/registry.ts` | Definición config-driven de proveedores (campos, pasos wizard, tipo de pull/test) | Crear |
| `src/lib/connectors/registry.test.ts` | Tests del registro | Crear |
| `src/lib/connectors/test-connection.ts` | Validar credenciales contra la API real por proveedor | Crear |
| `src/lib/connectors/test-connection.test.ts` | Tests del validador (fetch mockeado) | Crear |
| `src/app/api/admin/connectors/test/route.ts` | Endpoint `POST` que invoca `test-connection` | Crear |
| `src/app/api/admin/connectors/route.ts` | Aceptar nuevos providers en el enum del `createSchema` | Modificar |
| `src/lib/validations/rebuild-f1.ts` | Schemas de credenciales Google Ads + LinkedIn | Modificar |
| `src/app/conexiones/page.tsx` | Página server, layout A (secciones por plataforma) | Crear |
| `src/components/conexiones/connections-view.tsx` | Cliente: secciones, filas de cuenta, acciones | Crear |
| `src/components/conexiones/connect-wizard.tsx` | Drawer guiado por pasos (variante A) | Crear |
| `src/app/api/connectors/google/webhook/route.ts` | Pull Google Ads Lead Form (webhook) | Crear |
| `src/app/api/cron/connectors/linkedin/route.ts` | Pull LinkedIn Lead Gen Forms (cron) | Crear |
| `src/app/api/connectors/google/webhook/route.test.ts` | Test parser Google Lead Form | Crear |
| `src/components/layout/sidebar.tsx` | Entrada "Conexiones" en grupo admin | Modificar |
| `src/components/admin/integrations-tab.tsx` | Reemplazar `ConnectorsSection` por enlace a `/conexiones` | Modificar |

---

## Task 1: Migración aditiva del enum

**Files:**
- Create: `prisma/migrations-manual/2026-06-19-conexiones-multicuenta.sql`
- Modify: `prisma/schema.prisma` (enum `ConnectorProvider`, enum `LeadSource`)

- [ ] **Step 1: Escribir el SQL aditivo**

Create `prisma/migrations-manual/2026-06-19-conexiones-multicuenta.sql`:

```sql
-- Conexiones multicuenta v1 — ADITIVO. ALTER TYPE ADD VALUE fuera de transacción.
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_ADS';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'YOUTUBE';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'PINTEREST';
-- LINKEDIN ya existe en ConnectorProvider.
-- LeadSource: agregar GOOGLE_ADS solo si no existe (LINKEDIN/META_ADS ya existen).
ALTER TYPE "propyte_crm"."LeadSource" ADD VALUE IF NOT EXISTS 'GOOGLE_ADS';
```

- [ ] **Step 2: Reflejar en el schema Prisma**

En `prisma/schema.prisma`, dentro de `enum ConnectorProvider` agregar las líneas `GOOGLE_ADS`, `YOUTUBE`, `PINTEREST` (antes de `CUSTOM`). En `enum LeadSource` agregar `GOOGLE_ADS` si no está presente (revisar primero el bloque del enum; si ya existe, no duplicar).

- [ ] **Step 3: Validar el schema**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 4: Generar cliente**

Run: `npx prisma generate`
Expected: "Generated Prisma Client". (Si Windows bloquea la DLL: parar dev server y reintentar; NO usar `--no-engine` — rompe runtime, ver feedback_prisma_generate_no_engine.)

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations-manual/2026-06-19-conexiones-multicuenta.sql prisma/schema.prisma
git commit -m "feat(conexiones): enum ConnectorProvider +GOOGLE_ADS/YOUTUBE/PINTEREST (aditivo)"
```

> **GATE:** la migración NO se aplica a la BD compartida hasta que Luis diga "aplica la migración conexiones". Hasta entonces, NO crear conectores con los providers nuevos en runtime (el cliente exigiría el valor del enum). Las Tasks 2-6 no dependen de la migración aplicada.

---

## Task 2: Schemas de credenciales Google Ads + LinkedIn

**Files:**
- Modify: `src/lib/validations/rebuild-f1.ts:53-69` (junto a los schemas de credenciales existentes)

- [ ] **Step 1: Escribir el test**

Create `src/lib/validations/connectors-creds.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  connectorCredentialsGoogleAdsSchema,
  connectorCredentialsLinkedInSchema,
} from "./rebuild-f1";

describe("credenciales Google Ads", () => {
  it("acepta credenciales completas", () => {
    const r = connectorCredentialsGoogleAdsSchema.safeParse({
      customerId: "123-456-7890",
      developerToken: "dev",
      refreshToken: "rt",
      clientId: "cid",
      clientSecret: "cs",
      webhookKey: "k12345678",
    });
    expect(r.success).toBe(true);
  });
  it("rechaza si falta customerId", () => {
    const r = connectorCredentialsGoogleAdsSchema.safeParse({ developerToken: "dev" });
    expect(r.success).toBe(false);
  });
});

describe("credenciales LinkedIn", () => {
  it("acepta credenciales completas", () => {
    const r = connectorCredentialsLinkedInSchema.safeParse({
      adAccountId: "509...",
      accessToken: "at",
    });
    expect(r.success).toBe(true);
  });
  it("rechaza vacío", () => {
    expect(connectorCredentialsLinkedInSchema.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/validations/connectors-creds.test.ts`
Expected: FAIL ("connectorCredentialsGoogleAdsSchema is not exported" / undefined).

- [ ] **Step 3: Agregar los schemas**

En `src/lib/validations/rebuild-f1.ts`, después de `connectorCredentialsWebsiteSchema` (línea ~69), agregar:

```ts
export const connectorCredentialsGoogleAdsSchema = z.object({
  customerId: z.string().min(1),       // ID de cliente Google Ads (sin guiones o con ellos)
  developerToken: z.string().min(1),
  refreshToken: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  webhookKey: z.string().min(8),        // "key" compartida del Lead Form webhook
  loginCustomerId: z.string().optional(), // MCC, si aplica
});

export const connectorCredentialsLinkedInSchema = z.object({
  adAccountId: z.string().min(1),
  accessToken: z.string().min(1),
});
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/lib/validations/connectors-creds.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/rebuild-f1.ts src/lib/validations/connectors-creds.test.ts
git commit -m "feat(conexiones): schemas de credenciales Google Ads y LinkedIn"
```

---

## Task 3: Registro config-driven de proveedores

**Files:**
- Create: `src/lib/connectors/registry.ts`
- Test: `src/lib/connectors/registry.test.ts`

- [ ] **Step 1: Escribir el test**

Create `src/lib/connectors/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PROVIDERS, providerById, pullProviders } from "./registry";

describe("registry de proveedores", () => {
  it("tiene los 7 grupos esperados", () => {
    const ids = PROVIDERS.map((p) => p.id);
    for (const id of ["META", "INSTAGRAM", "TIKTOK", "GOOGLE_ADS", "LINKEDIN", "YOUTUBE", "PINTEREST"]) {
      expect(ids).toContain(id);
    }
  });
  it("YouTube y Pinterest son push-only (pull none)", () => {
    expect(providerById("YOUTUBE")?.pull).toBe("none");
    expect(providerById("PINTEREST")?.pull).toBe("none");
  });
  it("pullProviders excluye los push-only", () => {
    const ids = pullProviders().map((p) => p.id);
    expect(ids).not.toContain("YOUTUBE");
    expect(ids).not.toContain("PINTEREST");
    expect(ids).toContain("META");
  });
  it("cada proveedor con pull declara credFields y al menos un wizardStep", () => {
    for (const p of pullProviders()) {
      expect(p.credFields.length).toBeGreaterThan(0);
      expect(p.wizardSteps.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/connectors/registry.test.ts`
Expected: FAIL ("Cannot find module './registry'").

- [ ] **Step 3: Escribir el registro**

Create `src/lib/connectors/registry.ts`:

```ts
// Registro único de proveedores de conexión. Alimenta UI (panel + wizard) y servidor.
// Agregar una plataforma = agregar una entrada aquí.
export type ProviderGroup = "meta" | "tiktok" | "google" | "linkedin" | "pinterest";
export type PullKind = "webhook" | "cron" | "none"; // none = push-only (v2), deshabilitado para pull
export type TestKind = "meta" | "tiktok" | "googleAds" | "linkedin" | "none";

export interface CredField {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
}
export interface WizardStep {
  title: string;
  body: string;
  link?: string;
}
export interface ProviderDef {
  id: string; // valor del enum ConnectorProvider
  label: string;
  group: ProviderGroup;
  groupLabel: string;
  pull: PullKind;
  testKind: TestKind;
  credFields: CredField[];
  wizardSteps: WizardStep[];
  webhookPath?: string; // si pull === "webhook"
  note?: string;        // ej. para push-only
}

const META_CRED: CredField[] = [
  { key: "pageId", label: "Page ID" },
  { key: "pageAccessToken", label: "Page Access Token (long-lived)", secret: true },
  { key: "appSecret", label: "App Secret", secret: true },
  { key: "verifyToken", label: "Verify Token (lo inventas tú)" },
];

const META_STEPS: WizardStep[] = [
  { title: "Abre tu app de Meta", body: "Entra a tu app y selecciona la página del negocio.", link: "https://developers.facebook.com/apps" },
  { title: "Genera un Page Access Token", body: "Con permiso leads_retrieval (long-lived)." },
  { title: "Pega token, Page ID, App Secret y Verify Token", body: "El Verify Token lo inventas tú; lo pondrás igual en el webhook de Meta." },
  { title: "Prueba y guarda", body: "Validamos el token contra la API y guardamos cifrado." },
];

export const PROVIDERS: ProviderDef[] = [
  {
    id: "META", label: "Facebook · Lead Ads", group: "meta", groupLabel: "Meta",
    pull: "webhook", testKind: "meta", credFields: META_CRED, wizardSteps: META_STEPS,
    webhookPath: "/api/connectors/meta/webhook",
  },
  {
    id: "INSTAGRAM", label: "Instagram · Lead Ads / DM", group: "meta", groupLabel: "Meta",
    pull: "webhook", testKind: "meta", credFields: META_CRED, wizardSteps: META_STEPS,
    webhookPath: "/api/connectors/meta/webhook",
  },
  {
    id: "TIKTOK", label: "TikTok · Lead Gen", group: "tiktok", groupLabel: "TikTok",
    pull: "cron", testKind: "tiktok",
    credFields: [
      { key: "advertiserId", label: "Advertiser ID" },
      { key: "accessToken", label: "Access Token", secret: true },
    ],
    wizardSteps: [
      { title: "Abre TikTok for Business", body: "Entra a tu Business Center.", link: "https://business.tiktok.com" },
      { title: "Obtén Advertiser ID y Access Token", body: "Desde el developer portal de TikTok (app con scope Lead Gen)." },
      { title: "Pega y prueba", body: "Validamos contra la API y guardamos cifrado." },
    ],
  },
  {
    id: "GOOGLE_ADS", label: "Google Ads · Lead Form", group: "google", groupLabel: "Google",
    pull: "webhook", testKind: "googleAds",
    webhookPath: "/api/connectors/google/webhook",
    credFields: [
      { key: "customerId", label: "Customer ID" },
      { key: "developerToken", label: "Developer Token", secret: true },
      { key: "clientId", label: "OAuth Client ID" },
      { key: "clientSecret", label: "OAuth Client Secret", secret: true },
      { key: "refreshToken", label: "Refresh Token", secret: true },
      { key: "webhookKey", label: "Webhook Key (Lead Form)", help: "La 'key' que pones en el Lead Form para firmar el webhook." },
    ],
    wizardSteps: [
      { title: "Crea el Lead Form en Google Ads", body: "En el formulario, define una Webhook URL + Key.", link: "https://ads.google.com" },
      { title: "Pega tus credenciales de API", body: "Customer ID, Developer Token y OAuth (para la validación de la cuenta)." },
      { title: "Pega la Webhook Key", body: "Debe coincidir con la del Lead Form." },
      { title: "Prueba y guarda", body: "Validamos la cuenta y guardamos cifrado." },
    ],
  },
  {
    id: "LINKEDIN", label: "LinkedIn · Lead Gen Forms", group: "linkedin", groupLabel: "LinkedIn",
    pull: "cron", testKind: "linkedin",
    credFields: [
      { key: "adAccountId", label: "Ad Account ID" },
      { key: "accessToken", label: "Access Token", secret: true },
    ],
    wizardSteps: [
      { title: "Abre LinkedIn Campaign Manager", body: "Selecciona la cuenta publicitaria.", link: "https://www.linkedin.com/campaignmanager" },
      { title: "Genera un Access Token", body: "Con scope r_marketing_leadgen_automation." },
      { title: "Pega Ad Account ID y Token", body: "" },
      { title: "Prueba y guarda", body: "Validamos contra la API y guardamos cifrado." },
    ],
  },
  {
    id: "YOUTUBE", label: "YouTube", group: "google", groupLabel: "Google",
    pull: "none", testKind: "none", credFields: [], wizardSteps: [],
    note: "Sin leads propios — se gestiona vía Google Ads. Push de conversiones en v2.",
  },
  {
    id: "PINTEREST", label: "Pinterest", group: "pinterest", groupLabel: "Pinterest",
    pull: "none", testKind: "none", credFields: [], wizardSteps: [],
    note: "Pull de leads limitado. Push de conversiones (Conversions API) en v2.",
  },
];

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
export function pullProviders(): ProviderDef[] {
  return PROVIDERS.filter((p) => p.pull !== "none");
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/lib/connectors/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connectors/registry.ts src/lib/connectors/registry.test.ts
git commit -m "feat(conexiones): registro config-driven de proveedores"
```

---

## Task 4: Validador "Probar conexión"

**Files:**
- Create: `src/lib/connectors/test-connection.ts`
- Test: `src/lib/connectors/test-connection.test.ts`

- [ ] **Step 1: Escribir el test**

Create `src/lib/connectors/test-connection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { testConnection } from "./test-connection";

beforeEach(() => { vi.restoreAllMocks(); });

describe("testConnection · meta", () => {
  it("ok cuando la Graph API devuelve el nombre de la página", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ name: "Propyte BR", id: "123" }), { status: 200 })
    );
    const r = await testConnection("META", { pageId: "123", pageAccessToken: "t", appSecret: "s", verifyToken: "v" });
    expect(r.ok).toBe(true);
    expect(r.accountName).toBe("Propyte BR");
  });
  it("falla con token inválido", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid OAuth token" } }), { status: 400 })
    );
    const r = await testConnection("META", { pageId: "123", pageAccessToken: "bad", appSecret: "s", verifyToken: "v" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Invalid OAuth");
  });
});

describe("testConnection · provider push-only", () => {
  it("rechaza YouTube (no soporta pull)", async () => {
    const r = await testConnection("YOUTUBE", {});
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/lib/connectors/test-connection.test.ts`
Expected: FAIL ("Cannot find module './test-connection'").

- [ ] **Step 3: Implementar el validador**

Create `src/lib/connectors/test-connection.ts`:

```ts
// Valida credenciales contra la API real del proveedor SIN persistir nada.
// Devuelve {ok, accountName?, detail?}. NUNCA loguear el objeto de error completo.
import { providerById } from "./registry";

export interface TestResult {
  ok: boolean;
  accountName?: string;
  detail?: string;
}

export async function testConnection(
  provider: string,
  creds: Record<string, string>
): Promise<TestResult> {
  const def = providerById(provider);
  if (!def || def.testKind === "none") {
    return { ok: false, detail: "Este proveedor no admite conexión de pull en v1." };
  }
  try {
    switch (def.testKind) {
      case "meta": {
        const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(creds.pageId)}?fields=name,id&access_token=${encodeURIComponent(creds.pageAccessToken)}`;
        const res = await fetch(url);
        const data = (await res.json()) as { name?: string; error?: { message?: string } };
        if (!res.ok || data.error) return { ok: false, detail: data.error?.message ?? `HTTP ${res.status}` };
        return { ok: true, accountName: data.name };
      }
      case "tiktok": {
        const res = await fetch(
          `https://business-api.tiktok.com/open_api/v1.3/advertiser/info/?advertiser_ids=%5B%22${encodeURIComponent(creds.advertiserId)}%22%5D`,
          { headers: { "Access-Token": creds.accessToken } }
        );
        const data = (await res.json()) as { code?: number; message?: string; data?: { list?: Array<{ advertiser_name?: string }> } };
        if (data.code !== 0) return { ok: false, detail: data.message ?? `code ${data.code}` };
        return { ok: true, accountName: data.data?.list?.[0]?.advertiser_name };
      }
      case "googleAds": {
        // Validación ligera: refrescar el access token OAuth. Confirma client/refresh válidos.
        const body = new URLSearchParams({
          client_id: creds.clientId, client_secret: creds.clientSecret,
          refresh_token: creds.refreshToken, grant_type: "refresh_token",
        });
        const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
        const data = (await res.json()) as { access_token?: string; error_description?: string };
        if (!res.ok || !data.access_token) return { ok: false, detail: data.error_description ?? `HTTP ${res.status}` };
        return { ok: true, accountName: `Customer ${creds.customerId}` };
      }
      case "linkedin": {
        const res = await fetch(
          `https://api.linkedin.com/rest/adAccounts/${encodeURIComponent(creds.adAccountId)}`,
          { headers: { Authorization: `Bearer ${creds.accessToken}`, "LinkedIn-Version": "202401" } }
        );
        const data = (await res.json()) as { name?: string; message?: string };
        if (!res.ok) return { ok: false, detail: data.message ?? `HTTP ${res.status}` };
        return { ok: true, accountName: data.name ?? `Account ${creds.adAccountId}` };
      }
      default:
        return { ok: false, detail: "Tipo de prueba no soportado." };
    }
  } catch (e) {
    return { ok: false, detail: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/lib/connectors/test-connection.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connectors/test-connection.ts src/lib/connectors/test-connection.test.ts
git commit -m "feat(conexiones): validador Probar conexión por proveedor"
```

---

## Task 5: Endpoint POST /api/admin/connectors/test + ampliar enum del CRUD

**Files:**
- Create: `src/app/api/admin/connectors/test/route.ts`
- Modify: `src/app/api/admin/connectors/route.ts:18` (enum del `createSchema`) y `:24-29` (`credentialsSchemaFor`)

- [ ] **Step 1: Escribir el endpoint de prueba**

Create `src/app/api/admin/connectors/test/route.ts`:

```ts
// Prueba de conexión: valida credenciales contra la API real. NO persiste nada.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { testConnection } from "@/lib/connectors/test-connection";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

const schema = z.object({
  provider: z.string().min(1),
  credentials: z.record(z.string()),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ ok: false, detail: "No autorizado" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, detail: "Datos inválidos" }, { status: 400 });

  const result = await testConnection(parsed.data.provider, parsed.data.credentials);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
```

- [ ] **Step 2: Ampliar el enum del CRUD existente**

En `src/app/api/admin/connectors/route.ts`:
- Línea ~18, cambiar el enum de `provider` a incluir los nuevos:

```ts
  provider: z.enum([
    "META", "TIKTOK", "WEBSITE", "ZAPIER", "MANUAL", "INSTAGRAM", "MESSENGER",
    "GOOGLE_ADS", "LINKEDIN",
  ]),
```

(YouTube/Pinterest NO se aceptan en el CRUD v1: son push-only y no se conectan.)

- En `credentialsSchemaFor` (línea ~24), importar y enrutar los nuevos schemas:

```ts
import {
  connectorCredentialsMetaSchema,
  connectorCredentialsTikTokSchema,
  connectorCredentialsWebsiteSchema,
  connectorCredentialsGoogleAdsSchema,
  connectorCredentialsLinkedInSchema,
} from "@/lib/validations/rebuild-f1";

function credentialsSchemaFor(provider: string) {
  if (provider === "META" || provider === "INSTAGRAM" || provider === "MESSENGER") return connectorCredentialsMetaSchema;
  if (provider === "TIKTOK") return connectorCredentialsTikTokSchema;
  if (provider === "WEBSITE") return connectorCredentialsWebsiteSchema;
  if (provider === "GOOGLE_ADS") return connectorCredentialsGoogleAdsSchema;
  if (provider === "LINKEDIN") return connectorCredentialsLinkedInSchema;
  return z.record(z.string());
}
```

- [ ] **Step 3: Verificar typecheck/build**

Run: `npm run build`
Expected: build exit 0 (sin errores de tipo en las rutas modificadas).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/connectors/test/route.ts src/app/api/admin/connectors/route.ts
git commit -m "feat(conexiones): endpoint Probar conexión + providers Google Ads/LinkedIn en CRUD"
```

---

## Task 6: Wizard de conexión (drawer guiado, variante A)

**Files:**
- Create: `src/components/conexiones/connect-wizard.tsx`

> Componente cliente. Renderiza pasos desde `providerById(provider).wizardSteps` y campos desde `credFields`. Último paso: "Probar conexión" (`POST /test`) → si ok, "Guardar y activar" (`POST /api/admin/connectors` + `PATCH :id {status:ACTIVE}`). Usa clases B/N del repo (`form-input`, `btn-primary`, `btn-secondary`).

- [ ] **Step 1: Implementar el wizard**

Create `src/components/conexiones/connect-wizard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { providerById } from "@/lib/connectors/registry";

export function ConnectWizard({
  provider, open, onOpenChange, onConnected,
}: {
  provider: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: () => void;
}) {
  const def = providerById(provider);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState<string>("");

  if (!def) return null;
  const lastStep = def.wizardSteps.length - 1;
  const isLast = step === lastStep;

  async function probar() {
    setTestState("testing"); setMsg("");
    const res = await fetch("/api/admin/connectors/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, credentials: creds }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) { setTestState("ok"); setMsg(data.accountName ? `Conectado: ${data.accountName}` : "Conexión válida"); }
    else { setTestState("fail"); setMsg(data.detail ?? "No se pudo validar"); }
  }

  async function guardar() {
    const create = await fetch("/api/admin/connectors", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || def.label, provider, credentials: creds }),
    });
    if (!create.ok) { setMsg("Error al guardar"); return; }
    const { data } = await create.json();
    await fetch(`/api/admin/connectors/${data.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    reset(); onConnected(); onOpenChange(false);
  }

  function reset() { setStep(0); setName(""); setCreds({}); setTestState("idle"); setMsg(""); }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar cuenta · {def.label}</DialogTitle>
        </DialogHeader>

        <div className="text-[11px] font-mono text-muted-foreground">{step + 1}/{def.wizardSteps.length}</div>
        <div className="mt-1">
          <h4 className="text-sm font-semibold">{def.wizardSteps[step].title}</h4>
          <p className="mt-1 text-[12px] text-muted-foreground">{def.wizardSteps[step].body}</p>
          {def.wizardSteps[step].link && (
            <a href={def.wizardSteps[step].link} target="_blank" rel="noreferrer" className="text-[12px] underline">
              Abrir →
            </a>
          )}
        </div>

        {isLast && (
          <div className="mt-3 space-y-2">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Nombre de la cuenta</label>
              <input className="form-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={def.label} />
            </div>
            {def.credFields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</label>
                <input
                  className="form-input w-full"
                  type={f.secret ? "password" : "text"}
                  value={creds[f.key] ?? ""}
                  onChange={(e) => { setCreds({ ...creds, [f.key]: e.target.value }); setTestState("idle"); }}
                />
                {f.help && <p className="text-[10px] text-muted-foreground">{f.help}</p>}
              </div>
            ))}
            {msg && <p className={`text-[12px] ${testState === "ok" ? "text-green-700" : "text-destructive"}`}>{msg}</p>}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button className="btn-secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>← Atrás</button>
          {!isLast ? (
            <button className="btn-primary" onClick={() => setStep((s) => Math.min(lastStep, s + 1))}>Siguiente →</button>
          ) : testState !== "ok" ? (
            <button className="btn-primary" onClick={probar} disabled={testState === "testing"}>
              {testState === "testing" ? "Probando…" : "Probar conexión"}
            </button>
          ) : (
            <button className="btn-primary" onClick={guardar}>Guardar y activar</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build exit 0. (Si `form-input`/`btn-primary` no existieran como clases globales, usar las equivalentes del repo — verificar en `globals.css`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/conexiones/connect-wizard.tsx
git commit -m "feat(conexiones): wizard de conexión guiado (variante A)"
```

---

## Task 7: Página /conexiones + vista por plataforma (layout A)

**Files:**
- Create: `src/app/conexiones/page.tsx`
- Create: `src/components/conexiones/connections-view.tsx`

- [ ] **Step 1: Página server (carga + guard de rol)**

Create `src/app/conexiones/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { ConnectionsView } from "@/components/conexiones/connections-view";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

export default async function ConexionesPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.user.role)) redirect("/dashboard");

  const connectors = await prisma.leadConnector.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, provider: true, status: true,
      lastLeadAt: true, errorCount: true, lastError: true,
      _count: { select: { leadLogs: true } },
    },
  });

  return <ConnectionsView initial={connectors.map((c) => ({ ...c, lastLeadAt: c.lastLeadAt?.toISOString() ?? null }))} />;
}
```

- [ ] **Step 2: Vista cliente (secciones por plataforma)**

Create `src/components/conexiones/connections-view.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { PROVIDERS, type ProviderGroup } from "@/lib/connectors/registry";
import { ConnectWizard } from "./connect-wizard";

interface Conn {
  id: string; name: string; provider: string; status: string;
  lastLeadAt: string | null; errorCount: number; lastError: string | null;
  _count: { leadLogs: number };
}

const STATUS_DOT: Record<string, string> = { ACTIVE: "bg-green-600", PAUSED: "bg-neutral-300", ERROR: "bg-red-600" };
const GROUP_ORDER: ProviderGroup[] = ["meta", "tiktok", "google", "linkedin", "pinterest"];

export function ConnectionsView({ initial }: { initial: Conn[] }) {
  const [connectors, setConnectors] = useState<Conn[]>(initial);
  const [wizardProvider, setWizardProvider] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/admin/connectors");
    if (res.ok) setConnectors((await res.json()).data ?? []);
  }, []);

  async function toggle(c: Conn) {
    await fetch(`/api/admin/connectors/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: c.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }),
    });
    reload();
  }
  async function remove(c: Conn) {
    if (!confirm(`¿Eliminar conexión "${c.name}"?`)) return;
    await fetch(`/api/admin/connectors/${c.id}`, { method: "DELETE" });
    reload();
  }

  // Agrupa proveedores por group, conservando el orden del registro.
  const byGroup = GROUP_ORDER.map((g) => ({
    group: g,
    label: PROVIDERS.find((p) => p.group === g)?.groupLabel ?? g,
    providers: PROVIDERS.filter((p) => p.group === g),
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Admin</p>
        <h1 className="text-[28px] font-semibold tracking-tight">Conexiones</h1>
        <p className="mt-1 text-sm text-muted-foreground">Conecta tus cuentas para jalar leads al CRM. Multicuenta por plataforma.</p>
      </header>

      {byGroup.map((grp) => (
        <section key={grp.group} className="mb-8">
          <h2 className="border-t border-foreground pt-2 text-[12px] font-semibold uppercase tracking-wide">{grp.label}</h2>
          {grp.providers.map((p) => {
            const accounts = connectors.filter((c) => c.provider === p.id);
            const pushOnly = p.pull === "none";
            return (
              <div key={p.id} className="mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium">{p.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {pushOnly ? "push-only · v2" : `${accounts.filter((a) => a.status === "ACTIVE").length}/${accounts.length}`}
                  </span>
                </div>

                {pushOnly ? (
                  <p className="mt-1 rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">{p.note}</p>
                ) : (
                  <>
                    {accounts.map((c) => (
                      <div key={c.id} className="mt-1.5 flex items-center justify-between rounded-md border p-2 text-[12px]">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[c.status] ?? "bg-neutral-300"}`} />
                          <span className="truncate">{c.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {c._count.leadLogs} · {c.lastLeadAt ? new Date(c.lastLeadAt).toLocaleDateString("es-MX") : "—"}
                          </span>
                          <button className="text-[11px] underline" onClick={() => toggle(c)}>{c.status === "ACTIVE" ? "Pausar" : "Activar"}</button>
                          <button className="text-[11px] text-destructive underline" onClick={() => remove(c)}>Eliminar</button>
                        </span>
                      </div>
                    ))}
                    {accounts.some((c) => c.lastError) && (
                      <p className="mt-1 truncate text-[11px] text-destructive">
                        {accounts.find((c) => c.lastError)?.lastError}
                      </p>
                    )}
                    <button
                      className="mt-1.5 w-full rounded-md border border-dashed p-2 text-left text-[12px] text-muted-foreground hover:text-foreground"
                      onClick={() => setWizardProvider(p.id)}
                    >
                      ＋ Conectar cuenta
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {wizardProvider && (
        <ConnectWizard
          provider={wizardProvider}
          open={!!wizardProvider}
          onOpenChange={(v) => { if (!v) setWizardProvider(null); }}
          onConnected={reload}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build exit 0; ruta `/conexiones` aparece en el output.

- [ ] **Step 4: Commit**

```bash
git add src/app/conexiones/page.tsx src/components/conexiones/connections-view.tsx
git commit -m "feat(conexiones): página /conexiones con secciones por plataforma (layout A)"
```

---

## Task 8: Navegación — sidebar + retiro de ConnectorsSection de Integraciones

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/admin/integrations-tab.tsx`

- [ ] **Step 1: Agregar entrada al sidebar**

En `src/components/layout/sidebar.tsx`, localizar el grupo de navegación admin (donde están entradas como Configuración / Integraciones) y agregar un item:

```tsx
{ href: "/conexiones", label: "Conexiones", icon: Plug, roles: ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"] },
```

Importar `Plug` de `lucide-react` (agregar al import existente de iconos). Respetar la firma exacta de los items vecinos (este snippet asume `{href,label,icon,roles}` — ajustar a la estructura real del archivo: revisar 2-3 items existentes y copiar su forma).

- [ ] **Step 2: Reemplazar ConnectorsSection por enlace**

En `src/components/admin/integrations-tab.tsx`, sustituir el render de `<ConnectorsSection />` por una tarjeta-enlace (conservar el resto del tab — Zoho/Google Workspace/API keys NO se tocan):

```tsx
// import { ConnectorsSection } from "./connectors-section";  // ← eliminar este import
import Link from "next/link";

// donde estaba <ConnectorsSection />:
<div className="rounded-lg border p-4">
  <h3 className="text-sm font-semibold">Conectores de Leads</h3>
  <p className="mt-1 text-[12px] text-muted-foreground">
    Gestiona tus cuentas de redes y ads (multicuenta) en el nuevo Centro de Conexiones.
  </p>
  <Link href="/conexiones" className="mt-2 inline-block text-[12px] underline">Ir a Conexiones →</Link>
</div>
```

Dejar `connectors-section.tsx` en el repo (huérfano, candidato a borrar después) para no romper otros imports inadvertidos; verificar con grep que nadie más lo importe.

- [ ] **Step 3: Verificar que nadie más importa ConnectorsSection**

Run (Grep tool): patrón `ConnectorsSection` en `src/`.
Expected: solo su definición y, si acaso, el import ya retirado. Si hay otro consumidor, actualizarlo igual.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/admin/integrations-tab.tsx
git commit -m "feat(conexiones): entrada de sidebar + Integraciones enlaza a /conexiones"
```

---

## Task 9: Adapter de pull — LinkedIn Lead Gen Forms (cron)

**Files:**
- Create: `src/app/api/cron/connectors/linkedin/route.ts`

> Modelado sobre el cron de TikTok (`src/app/api/cron/connectors/tiktok/route.ts`). Trae lead forms responses por ad account desde `lastSyncAt`, mapea y entra por `processIncomingLead`.

- [ ] **Step 1: Implementar el cron**

Create `src/app/api/cron/connectors/linkedin/route.ts`:

```ts
// Pull de LinkedIn Lead Gen Forms — agendar en Hostinger CADA 15 MIN:
//   curl -s -H "x-cron-secret: $CRON_SECRET" https://crm.propyte.com/api/cron/connectors/linkedin
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { readCredentials, mapExternalFields, processIncomingLead } from "@/lib/intake/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface LinkedInCredentials { adAccountId: string; accessToken: string; }

interface LIResponse {
  id: string;
  submittedAt?: number;
  formResponse?: { answers?: Array<{ questionId?: string; answer?: { textQuestionAnswer?: { value?: string } } }> };
  // Forma simplificada; el parser real depende del shape de la API de leadFormResponses.
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided = req.headers.get("x-cron-secret")?.trim() ?? req.nextUrl.searchParams.get("key")?.trim();
  if (!secret || provided !== secret) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const connectors = await prisma.leadConnector.findMany({
    where: { provider: "LINKEDIN", status: "ACTIVE", deletedAt: null },
  });

  const summary: Record<string, unknown>[] = [];
  for (const connector of connectors) {
    const creds = readCredentials<LinkedInCredentials>(connector);
    if (!creds?.adAccountId || !creds.accessToken) {
      summary.push({ connector: connector.name, error: "Credenciales incompletas" });
      continue;
    }
    const since = connector.lastSyncAt ?? new Date(Date.now() - 24 * 3_600_000);
    try {
      const url = `https://api.linkedin.com/rest/leadFormResponses?q=owner&owner=(sponsoredAccount:urn:li:sponsoredAccount:${encodeURIComponent(creds.adAccountId)})&submittedAtTimeRange=(start:${since.getTime()})`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${creds.accessToken}`, "LinkedIn-Version": "202401", "X-Restli-Protocol-Version": "2.0.0" },
      });
      if (!res.ok) throw new Error(`LinkedIn API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { elements?: LIResponse[] };
      const responses = data.elements ?? [];

      let processed = 0;
      for (const r of responses) {
        const external: Record<string, unknown> = {};
        for (const a of r.formResponse?.answers ?? []) {
          const q = a.questionId;
          const v = a.answer?.textQuestionAnswer?.value;
          if (q && v) external[q] = v;
        }
        const defaultMap: Record<string, string> = {
          FIRST_NAME: "firstName", LAST_NAME: "lastName",
          EMAIL: "email", PHONE_NUMBER: "phone",
        };
        const fieldMap = { ...defaultMap, ...((connector.fieldMap ?? {}) as Record<string, string>) };
        const mapped = mapExternalFields(fieldMap, external);
        if (!mapped.source) mapped.source = "LINKEDIN";
        const result = await processIncomingLead(connector.id, r.id, { external, linkedin: r }, mapped);
        if (result.status !== "ALREADY_PROCESSED") processed++;
      }
      await prisma.leadConnector.update({ where: { id: connector.id }, data: { lastSyncAt: new Date() } });
      summary.push({ connector: connector.name, responses: responses.length, processed });
    } catch (err) {
      const detail = String(err instanceof Error ? err.message : err).slice(0, 500);
      await prisma.leadConnector.update({
        where: { id: connector.id }, data: { errorCount: { increment: 1 }, lastError: detail },
      });
      summary.push({ connector: connector.name, error: detail });
    }
  }
  return NextResponse.json({ ok: true, connectors: summary });
}
```

> **Nota para el implementador:** la URL/shape exacta de `leadFormResponses` debe verificarse contra la doc vigente de LinkedIn Marketing API (usar context7/WebFetch). El patrón de idempotencia (`r.id` como `externalLeadId`) y el flujo (`mapExternalFields`→`processIncomingLead`) es lo que NO cambia.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build exit 0; ruta `/api/cron/connectors/linkedin` en el output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/connectors/linkedin/route.ts
git commit -m "feat(conexiones): pull LinkedIn Lead Gen Forms (cron 15 min)"
```

---

## Task 10: Adapter de pull — Google Ads Lead Form (webhook)

**Files:**
- Create: `src/app/api/connectors/google/webhook/route.ts`
- Test: `src/app/api/connectors/google/webhook/route.test.ts`

> Google envía un POST JSON por cada lead del Lead Form, con `lead_id`, `google_key` (debe coincidir con la `webhookKey` cifrada del conector) y `user_column_data` (array de `{column_id, string_value}`).

- [ ] **Step 1: Escribir el test del parser**

Create `src/app/api/connectors/google/webhook/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseGoogleLeadForm } from "./route";

describe("parseGoogleLeadForm", () => {
  it("extrae campos por column_id", () => {
    const payload = {
      lead_id: "abc",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Ana López" },
        { column_id: "EMAIL", string_value: "ana@x.com" },
        { column_id: "PHONE_NUMBER", string_value: "+52 998 123 4567" },
      ],
    };
    const { externalLeadId, external } = parseGoogleLeadForm(payload);
    expect(externalLeadId).toBe("abc");
    expect(external.FULL_NAME).toBe("Ana López");
    expect(external.EMAIL).toBe("ana@x.com");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/app/api/connectors/google/webhook/route.test.ts`
Expected: FAIL ("parseGoogleLeadForm is not exported").

- [ ] **Step 3: Implementar el webhook**

Create `src/app/api/connectors/google/webhook/route.ts`:

```ts
// Webhook de Google Ads Lead Form. Google POSTea un lead por submission.
// Seguridad: google_key debe coincidir con la webhookKey cifrada del conector.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { readCredentials, mapExternalFields, processIncomingLead } from "@/lib/intake/connectors";

export const dynamic = "force-dynamic";

interface GoogleLeadPayload {
  lead_id?: string;
  google_key?: string;
  api_version?: string;
  form_id?: number | string;
  campaign_id?: number | string;
  user_column_data?: Array<{ column_id?: string; string_value?: string }>;
}

export function parseGoogleLeadForm(payload: GoogleLeadPayload): {
  externalLeadId: string;
  external: Record<string, unknown>;
} {
  const external: Record<string, unknown> = {};
  for (const f of payload.user_column_data ?? []) {
    if (f.column_id && f.string_value != null) external[f.column_id] = f.string_value;
  }
  return { externalLeadId: String(payload.lead_id ?? ""), external };
}

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as GoogleLeadPayload | null;
  if (!payload?.lead_id || !payload.google_key) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // Encuentra el conector GOOGLE_ADS cuya webhookKey coincide (descifrando cada uno).
  const connectors = await prisma.leadConnector.findMany({
    where: { provider: "GOOGLE_ADS", status: "ACTIVE", deletedAt: null },
  });
  const connector = connectors.find(
    (c) => readCredentials<{ webhookKey?: string }>(c)?.webhookKey === payload.google_key
  );
  if (!connector) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { externalLeadId, external } = parseGoogleLeadForm(payload);
  const defaultMap: Record<string, string> = {
    FULL_NAME: "fullName", FIRST_NAME: "firstName", LAST_NAME: "lastName",
    EMAIL: "email", PHONE_NUMBER: "phone",
  };
  const fieldMap = { ...defaultMap, ...((connector.fieldMap ?? {}) as Record<string, string>) };
  const mapped = mapExternalFields(fieldMap, external);
  if (!mapped.source) mapped.source = "GOOGLE_ADS";

  const result = await processIncomingLead(connector.id, externalLeadId, { external, google: payload }, mapped);
  return NextResponse.json({ ok: true, status: result.status });
}
```

> **Nota:** `source: "GOOGLE_ADS"` requiere que el valor exista en el enum `LeadSource` (Task 1). Si la migración aún no se aplicó en la BD donde corre esto, el lead caería a ERROR; por eso el webhook se activa tras aplicar la migración.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/app/api/connectors/google/webhook/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Verificar build**

Run: `npm run build`
Expected: build exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/connectors/google/webhook/route.ts src/app/api/connectors/google/webhook/route.test.ts
git commit -m "feat(conexiones): pull Google Ads Lead Form (webhook)"
```

---

## Task 11: Suite completa + smoke E2E (lo valida Luis)

- [ ] **Step 1: Toda la suite verde**

Run: `npx vitest run`
Expected: todos los tests pasan (los nuevos + los ~158 existentes).

- [ ] **Step 2: Build limpio**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Checklist E2E (manual, requiere credenciales vivas — lo hace Luis)**

Documentar en `docs/qa/conexiones-smoke.md`:
1. Login admin → `/conexiones` carga con las 5 secciones (Meta, TikTok, Google, LinkedIn, Pinterest); YouTube/Pinterest muestran "push-only · v2".
2. "Conectar cuenta" en Facebook → wizard de 4 pasos → pegar credenciales → "Probar conexión" verde (nombre de página) → "Guardar y activar" → la cuenta aparece con dot verde.
3. (Tras aplicar migración + configurar webhook en Meta) un lead de prueba del formulario aparece como contacto nuevo, ruteado.
4. Pausar/Activar/Eliminar una cuenta funciona.

- [ ] **Step 4: Commit del checklist**

```bash
git add docs/qa/conexiones-smoke.md
git commit -m "docs(conexiones): checklist de smoke E2E"
```

---

## Gate de activación (PENDIENTE Luis — fuera del código)

1. **Aplicar la migración** `2026-06-19-conexiones-multicuenta.sql` a `oaijxdpevakashxshhvm` (autorización explícita) + `npx prisma generate`.
2. **Crons Hostinger:** `*/15 * * * *` → `/api/cron/connectors/linkedin` (header `x-cron-secret`, mismo `CRON_SECRET`).
3. **Webhooks por plataforma:**
   - Meta: callback `/api/connectors/meta/webhook` (ya existe) por cada página.
   - Google Ads: en cada Lead Form, Webhook URL `https://crm.propyte.com/api/connectors/google/webhook` + Key = `webhookKey` del conector.
4. **Permisos/apps por plataforma:** `leads_retrieval` (Meta), Lead Gen (TikTok), Lead Form + OAuth (Google Ads), `r_marketing_leadgen_automation` (LinkedIn).
5. **Merge → auto-deploy Hostinger.**

## Notas de evolución (v2, ya cableado para soportarse)

- **Push CAPI:** reusar `lib/capi/adapters.ts` con `LeadConnector.direction = OUTBOUND` por cuenta.
- **OAuth de un clic:** los tokens (access/refresh/expiry) caben en `credentials` cifrado o en un modelo hermano `ConnectorOAuthToken` (espejo de `GoogleOAuthToken`). No requiere rehacer `LeadConnector`. Cada `ProviderDef` ganaría un modo `connect: "oauth"` que cambia el wizard por un botón de redirección.
- **YouTube/Pinterest pull real** si las plataformas habilitan lead retrieval útil.
```
