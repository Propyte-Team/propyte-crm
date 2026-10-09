# Marcas del agente: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans, para implementar el plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que el agente del CRM responda por marca según la cuenta por la que entra la conversación (presentación, conocimiento, catálogo, canales, tono, playbook, historial y responsable de marketing), que cada lead quede atribuido a su marca y que WhatsApp se pueda dar de alta y probar desde Conexiones. Todo para N marcas, sin código por marca.

**Arquitectura:**
- Tabla `brands` con una fila predeterminada ("Propyte") y la columna `lead_connectors.brandId`, que puede quedar vacía.
- `src/lib/brands/` resuelve la marca de una cuenta. Solo una marca **no predeterminada** activa el camino nuevo en `bot-respond` y en `ai-actions`.
- Sin marca, o con la predeterminada, el código sigue exactamente el camino de hoy. Una prueba congela el prompt actual para garantizarlo.

**Stack:** Next.js 15 (App Router), Prisma 6 (Postgres/Supabase, schema `propyte_crm`, migraciones manuales en SQL), Vitest, zod, React con componentes `@/components/ui/*`.

**Spec:** `docs/superpowers/specs/2026-10-09-marcas-agente-design.md`. Léela antes de cada tarea; el plan argumenta desde ella.

## Restricciones globales

- Rama: `feat/marcas-agente`. **No incluyas `pnpm-lock.yaml` en ningún commit**: ya está modificado en el árbol y no es parte de esta entrega. Agrega solo los archivos de tu tarea.
- Entorno: Windows. Usa la herramienta PowerShell o Bash del agente. Para correr pruebas: `npx vitest run <ruta>`. Suite completa: `npm test`. Tipos: `npm run typecheck`. Linter: `npm run lint`.
- Idioma: comentarios y textos de UI en español, como el resto del repo. Sigue el estilo del archivo que tocas: comentario arriba explicando el porqué y la fecha `2026-10-09`.
- **Prohibido cambiar columnas de `propyte_crm.users`**: el Hub comparte esa tabla. Las relaciones inversas de Prisma en `User` están permitidas porque no crean columnas.
- **Prohibido aplicar migraciones a la base real.** La migración se escribe aquí y la aplica una persona después.
- **Sin marca o con marca predeterminada, el comportamiento y el prompt deben quedar idénticos byte a byte a hoy.**
- Nunca loguees credenciales ni tokens. En las pruebas, usa valores falsos ("tok-test").
- Las pruebas mockean `@/lib/db`, igual que `src/lib/bot/bot-respond.marketing.test.ts`. No uses base de datos real en pruebas.
- El modelo en Prisma se llama `Brand` (tabla `brands`), y su relación con contactos `ContactBrand` (tabla `contact_brands`).

## Foco de revisión

Estos casos no los cubre ninguna prueba "obvia" y son los que más pueden morder. Cada uno tiene su prueba en la tarea indicada:

1. Una cuenta con `brandId` apuntando a una marca borrada, o ilegible, **no debe** contestar como Propyte (Tarea 5).
2. Un contacto que ya existía (de Propyte) y escribe por una cuenta de otra marca queda en **ambas** marcas, sin cambiar su plaza ni su asesor (Tareas 2 y 7).
3. Lead Ads con **una sola** cuenta META y un `page_id` distinto sigue procesándose, por compatibilidad (Tarea 8).
4. Un webhook de WhatsApp donde la resolución de la cuenta **lanza error** se trata como número desconocido: se ingiere, pero sin respuesta del agente (Tarea 8).
5. Un `enabledChannels` de marca con JSON inválido (no es un arreglo de strings) cae a los canales globales sin reventar (Tareas 2 y 5).

---

### Tarea 1: Esquema Prisma y migración manual

**Archivos:**
- Modificar: `prisma/schema.prisma`: modelos `LeadConnector` (~línea 1534), `Contact`, `User`, `BotPlaybook`; agregar `Brand` y `ContactBrand` después de `LeadConnector`.
- Crear: `prisma/migrations-manual/2026-10-09-brands.sql`

**Interfaces:**
- Produce (para todas las tareas):
  - `prisma.brand`: modelo `Brand` con los campos de abajo.
  - `prisma.contactBrand`: modelo `ContactBrand`.
  - `LeadConnector.brandId: string | null`.

- [ ] **Paso 1: Agregar los modelos al esquema**

Debajo de `model LeadConnector { ... }`, agrega:

```prisma
// Marca comercial (entrega 1 de 3 — spec 2026-10-09-marcas-agente-design.md).
// Exactamente UNA fila con isDefault=true ("Propyte"): las cuentas sin brandId son de
// ella y siguen el camino de siempre del agente. Una marca no predeterminada nace con
// el agente apagado (botEnabled=false) a propósito.
model Brand {
  id                   String          @id @default(uuid())
  name                 String          @unique
  slug                 String          @unique
  isDefault            Boolean         @default(false)
  persona              String?         @db.Text
  knowledge            String?         @db.Text
  developmentIds       String[]        @default([])
  defaultPlaza         Plaza?
  enabledChannels      Json?
  tonePreset           BotTonePreset?
  playbookId           String?
  playbook             BotPlaybook?    @relation("BrandPlaybook", fields: [playbookId], references: [id], onDelete: SetNull)
  marketingOwnerUserId String?
  marketingOwner       User?           @relation("BrandMarketingOwner", fields: [marketingOwnerUserId], references: [id], onDelete: SetNull)
  botEnabled           Boolean         @default(false)
  connectors           LeadConnector[]
  contacts             ContactBrand[]
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt
  deletedAt            DateTime?

  @@map("brands")
  @@schema("propyte_crm")
}

// Marcas por las que llegó un contacto. Un contacto SIN filas pertenece a la marca
// predeterminada (no se rellenan los contactos existentes). Ver src/lib/brands/attach.ts.
model ContactBrand {
  id               String   @id @default(uuid())
  contactId        String
  contact          Contact  @relation(fields: [contactId], references: [id])
  brandId          String
  brand            Brand    @relation(fields: [brandId], references: [id])
  firstConnectorId String?
  createdAt        DateTime @default(now())

  @@unique([contactId, brandId])
  @@index([brandId])
  @@map("contact_brands")
  @@schema("propyte_crm")
}
```

En `model LeadConnector`, después de `lastError`, agrega:

```prisma
  // Marca de la cuenta (2026-10-09). null = marca predeterminada.
  brandId     String?
  brand       Brand?             @relation(fields: [brandId], references: [id])
```

y, antes de `@@map("lead_connectors")`, agrega `@@index([brandId])`.

Relaciones inversas (no crean columnas):
- En `model Contact`: `brands ContactBrand[]`
- En `model User`: `brandsMarketing Brand[] @relation("BrandMarketingOwner")`
- En `model BotPlaybook`: `brands Brand[] @relation("BrandPlaybook")`

- [ ] **Paso 2: Validar y generar el cliente**

Corre: `npx prisma validate` y luego `npx prisma generate`.
Esperado: "The schema at prisma\schema.prisma is valid" y "Generated Prisma Client".

- [ ] **Paso 3: Escribir la migración manual**

Crea `prisma/migrations-manual/2026-10-09-brands.sql`:

```sql
-- Marcas del agente (entrega 1 de 3).
-- Spec: docs/superpowers/specs/2026-10-09-marcas-agente-design.md
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm)
-- ANTES de desplegar el código: Prisma lee lead_connectors."brandId" en cada consulta de
-- cuentas, y sin la columna fallarían TODAS las lecturas de conectores.
--
-- Rollback:
--   ALTER TABLE "propyte_crm"."lead_connectors" DROP COLUMN IF EXISTS "brandId";
--   DROP TABLE IF EXISTS "propyte_crm"."contact_brands";
--   DROP TABLE IF EXISTS "propyte_crm"."brands";

CREATE TABLE IF NOT EXISTS "propyte_crm"."brands" (
  "id"                   TEXT PRIMARY KEY,
  "name"                 TEXT NOT NULL,
  "slug"                 TEXT NOT NULL,
  "isDefault"            BOOLEAN NOT NULL DEFAULT false,
  "persona"              TEXT,
  "knowledge"            TEXT,
  "developmentIds"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "defaultPlaza"         "propyte_crm"."Plaza",
  "enabledChannels"      JSONB,
  "tonePreset"           "propyte_crm"."BotTonePreset",
  "playbookId"           TEXT,
  "marketingOwnerUserId" TEXT,
  "botEnabled"           BOOLEAN NOT NULL DEFAULT false,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"            TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "brands_name_key" ON "propyte_crm"."brands"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "brands_slug_key" ON "propyte_crm"."brands"("slug");
-- Exactamente una predeterminada (entre las no borradas).
CREATE UNIQUE INDEX IF NOT EXISTS "brands_single_default_key"
  ON "propyte_crm"."brands"("isDefault") WHERE "isDefault" AND "deletedAt" IS NULL;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."brands"
    ADD CONSTRAINT "brands_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "propyte_crm"."bot_playbooks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."brands"
    ADD CONSTRAINT "brands_marketingOwnerUserId_fkey"
    FOREIGN KEY ("marketingOwnerUserId") REFERENCES "propyte_crm"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."contact_brands" (
  "id"               TEXT PRIMARY KEY,
  "contactId"        TEXT NOT NULL,
  "brandId"          TEXT NOT NULL,
  "firstConnectorId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_brands_contactId_brandId_key"
  ON "propyte_crm"."contact_brands"("contactId", "brandId");
CREATE INDEX IF NOT EXISTS "contact_brands_brandId_idx"
  ON "propyte_crm"."contact_brands"("brandId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."contact_brands"
    ADD CONSTRAINT "contact_brands_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."contact_brands"
    ADD CONSTRAINT "contact_brands_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "propyte_crm"."brands"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "propyte_crm"."lead_connectors" ADD COLUMN IF NOT EXISTS "brandId" TEXT;
CREATE INDEX IF NOT EXISTS "lead_connectors_brandId_idx" ON "propyte_crm"."lead_connectors"("brandId");

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."lead_connectors"
    ADD CONSTRAINT "lead_connectors_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "propyte_crm"."brands"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Marca predeterminada. El agente de la predeterminada usa la configuración global de
-- siempre: sus campos de agente se ignoran (ver src/lib/brands/resolve.ts).
INSERT INTO "propyte_crm"."brands" ("id", "name", "slug", "isDefault", "botEnabled")
VALUES ('00000000-0000-4000-8000-000000000001', 'Propyte', 'propyte', true, true)
ON CONFLICT DO NOTHING;

-- RLS sin políticas + GRANT explícito (mismo patrón que 2026-08-17-permissions-tables.sql).
ALTER TABLE "propyte_crm"."brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "propyte_crm"."contact_brands" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."brands" TO postgres;
GRANT SELECT ON "propyte_crm"."brands" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "propyte_crm"."contact_brands" TO postgres;
GRANT SELECT ON "propyte_crm"."contact_brands" TO service_role;
```

Antes de dejarla así, confirma en `prisma/schema.prisma` que los nombres de tabla de `@@map` sean `bot_playbooks`, `users` y `contacts`, y que los enums se llamen `Plaza` y `BotTonePreset`. Si alguno difiere, ajusta el SQL.

- [ ] **Paso 4: Tipos y suite**

Corre: `npm run typecheck`. Esperado: sale con código 0.

- [ ] **Paso 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-10-09-brands.sql
git commit -m "feat(marcas): modelo Brand, ContactBrand y LeadConnector.brandId + migración manual"
```

---

### Tarea 2: Módulo `src/lib/brands`: resolución, ajustes y atribución

**Archivos:**
- Crear: `src/lib/brands/resolve.ts`, `src/lib/brands/settings.ts`, `src/lib/brands/attach.ts`
- Pruebas: `src/lib/brands/resolve.test.ts`, `src/lib/brands/settings.test.ts`, `src/lib/brands/attach.test.ts`

**Interfaces:**
- Consume: `prisma.brand`, `prisma.leadConnector`, `prisma.contactBrand`, `prisma.conversation` (Tarea 1).
- Produce:

```ts
// resolve.ts
import type { Brand } from "@prisma/client";
export type BrandResolution =
  | { kind: "default" }                     // camino de siempre
  | { kind: "brand"; brand: Brand }         // marca NO predeterminada
  | { kind: "unavailable"; brandId: string }; // cuenta con brandId pero marca borrada/ilegible → NO contestar
export function isBrandScoped(r: BrandResolution): r is { kind: "brand"; brand: Brand };
export async function resolveBrandForConnector(connectorId: string | null | undefined): Promise<BrandResolution>;
export async function resolveBrandForContact(contactId: string): Promise<{ resolution: BrandResolution; conversationId: string | null }>;
export async function getDefaultBrandId(): Promise<string | null>;
export function __resetBrandCacheForTests(): void;

// settings.ts
export function brandEnabledChannels(brand: Pick<Brand, "enabledChannels">): string[] | null;

// attach.ts
export async function attachBrand(args: {
  contactId: string;
  brandId: string;
  connectorId?: string | null;
  contactIsNew: boolean;
}): Promise<void>;
```

- [ ] **Paso 1: Escribir las pruebas que fallan**

`src/lib/brands/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { brandEnabledChannels } from "./settings";

describe("brandEnabledChannels", () => {
  it("null → hereda (null)", () => {
    expect(brandEnabledChannels({ enabledChannels: null })).toBeNull();
  });
  it("arreglo de strings → ese arreglo", () => {
    expect(brandEnabledChannels({ enabledChannels: ["WHATSAPP", "INSTAGRAM"] })).toEqual(["WHATSAPP", "INSTAGRAM"]);
  });
  it("JSON inválido (no arreglo, o con no-strings) → null (hereda, no revienta)", () => {
    expect(brandEnabledChannels({ enabledChannels: { a: 1 } as never })).toBeNull();
    expect(brandEnabledChannels({ enabledChannels: ["WHATSAPP", 3] as never })).toBeNull();
    expect(brandEnabledChannels({ enabledChannels: "WHATSAPP" as never })).toBeNull();
  });
});
```

`src/lib/brands/resolve.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const connectorFindUnique = vi.fn();
const brandFindFirst = vi.fn();
const convFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { findUnique: (...a: unknown[]) => connectorFindUnique(...a) },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
    conversation: { findFirst: (...a: unknown[]) => convFindFirst(...a) },
  },
}));

import { resolveBrandForConnector, resolveBrandForContact, getDefaultBrandId, isBrandScoped, __resetBrandCacheForTests } from "./resolve";

const YAX = { id: "b-yax", name: "Yaxnáh Caucel", isDefault: false, deletedAt: null };
const DEF = { id: "b-def", name: "Propyte", isDefault: true, deletedAt: null };

beforeEach(() => { vi.resetAllMocks(); __resetBrandCacheForTests(); });

describe("resolveBrandForConnector", () => {
  it("sin connectorId → default, sin tocar la DB", async () => {
    expect(await resolveBrandForConnector(null)).toEqual({ kind: "default" });
    expect(connectorFindUnique).not.toHaveBeenCalled();
  });
  it("cuenta sin brandId → default", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: null });
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "default" });
    expect(brandFindFirst).not.toHaveBeenCalled();
  });
  it("cuenta con marca no predeterminada → brand", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: "b-yax" });
    brandFindFirst.mockResolvedValue(YAX);
    const r = await resolveBrandForConnector("c1");
    expect(isBrandScoped(r)).toBe(true);
    expect(r).toEqual({ kind: "brand", brand: YAX });
  });
  it("cuenta apuntando a la predeterminada → default", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: "b-def" });
    brandFindFirst.mockResolvedValue(DEF);
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "default" });
  });
  it("cuenta con brandId de marca borrada → unavailable (NO contestar como Propyte)", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: "b-borrada" });
    brandFindFirst.mockResolvedValue(null); // el where filtra deletedAt: null
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "unavailable", brandId: "b-borrada" });
  });
  it("error leyendo la marca → unavailable", async () => {
    connectorFindUnique.mockResolvedValue({ brandId: "b-yax" });
    brandFindFirst.mockRejectedValue(new Error("db caída"));
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "unavailable", brandId: "b-yax" });
  });
  it("migración sin aplicar (P2021/P2022) al leer la cuenta → default", async () => {
    connectorFindUnique.mockRejectedValue(Object.assign(new Error("col"), { code: "P2022" }));
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "default" });
  });
  it("otro error leyendo la cuenta → unavailable con brandId desconocido", async () => {
    connectorFindUnique.mockRejectedValue(new Error("timeout"));
    expect(await resolveBrandForConnector("c1")).toEqual({ kind: "unavailable", brandId: "?" });
  });
});

describe("resolveBrandForContact", () => {
  it("usa la conversación más reciente del contacto", async () => {
    convFindFirst.mockResolvedValue({ id: "conv9", connectorId: "c1" });
    connectorFindUnique.mockResolvedValue({ brandId: "b-yax" });
    brandFindFirst.mockResolvedValue(YAX);
    const r = await resolveBrandForContact("k1");
    expect(r.conversationId).toBe("conv9");
    expect(r.resolution).toEqual({ kind: "brand", brand: YAX });
    expect(convFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId: "k1" },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    }));
  });
  it("sin conversaciones → default y conversationId null", async () => {
    convFindFirst.mockResolvedValue(null);
    expect(await resolveBrandForContact("k1")).toEqual({ resolution: { kind: "default" }, conversationId: null });
  });
});

describe("getDefaultBrandId", () => {
  it("devuelve el id y lo cachea", async () => {
    brandFindFirst.mockResolvedValue({ id: "b-def" });
    expect(await getDefaultBrandId()).toBe("b-def");
    expect(await getDefaultBrandId()).toBe("b-def");
    expect(brandFindFirst).toHaveBeenCalledTimes(1);
  });
  it("error → null", async () => {
    brandFindFirst.mockRejectedValue(new Error("x"));
    expect(await getDefaultBrandId()).toBeNull();
  });
});
```

`src/lib/brands/attach.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const cbCount = vi.fn();
const cbUpsert = vi.fn();
const cbCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contactBrand: {
      count: (...a: unknown[]) => cbCount(...a),
      upsert: (...a: unknown[]) => cbUpsert(...a),
      create: (...a: unknown[]) => cbCreate(...a),
    },
  },
}));
const getDefaultBrandId = vi.fn();
vi.mock("./resolve", () => ({ getDefaultBrandId: () => getDefaultBrandId() }));

import { attachBrand } from "./attach";

beforeEach(() => {
  vi.resetAllMocks();
  getDefaultBrandId.mockResolvedValue("b-def");
  cbUpsert.mockResolvedValue({});
  cbCreate.mockResolvedValue({});
});

describe("attachBrand", () => {
  it("contacto nuevo → solo la fila de su marca", async () => {
    await attachBrand({ contactId: "k1", brandId: "b-yax", connectorId: "c1", contactIsNew: true });
    expect(cbCount).not.toHaveBeenCalled();
    expect(cbUpsert).toHaveBeenCalledTimes(1);
    expect(cbUpsert).toHaveBeenCalledWith({
      where: { contactId_brandId: { contactId: "k1", brandId: "b-yax" } },
      create: { contactId: "k1", brandId: "b-yax", firstConnectorId: "c1" },
      update: {},
    });
  });
  it("contacto existente SIN filas que llega por otra marca → también queda en la predeterminada", async () => {
    cbCount.mockResolvedValue(0);
    await attachBrand({ contactId: "k1", brandId: "b-yax", connectorId: "c1", contactIsNew: false });
    expect(cbUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId_brandId: { contactId: "k1", brandId: "b-def" } },
    }));
    expect(cbUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId_brandId: { contactId: "k1", brandId: "b-yax" } },
    }));
  });
  it("contacto existente con filas → no agrega la predeterminada", async () => {
    cbCount.mockResolvedValue(1);
    await attachBrand({ contactId: "k1", brandId: "b-yax", contactIsNew: false });
    expect(cbUpsert).toHaveBeenCalledTimes(1);
  });
  it("la marca ES la predeterminada → una sola fila", async () => {
    cbCount.mockResolvedValue(0);
    await attachBrand({ contactId: "k1", brandId: "b-def", contactIsNew: false });
    expect(cbUpsert).toHaveBeenCalledTimes(1);
  });
  it("un fallo de DB no lanza (la atribución nunca rompe la entrada del lead)", async () => {
    cbUpsert.mockRejectedValue(new Error("x"));
    await expect(attachBrand({ contactId: "k1", brandId: "b-yax", contactIsNew: true })).resolves.toBeUndefined();
  });
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

Corre: `npx vitest run src/lib/brands`
Esperado: FALLA con "Failed to resolve import ./resolve" (o ./settings, ./attach).

- [ ] **Paso 3: Implementar**

`src/lib/brands/settings.ts`:

```ts
// Ajustes del agente por marca — módulo PURO (2026-10-09, spec marcas-agente §3.2).
import type { Brand } from "@prisma/client";

/** Canales en que contesta el agente de la marca; null = hereda BotConfig.enabledChannels.
 *  Un JSON inválido también hereda: nunca debe tumbar al agente. */
export function brandEnabledChannels(brand: Pick<Brand, "enabledChannels">): string[] | null {
  const v = brand.enabledChannels as unknown;
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}
```

`src/lib/brands/resolve.ts`:

```ts
// Resolución de la marca de una cuenta/conversación (2026-10-09, spec marcas-agente §3.1, §7).
//
// Regla de oro: SOLO una marca NO predeterminada activa el camino nuevo del agente.
// Sin cuenta, sin brandId o con la predeterminada → { kind: "default" } y todo sigue igual
// que antes. Si la cuenta SÍ tiene brandId pero la marca no se puede usar (borrada o error
// de lectura) → "unavailable": el agente NO contesta. Contestar como Propyte a un cliente
// de otra marca es justo el error que esta capa existe para evitar (mismo criterio que
// resolveWhatsAppSender en src/lib/whatsapp/accounts.ts).
import prisma from "@/lib/db";
import type { Brand } from "@prisma/client";

export type BrandResolution =
  | { kind: "default" }
  | { kind: "brand"; brand: Brand }
  | { kind: "unavailable"; brandId: string };

export function isBrandScoped(r: BrandResolution): r is { kind: "brand"; brand: Brand } {
  return r.kind === "brand";
}

/** P2021 = tabla inexistente, P2022 = columna inexistente: la migración aún no se aplicó. */
function isMissingSchema(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function resolveBrandForConnector(connectorId: string | null | undefined): Promise<BrandResolution> {
  if (!connectorId) return { kind: "default" };
  let brandId: string | null;
  try {
    const c = await prisma.leadConnector.findUnique({ where: { id: connectorId }, select: { brandId: true } });
    brandId = c?.brandId ?? null;
  } catch (err) {
    if (isMissingSchema(err)) return { kind: "default" };
    console.error("[brands] no se pudo leer la cuenta", connectorId, err);
    return { kind: "unavailable", brandId: "?" };
  }
  if (!brandId) return { kind: "default" };
  try {
    const brand = await prisma.brand.findFirst({ where: { id: brandId, deletedAt: null } });
    if (!brand) {
      console.error("[brands] la cuenta apunta a una marca borrada o inexistente", connectorId, brandId);
      return { kind: "unavailable", brandId };
    }
    return brand.isDefault ? { kind: "default" } : { kind: "brand", brand };
  } catch (err) {
    console.error("[brands] no se pudo leer la marca", brandId, err);
    return { kind: "unavailable", brandId };
  }
}

/** Marca de la conversación más reciente del contacto (para AI_DRAFT, que no tiene conversación propia). */
export async function resolveBrandForContact(
  contactId: string,
): Promise<{ resolution: BrandResolution; conversationId: string | null }> {
  const conv = await prisma.conversation.findFirst({
    where: { contactId },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, connectorId: true },
  });
  if (!conv) return { resolution: { kind: "default" }, conversationId: null };
  return { resolution: await resolveBrandForConnector(conv.connectorId), conversationId: conv.id };
}

let _default: { id: string | null; at: number } | null = null;
const TTL_MS = 60_000;

export async function getDefaultBrandId(): Promise<string | null> {
  if (_default && Date.now() - _default.at < TTL_MS) return _default.id;
  try {
    const row = await prisma.brand.findFirst({ where: { isDefault: true, deletedAt: null }, select: { id: true } });
    _default = { id: row?.id ?? null, at: Date.now() };
    return _default.id;
  } catch {
    return null;
  }
}

export function __resetBrandCacheForTests(): void {
  _default = null;
}
```

`src/lib/brands/attach.ts`:

```ts
// Atribución contacto ↔ marca (2026-10-09, spec marcas-agente §2.3).
// Regla de pertenencia: un contacto pertenece a las marcas de sus filas en contact_brands;
// SIN filas pertenece a la predeterminada. Por eso, si un contacto que YA existía (y no
// tenía filas, o sea era de Propyte) llega por otra marca, primero se registra la
// predeterminada: queda en AMBAS y no "desaparece" de Propyte cuando la entrega 2 filtre
// la visibilidad por marca.
//
// Best-effort: corre FUERA de la transacción del alta (un error dentro de una transacción
// de Postgres la aborta) y nunca lanza — la atribución jamás debe romper la entrada de un lead.
import prisma from "@/lib/db";
import { getDefaultBrandId } from "./resolve";

export async function attachBrand(args: {
  contactId: string;
  brandId: string;
  connectorId?: string | null;
  contactIsNew: boolean;
}): Promise<void> {
  const { contactId, brandId, connectorId, contactIsNew } = args;
  try {
    if (!contactIsNew) {
      const defaultId = await getDefaultBrandId();
      if (defaultId && defaultId !== brandId) {
        const existing = await prisma.contactBrand.count({ where: { contactId } });
        if (existing === 0) {
          await prisma.contactBrand.upsert({
            where: { contactId_brandId: { contactId, brandId: defaultId } },
            create: { contactId, brandId: defaultId, firstConnectorId: null },
            update: {},
          });
        }
      }
    }
    await prisma.contactBrand.upsert({
      where: { contactId_brandId: { contactId, brandId } },
      create: { contactId, brandId, firstConnectorId: connectorId ?? null },
      update: {},
    });
  } catch (err) {
    console.error("[brands] no se pudo registrar la marca del contacto", contactId, brandId, err);
  }
}
```

Nota: la prueba "la marca ES la predeterminada → una sola fila" pasa porque `defaultId === brandId`, así que se omite el `count`. La prueba "con filas" mockea `count → 1`.

- [ ] **Paso 4: Correr y verificar que pasan**

Corre: `npx vitest run src/lib/brands`
Esperado: todas las pruebas PASAN.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/brands
git commit -m "feat(marcas): resolución de marca por cuenta, ajustes y atribución contacto-marca"
```

---

### Tarea 3: Catálogo por marca (`developmentIds`) y encabezado configurable

**Archivos:**
- Modificar: `src/lib/hub/catalog-types.ts:132-139` (`CatalogSearchFilters`), `src/lib/hub/catalog.ts` (`searchCatalog`), `src/lib/bot/hub-catalog.ts` (`findMatchingDevelopments`, `catalogBrief`)
- Pruebas: `src/lib/bot/hub-catalog.test.ts` (agregar casos) y, si existe, `src/lib/hub/catalog.test.ts`. Si no existe, crea `src/lib/hub/catalog.search.test.ts`.

**Interfaces:**
- Produce:
  - `CatalogSearchFilters.developmentIds?: string[] | null`
  - `findMatchingDevelopments(opts: { ...; developmentIds?: string[] | null })`: con un arreglo **vacío** devuelve `{ data: [], error: null }` sin consultar.
  - `catalogBrief(devs, header?: string)`: el encabezado por defecto es exactamente el de hoy: `"Catálogo publicado en propyte.com (fuente oficial, puedes citar estos datos):"`.

- [ ] **Paso 1: Pruebas que fallan**

En `src/lib/bot/hub-catalog.test.ts`, lee primero cómo se mockea hoy `searchCatalog` y agrega:

```ts
it("developmentIds vacío → sin catálogo y sin consultar", async () => {
  const r = await findMatchingDevelopments({ developmentIds: [] });
  expect(r).toEqual({ data: [], error: null });
  expect(searchCatalogMock).not.toHaveBeenCalled();
});

it("developmentIds se pasa a searchCatalog", async () => {
  searchCatalogMock.mockResolvedValue({ data: [], error: null });
  await findMatchingDevelopments({ developmentIds: ["d1", "d2"], limit: 10 });
  expect(searchCatalogMock).toHaveBeenCalledWith(expect.objectContaining({ developmentIds: ["d1", "d2"] }));
});

it("catalogBrief con encabezado propio", () => {
  const out = catalogBrief([{ id: "d1", nombre: "Yaxnáh Caucel", zona: "Caucel", ciudad: "Mérida", precio_min: 2090000, precio_max: 2090000, moneda: "MXN", unidades_publicadas: 1, recamaras_min: 3, recamaras_max: 3, enganche_pct: null, meses_opciones: null }], "Catálogo oficial de Yaxnáh Caucel:");
  expect(out.startsWith("Catálogo oficial de Yaxnáh Caucel:\n")).toBe(true);
});

it("catalogBrief sin encabezado conserva el texto de hoy", () => {
  const out = catalogBrief([{ id: "d1", nombre: "X", zona: null, ciudad: null, precio_min: null, precio_max: null, moneda: "MXN", unidades_publicadas: 1, recamaras_min: null, recamaras_max: null, enganche_pct: null, meses_opciones: null }]);
  expect(out.startsWith("Catálogo publicado en propyte.com (fuente oficial, puedes citar estos datos):\n")).toBe(true);
});
```

Usa el nombre de mock que ya tenga el archivo; si no mockea `searchCatalog`, agrega `vi.mock("@/lib/hub/catalog", () => ({ searchCatalog: (...a) => searchCatalogMock(...a) }))`.

Para `searchCatalog`, mockea `prisma.$queryRawUnsafe` y verifica:
- que se le pase `["d1"]` como sexto parámetro;
- que el SQL contenga `u.development_id::text = ANY($6::text[])`;
- que sin `developmentIds` el sexto parámetro sea `null`.

- [ ] **Paso 2: Correr y ver que fallan**

Corre: `npx vitest run src/lib/bot/hub-catalog.test.ts src/lib/hub`
Esperado: FALLAN los casos nuevos.

- [ ] **Paso 3: Implementar**

En `catalog-types.ts`, dentro de `CatalogSearchFilters`, agrega:

```ts
  /** Solo unidades de estos desarrollos del Hub (marca del agente, 2026-10-09). null/undefined = todos. */
  developmentIds?: string[] | null;
```

En `catalog.ts`, dentro de `searchCatalog`, agrega la condición y el parámetro:

```ts
          AND ($5::int IS NULL OR u.bedrooms >= $5)
          AND ($6::text[] IS NULL OR u.development_id::text = ANY($6::text[]))
```

y al final de los argumentos: `filters.developmentIds ?? null`.

En `hub-catalog.ts`:
- agrega `developmentIds?: string[] | null;` a `opts`;
- al inicio de la función, agrega `if (opts.developmentIds && opts.developmentIds.length === 0) return { data: [], error: null };`;
- pasa `developmentIds: opts.developmentIds ?? null` a `searchCatalog`.

`catalogBrief` queda así:

```ts
const DEFAULT_CATALOG_HEADER = "Catálogo publicado en propyte.com (fuente oficial, puedes citar estos datos):";

export function catalogBrief(devs: HubDevelopmentSummary[], header: string = DEFAULT_CATALOG_HEADER): string {
  // ...cuerpo idéntico...
  return `${header}\n${lines.join("\n")}`;
}
```

Ojo: `buildSystemPrompt` usa hoy `Parameters<typeof catalogBrief>[0]` como tipo del catálogo; ese tipo no cambia.

- [ ] **Paso 4: Correr y ver que pasan**

Corre: `npx vitest run src/lib/bot src/lib/hub`. Esperado: PASAN, incluidas las pruebas previas.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/hub src/lib/bot/hub-catalog.ts src/lib/bot/hub-catalog.test.ts
git commit -m "feat(marcas): catálogo del agente filtrable por desarrollos y encabezado configurable"
```

---

### Tarea 4: Prompt por marca (`claude.ts`) con prueba congelada del prompt actual

**Archivos:**
- Modificar: `src/lib/bot/claude.ts` (`buildBrandRules` ~171, `buildSystemPrompt` ~210)
- Prueba: `src/lib/bot/claude.brand.test.ts` (nueva)

**Interfaces:**
- Consume: `catalogBrief(devs, header?)` (Tarea 3).
- Produce:

```ts
export interface BrandPromptInput { name: string; persona: string | null; knowledge: string | null }
export function buildBrandRules(config: BotConfigResolved, brand?: BrandPromptInput): string;
export function buildSystemPrompt(args: {
  config: BotConfigResolved;
  contact?: { firstName: string; preferredLanguage: string };
  catalog?: Parameters<typeof catalogBrief>[0];
  objective?: string;
  brand?: BrandPromptInput;
}): string;
```

- [ ] **Paso 1: Congelar el prompt actual ANTES de tocar `claude.ts`**

Crea `src/lib/bot/claude.brand.test.ts`, con la parte "sin marca" solamente:

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./claude";
import { DEFAULT_BOT_CONFIG } from "./config";

const CATALOG = [{
  id: "d1", nombre: "Nativa Tulum", zona: "Tulum", ciudad: "Tulum", precio_min: 2500000, precio_max: 6300000,
  moneda: "MXN", unidades_publicadas: 6, recamaras_min: 1, recamaras_max: 3, enganche_pct: 30, meses_opciones: [12, 24],
}];

describe("buildSystemPrompt — sin marca (camino de siempre)", () => {
  it("es idéntico al prompt de antes del cambio (congelado)", () => {
    const out = buildSystemPrompt({
      config: DEFAULT_BOT_CONFIG,
      contact: { firstName: "Ana", preferredLanguage: "ES" },
      catalog: CATALOG,
      objective: "Saluda y califica.",
    });
    expect(out).toMatchSnapshot();
  });
  it("sin catálogo, idéntico al de antes", () => {
    expect(buildSystemPrompt({ config: DEFAULT_BOT_CONFIG })).toMatchSnapshot();
  });
});
```

Corre: `npx vitest run src/lib/bot/claude.brand.test.ts`
Esperado: PASA y crea `src/lib/bot/__snapshots__/claude.brand.test.ts.snap`. **Haz commit del snapshot ahora**, para que cualquier cambio posterior que lo altere quede a la vista:

```bash
git add src/lib/bot/claude.brand.test.ts src/lib/bot/__snapshots__/claude.brand.test.ts.snap
git commit -m "test(marcas): congelar el prompt actual del agente antes de agregar marcas"
```

- [ ] **Paso 2: Pruebas con marca, que fallan**

Agrega al mismo archivo:

```ts
const YAX = {
  name: "Yaxnáh Caucel",
  persona: "Eres el asistente comercial de Yaxnáh Caucel, fraccionamiento de casas en Ciudad Caucel, Mérida.",
  knowledge: "Kannah Etapa 6: $2,020,000. Nunca menciones el bono de $60,000.",
};

describe("buildSystemPrompt — con marca", () => {
  const out = buildSystemPrompt({
    config: DEFAULT_BOT_CONFIG,
    contact: { firstName: "Ana", preferredLanguage: "ES" },
    catalog: [{ ...CATALOG[0], nombre: "Yaxnáh Caucel", zona: "Caucel", ciudad: "Mérida" }],
    objective: "Saluda y califica.",
    brand: YAX,
  });
  it("no menciona Propyte, Riviera Maya ni Tulum", () => {
    expect(out).not.toMatch(/Propyte|Riviera Maya|Tulum/);
  });
  it("usa la presentación, la regla de exclusividad y el conocimiento", () => {
    expect(out).toContain(YAX.persona);
    expect(out).toContain("Representas únicamente a Yaxnáh Caucel.");
    expect(out).toContain("Información oficial de Yaxnáh Caucel");
    expect(out).toContain(YAX.knowledge);
    expect(out).toContain("Catálogo oficial de Yaxnáh Caucel");
  });
  it("conserva las reglas de seguridad", () => {
    expect(out).toContain("[ESCALAR]");
    expect(out).toContain("[ESCALAR_MARKETING]");
    expect(out).toContain("ese \"sí\" ES intención fuerte");
    expect(out).toContain("NO inventes cifras");
  });
  it("sin ejemplos de tono (todos son de Tulum)", () => {
    expect(out).not.toContain("Ejemplos de tu estilo");
  });
  it("persona vacía → presentación genérica con el nombre", () => {
    const o = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, brand: { ...YAX, persona: "  " } });
    expect(o).toContain("Eres el asistente comercial de Yaxnáh Caucel.");
  });
  it("sin conocimiento → no agrega el bloque vacío", () => {
    const o = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, brand: { ...YAX, knowledge: null } });
    expect(o).not.toContain("Información oficial de");
  });
});
```

Corre: `npx vitest run src/lib/bot/claude.brand.test.ts`. Esperado: fallan los casos "con marca", y los congelados siguen pasando.

- [ ] **Paso 3: Implementar**

En `claude.ts`:

```ts
import { catalogBrief } from "./hub-catalog";

/** Datos de marca que entran al prompt (2026-10-09, spec marcas-agente §3.3). */
export interface BrandPromptInput {
  name: string;
  persona: string | null;
  knowledge: string | null;
}

const LEGACY_IDENTITY = "Eres el asistente comercial de Propyte, inmobiliaria boutique de la Riviera Maya.";

function identityLines(brand?: BrandPromptInput): string[] {
  if (!brand) return [LEGACY_IDENTITY];
  const persona = brand.persona?.trim() || `Eres el asistente comercial de ${brand.name}.`;
  return [
    persona,
    `Representas únicamente a ${brand.name}. No menciones ni ofrezcas otras marcas, desarrollos o ciudades; si preguntan por algo fuera de ${brand.name}, ofrece que un asesor lo contacte.`,
  ];
}
```

En `buildBrandRules(config, brand?)`, reemplaza la primera entrada del arreglo (la línea literal de Propyte) por `...identityLines(brand),`. El resto del arreglo queda igual.

En `buildSystemPrompt`, agrega el parámetro `brand?: BrandPromptInput` y:

```ts
  const catalogBlock =
    catalog && catalog.length > 0
      ? (brand ? catalogBrief(catalog, `Catálogo oficial de ${brand.name} (fuente oficial, puedes citar estos datos):`) : catalogBrief(catalog))
      : "(No tienes catálogo en contexto: NO cites precios.)";

  const parts = [
    buildBrandRules(config, brand),
    `\nTono y estilo:\n${preset.voiceGuidance}`,
  ];
  // Los ejemplos de los presets son de Tulum: con marca se omiten (se conserva la guía de estilo).
  if (!brand) parts.push(`\nEjemplos de tu estilo (imítalos en registro, no los copies literal):\n${examples}`);
  if (brand?.knowledge?.trim()) {
    parts.push(`\nInformación oficial de ${brand.name} (puedes citarla; lo que no esté aquí ni en el catálogo, no lo inventes):\n${brand.knowledge.trim()}`);
  }
  parts.push(`\nObjetivo ahora: ${args.objective ?? DEFAULT_OBJECTIVE}`);
  // ...el resto (contact, catalogBlock) sigue igual
```

**Requisito estricto:** sin `brand`, el orden y el texto de las partes deben quedar exactamente como antes. Las pruebas congeladas del Paso 1 lo verifican: **no regeneres el snapshot**. Si fallan, la implementación está mal.

- [ ] **Paso 4: Correr**

Corre: `npx vitest run src/lib/bot`. Esperado: todo PASA, incluido `claude.test.ts` existente, y el snapshot no se reescribe (sin "1 written"/"updated").

- [ ] **Paso 5: Commit**

```bash
git add src/lib/bot/claude.ts src/lib/bot/claude.brand.test.ts
git commit -m "feat(marcas): prompt del agente por marca (presentación, exclusividad, conocimiento)"
```

---

### Tarea 5: `botRespond` por marca

**Archivos:**
- Modificar: `src/lib/bot/bot-respond.ts`, `src/lib/bot/marketing-routing.ts`
- Prueba: `src/lib/bot/bot-respond.brand.test.ts` (nueva). Toma el andamiaje de mocks de `bot-respond.marketing.test.ts`.

**Interfaces:**
- Consume: `resolveBrandForConnector`, `isBrandScoped` (Tarea 2); `brandEnabledChannels` (Tarea 2); `findMatchingDevelopments({ developmentIds })` (Tarea 3); `buildSystemPrompt({ brand })` y `BrandPromptInput` (Tarea 4).
- Produce:
  - `shouldBotRespondForChannel(config: BotConfigResolved, channel: string, enabledChannelsOverride?: string[] | null): boolean`. El override reemplaza `config.enabledChannels`, y el `botEnabled` global sigue mandando.
  - `getMarketingOwnerId(preferredUserId?: string | null): Promise<string | null>`. Si `preferredUserId` es un usuario activo, devuelve ese; si no, la cadena de hoy.

- [ ] **Paso 1: Pruebas que fallan**

Crea `src/lib/bot/bot-respond.brand.test.ts`. Copia el bloque de mocks de `bot-respond.marketing.test.ts` con estos cambios:
- en el mock de `./claude`, haz que `buildSystemPrompt` sea un `vi.fn()` exportado (`buildSystemPromptMock`) para poder inspeccionar sus argumentos;
- mockea `./hub-catalog` con `findMatchingDevelopments: (...a) => findDevsMock(...a)`;
- mockea `@/lib/brands/resolve` con `resolveBrandForConnector: (...a) => resolveBrandMock(...a)` y `isBrandScoped: (r) => r.kind === "brand"`;
- mockea `./playbook/run` con `runPlaybookStep: (...a) => runPlaybookStepMock(...a)`;
- agrega `botAgentProfile: { count: botAgentCountMock }` y `botPlaybook: { findFirst: botPlaybookFindFirstMock }` al mock de db;
- haz que `escalateToHuman` sea observable mockeando `prisma.conversation.update` y `askClaude`, como hace el archivo de marketing.

Casos (escribe cada uno como `it(...)`):

```ts
const YAX = {
  id: "b-yax", name: "Yaxnáh Caucel", isDefault: false, persona: "Eres el asistente de Yaxnáh.", knowledge: "K",
  developmentIds: ["dev-yax"], defaultPlaza: "MERIDA", enabledChannels: ["WHATSAPP", "INSTAGRAM"],
  tonePreset: "CALIDO_CERCANO_MX", playbookId: null, marketingOwnerUserId: "u-mkt-yax", botEnabled: true, deletedAt: null,
};
const CONV_YAX = { id: "conv-y", status: "BOT", botEnabled: true, connectorId: "c-yax" };

// 1. Historial solo de la conversación
//    convFindFirst → CONV_YAX; resolveBrandMock → { kind: "brand", brand: YAX }; askClaude → "Hola"
//    expect(msgFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: "conv-y", internalNote: false } }))

// 2. Sin agentes por segmento ni clasificador
//    expect(botAgentCountMock).not.toHaveBeenCalled()

// 3. Catálogo por developmentIds, sin presupuesto ni zona
//    contacto con budgetMax 9e6 y preferredZone "Tulum"
//    expect(findDevsMock).toHaveBeenCalledWith({ developmentIds: ["dev-yax"], limit: 10 })

// 4. Prompt con marca y tono de la marca
//    const args = buildSystemPromptMock.mock.calls[0][0];
//    expect(args.brand).toEqual({ name: "Yaxnáh Caucel", persona: YAX.persona, knowledge: "K" });
//    expect(args.config.tonePreset).toBe("CALIDO_CERCANO_MX");

// 5. Canales por marca: INSTAGRAM habilitado solo para la marca
//    botRespond("c1", { channel: "INSTAGRAM", connectorId: "c-yax" }) → envía (sendChannelMessage llamado)
//    y con resolveBrandMock → { kind: "default" } el mismo canal NO envía (global solo WHATSAPP)

// 6. enabledChannels inválido en la marca → hereda global (WHATSAPP sí, INSTAGRAM no), sin lanzar
//    brand: { ...YAX, enabledChannels: { roto: true } }

// 7. Marca apagada → no envía y escala UNA vez con el motivo
//    brand: { ...YAX, botEnabled: false }
//    expect(sendChannelMessage).not.toHaveBeenCalled();
//    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conv-y" }, data: expect.objectContaining({ status: "HUMAN" }) }));
//    y el askClaude del resumen recibió un mensaje que contiene "Agente de la marca «Yaxnáh Caucel» apagado"

// 8. Marca no disponible → no envía, no escala, no llama a Claude
//    resolveBrandMock → { kind: "unavailable", brandId: "b-x" }
//    expect(askClaude).not.toHaveBeenCalled(); expect(sendChannelMessage).not.toHaveBeenCalled()

// 9. Marketing por marca: reply con "[ESCALAR_MARKETING]" → el hilo va a u-mkt-yax si está activo
//    setActiveUsers(["u-mkt-yax", LUIS]) → convUpdate con controlledById "u-mkt-yax"

// 10. Playbook de la marca: brand.playbookId "pb-yax" activo con tareas → runPlaybookStepMock llamado con playbook.id "pb-yax"
//     y botPlaybookFindFirstMock llamado con where.id "pb-yax"

// 11. Cuenta sin marca → camino de siempre: resolveBrandMock → { kind: "default" }
//     expect(botAgentCountMock).toHaveBeenCalled(); expect(msgFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { contactId: "c1", internalNote: false } }));
//     expect(buildSystemPromptMock.mock.calls[0][0].brand).toBeUndefined();
```

Escribe el código completo de cada `it` siguiendo el estilo de `bot-respond.marketing.test.ts`: arrange con `mockResolvedValue`, act con `await botRespond("c1", {...})` y assert.

Agrega también a `bot-respond.guards.test.ts`:

```ts
it("el override de canales reemplaza a los globales, pero el master switch manda", () => {
  expect(shouldBotRespondForChannel(DEFAULT_BOT_CONFIG, "INSTAGRAM", ["INSTAGRAM"])).toBe(true);
  expect(shouldBotRespondForChannel(DEFAULT_BOT_CONFIG, "WHATSAPP", ["INSTAGRAM"])).toBe(false);
  expect(shouldBotRespondForChannel({ ...DEFAULT_BOT_CONFIG, botEnabled: false }, "INSTAGRAM", ["INSTAGRAM"])).toBe(false);
  expect(shouldBotRespondForChannel(DEFAULT_BOT_CONFIG, "WHATSAPP", null)).toBe(true);
});
```

Y a `bot-respond.marketing.test.ts`, en `describe("getMarketingOwnerId")`:

```ts
it("preferredUserId activo gana; inactivo cae a la cadena de siempre", async () => {
  setActiveUsers(["u-pref", LUIS]);
  expect(await getMarketingOwnerId("u-pref")).toBe("u-pref");
  setActiveUsers([LUIS]);
  expect(await getMarketingOwnerId("u-pref")).toBe(LUIS);
});
```

- [ ] **Paso 2: Correr y ver que fallan**

Corre: `npx vitest run src/lib/bot/bot-respond.brand.test.ts src/lib/bot/bot-respond.guards.test.ts src/lib/bot/bot-respond.marketing.test.ts`. Esperado: fallan los casos nuevos.

- [ ] **Paso 3: Implementar**

`marketing-routing.ts`:

```ts
export async function getMarketingOwnerId(preferredUserId?: string | null): Promise<string | null> {
  const candidates = [
    preferredUserId ?? null, // responsable de marketing de la marca (2026-10-09)
    await readUserIdConfig(MARKETING_OWNER_KEY),
    await readUserIdConfig(ADMIN_OWNER_KEY),
  ].filter((id): id is string => !!id);
  // ...el resto igual
}
```

`bot-respond.ts`:

```ts
import { resolveBrandForConnector, isBrandScoped } from "@/lib/brands/resolve";
import { brandEnabledChannels } from "@/lib/brands/settings";
import type { BrandPromptInput } from "./claude";

export function shouldBotRespondForChannel(
  config: BotConfigResolved,
  channel: string,
  enabledChannelsOverride?: string[] | null,
): boolean {
  return config.botEnabled && (enabledChannelsOverride ?? config.enabledChannels).includes(channel);
}
```

Reordena el inicio de `botRespond`: hoy el chequeo de canal va antes de leer la conversación, pero los canales ahora dependen de la marca de la cuenta.

```ts
  const channel: MessagingChannel = opts.channel ?? "WHATSAPP";
  const config = await getBotConfig();
  // Atajo barato y sin cambio de conducta: con el master switch apagado nadie contesta.
  if (!config.botEnabled) return false;

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.doNotContact || (channel === "WHATSAPP" && contact.whatsappOptOut)) return false;

  const { ensureConversation, findConversationForChannel } = await import("@/lib/messaging/conversations");
  const connectorId = opts.connectorId ?? (await findConversationForChannel(contactId, channel))?.connectorId ?? null;

  // Marca de la cuenta (2026-10-09, spec marcas-agente §3.2). Solo una marca NO
  // predeterminada cambia algo; "unavailable" = la cuenta tiene marca pero no se puede
  // usar → NO contestar (mejor callado que responder como otra marca).
  const brandRes = await resolveBrandForConnector(connectorId);
  if (brandRes.kind === "unavailable") return false;
  const brand = isBrandScoped(brandRes) ? brandRes.brand : null;
  if (!shouldBotRespondForChannel(config, channel, brand ? brandEnabledChannels(brand) : null)) return false;

  const conv = opts.createConversation
    ? await ensureConversation({ contactId, channel, connectorId })
    : await findConversationForChannel(contactId, channel);
  if (!conv || conv.status !== "BOT" || !conv.botEnabled) return false;

  if (brand && !brand.botEnabled) {
    await escalateToHuman(conv.id, `Agente de la marca «${brand.name}» apagado`);
    return false;
  }
```

**Verifica la equivalencia del camino sin marca:** antes, con canal no habilitado, se devolvía `false` sin leer el contacto. Ahora se lee el contacto y se resuelve la marca (sin DB si no hay `connectorId` o la cuenta no tiene `brandId`) antes de devolver `false`. El resultado observable es el mismo: no envía. Si `bot-respond.channel.test.ts` exige que no se lea el contacto, ajústalo **solo** si la aserción es de orden interno y no de conducta. Documenta el ajuste en el mensaje de commit.

Historial:

```ts
  const msgs = await prisma.message.findMany({
    // Con marca: solo ESTA conversación — lo hablado con el mismo cliente desde otra
    // marca no entra al contexto. Sin marca: igual que siempre (todo el contacto).
    where: brand ? { conversationId: conv.id, internalNote: false } : { contactId, internalNote: false },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
```

El guard anti-ráfaga (`newer`) se deja tal cual, porque mira todo el contacto.

Catálogo:

```ts
  const { data: catalog, error: catalogError } = brand
    ? await findMatchingDevelopments({ developmentIds: brand.developmentIds, limit: 10 })
    : await findMatchingDevelopments({
        budgetMin: contact.budgetMin ? Number(contact.budgetMin) : null,
        budgetMax: contact.budgetMax ? Number(contact.budgetMax) : null,
        zone: contact.preferredZone,
      });
```

Agentes por segmento: envuelve el bloque `try { const hasAgents = ... }` en `if (!brand) { ... }`, y deja `agentProfile = null` con marca.

Tono:

```ts
  const baseConfig = brand?.tonePreset ? { ...config, tonePreset: brand.tonePreset } : config;
  const effectiveConfig = applyAgentTone(baseConfig, agentProfile);
```

Playbook:

```ts
  const agentPlaybook = agentPlaybookOf(agentProfile);
  const brandPlaybookId = brand?.playbookId ?? null;
  const useGlobalPlaybook = !brand && !agentProfile && !!config.activePlaybookId;
  let playbookObjective: string | undefined;
  if (agentPlaybook || useGlobalPlaybook || brandPlaybookId) {
    try {
      const pb = agentPlaybook
        ?? (await prisma.botPlaybook.findFirst({
          where: { id: (brandPlaybookId ?? config.activePlaybookId)!, isActive: true, deletedAt: null },
          include: { tasks: { where: { isActive: true }, orderBy: { order: "asc" } } },
        }));
      // ...igual que hoy
```

Prompt:

```ts
  const brandPrompt: BrandPromptInput | undefined = brand
    ? { name: brand.name, persona: brand.persona, knowledge: brand.knowledge }
    : undefined;
  const system = buildSystemPrompt({
    config: effectiveConfig,
    contact: { firstName: contact.firstName, preferredLanguage: contact.preferredLanguage },
    catalog,
    objective,
    ...(brandPrompt ? { brand: brandPrompt } : {}),
  });
```

Usa el spread condicional para que, sin marca, los argumentos sean idénticos a hoy y la prueba 11 vea `brand` undefined.

Marketing:

```ts
    await escalateToHuman(conv.id, "Propuesta comercial / de marketing: no busca propiedad", {
      routeToUserId: await getMarketingOwnerId(brand?.marketingOwnerUserId ?? null),
    });
```

- [ ] **Paso 4: Correr**

Corre: `npx vitest run src/lib/bot`. Esperado: todo PASA, incluidos `bot-respond.agents`, `.channel`, `.staleness`, `.marketing` y `claude.brand` (snapshot sin reescribir).

- [ ] **Paso 5: Commit**

```bash
git add src/lib/bot/bot-respond.ts src/lib/bot/marketing-routing.ts src/lib/bot/*.test.ts
git commit -m "feat(marcas): el agente responde por marca (canales, interruptor, historial, catálogo, playbook, marketing)"
```

---

### Tarea 6: Borradores AI_DRAFT por marca

**Archivos:**
- Modificar: `src/lib/bot/ai-actions.ts` (`conversationContext` ~19, bloque AI_DRAFT ~142-185)
- Prueba: `src/lib/bot/ai-actions.test.ts` (agregar casos)

**Interfaces:**
- Consume: `resolveBrandForContact` (Tarea 2), `findMatchingDevelopments({ developmentIds })` (Tarea 3), `buildSystemPrompt({ brand })` (Tarea 4).

- [ ] **Paso 1: Pruebas que fallan**

Lee `ai-actions.test.ts` para reutilizar sus mocks. Agrega un mock de `@/lib/brands/resolve` (`resolveBrandForContact: (...a) => resolveForContactMock(...a)`). Casos:

1. `resolveForContactMock` → `{ resolution: { kind: "brand", brand: YAX }, conversationId: "conv-y" }`:
   - el historial se pide con `where: { conversationId: "conv-y", internalNote: false }`;
   - `botAgentProfile.count` no se llama;
   - `findMatchingDevelopments` recibe `{ developmentIds: YAX.developmentIds, limit: 10 }`;
   - `buildSystemPrompt` recibe `brand: { name, persona, knowledge }`.
2. `{ resolution: { kind: "unavailable", brandId: "x" }, conversationId: "c" }` → devuelve `{ skipped: true, note: "Marca de la cuenta no disponible" }` y no llama a Claude.
3. `{ resolution: { kind: "default" }, conversationId: null }` → comportamiento de hoy: historial por contacto y `brand` undefined.

- [ ] **Paso 2: Correr y ver que fallan**

Corre: `npx vitest run src/lib/bot/ai-actions.test.ts`

- [ ] **Paso 3: Implementar**

- Cambia `conversationContext(contactId: string, conversationId?: string | null)`. Si viene `conversationId`, el `where` es `{ conversationId, internalNote: false }` y, si no, el de hoy.
- En AI_DRAFT, al inicio:

```ts
  // Marca de la conversación más reciente del contacto (2026-10-09, spec marcas-agente §3.5).
  const { resolution: brandRes, conversationId: brandConvId } = await resolveBrandForContact(contact.id);
  if (brandRes.kind === "unavailable") return { skipped: true, note: "Marca de la cuenta no disponible" };
  const brand = brandRes.kind === "brand" ? brandRes.brand : null;
  const history = await conversationContext(contact.id, brand ? brandConvId : null);
```

- Si hay `brand`: no selecciones `agentProfile` (déjalo `null`), usa `brand.tonePreset` si existe, pide el catálogo con `{ developmentIds: brand.developmentIds, limit: 10 }` y pasa `brand: { name, persona, knowledge }` a `buildSystemPrompt` con el spread condicional de la Tarea 5.
- El playbook para `resolveDraftObjective`: si `brand?.playbookId`, carga ese playbook con la **misma** consulta e `include` que usa `resolveDraftObjective` para el global. Lee la función y pásalo en la forma que espera su cuarto parámetro; si no existe, pasa `null`.

- [ ] **Paso 4: Correr**

Corre: `npx vitest run src/lib/bot`. Esperado: PASA.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/bot/ai-actions.ts src/lib/bot/ai-actions.test.ts
git commit -m "feat(marcas): borradores AI_DRAFT con la marca de la conversación más reciente"
```

---

### Tarea 7: Entrada de leads: plaza por marca y atribución

**Archivos:**
- Modificar: `src/lib/intake/capture-lead.ts` (~85-145 y el final de la función), `src/lib/intake/campaign-plaza.ts` (comentario de `MERIDA_SIGNALS`)
- Prueba: el archivo de pruebas existente de `capture-lead` (búscalo con `src/lib/intake/capture-lead*.test.ts`). Si no hay, crea `src/lib/intake/capture-lead.brand.test.ts`, con mocks de `@/lib/db` e `intake-lock` como en las pruebas de intake existentes.

**Interfaces:**
- Consume: `attachBrand`, `getDefaultBrandId` (Tarea 2).

- [ ] **Paso 1: Pruebas que fallan**

1. **Cuenta con marca no predeterminada y `defaultPlaza: "MERIDA"`.** Mockea la lectura de la cuenta dentro del lock (`db.leadConnector.findUnique`) para que devuelva `{ name: "IG Cuenta X", brandId: "b-yax", brand: { isDefault: false, defaultPlaza: "MERIDA", deletedAt: null } }`. Se espera:
   - un contacto nuevo con `targetPlaza: "MERIDA"`, aunque las señales digan "nativa";
   - `attachBrand` llamado con `{ contactId, brandId: "b-yax", connectorId, contactIsNew: true }`.
2. **Cuenta con marca no predeterminada pero sin `defaultPlaza`** → la plaza sale de `resolveTargetPlaza(señales)`, como hoy.
3. **Contacto existente que llega por una cuenta de marca:**
   - `attachBrand` se llama con `contactIsNew: false`;
   - **no** se actualizan `targetPlaza` ni `assignedToId` del contacto: ninguna llamada a `contact.update` cambia esos campos.
4. **Cuenta sin `brandId`** → `attachBrand` se llama con `brandId` = resultado de `getDefaultBrandId()` ("b-def"). Si `getDefaultBrandId` devuelve `null`, `attachBrand` no se llama.
5. **Sin `connectorId`** → `attachBrand` no se llama.

- [ ] **Paso 2: Correr y ver que fallan**

- [ ] **Paso 3: Implementar**

Dentro del lock, reemplaza la lectura del nombre de la cuenta por:

```ts
      let connectorName: string | null = null;
      let brandPlaza: Plaza | null = null;
      if (opts.connectorId) {
        const conn = await db.leadConnector.findUnique({
          where: { id: opts.connectorId },
          select: { name: true, brand: { select: { isDefault: true, defaultPlaza: true, deletedAt: true } } },
        });
        connectorName = conn?.name ?? null;
        // Marca de la cuenta (2026-10-09): su plaza predeterminada gana sobre las palabras clave.
        if (conn?.brand && !conn.brand.isDefault && !conn.brand.deletedAt) brandPlaza = conn.brand.defaultPlaza ?? null;
      }
      const targetPlaza = brandPlaza ?? resolveTargetPlaza([lead.campaignName, lead.adName, lead.adsetName, connectorName, lead.sourceDetail]);
```

Importa `Plaza` desde `@prisma/client` si no está.

**Después** de que `withIntakeLock` devuelve, y antes del ruteo y del `return`, lee cómo se llama la variable con el resultado (`outcome.existing` / `outcome.created`) y agrega:

```ts
  // Atribución contacto ↔ marca (2026-10-09). Fuera de la transacción del candado: un
  // error dentro de una transacción de Postgres la aborta; attachBrand nunca lanza.
  if (opts.connectorId && contactIdFinal) {
    const brandId = connectorBrandId ?? (await getDefaultBrandId());
    if (brandId) await attachBrand({ contactId: contactIdFinal, brandId, connectorId: opts.connectorId, contactIsNew: isNew });
  }
```

Aquí `connectorBrandId` es el `brandId` de la cuenta: devuélvelo desde el lock, agregando `brandId: true` al `select`, o léelo otra vez fuera del lock con `prisma.leadConnector.findUnique`. Usa la opción que menos cambie el flujo. `contactIdFinal` e `isNew` son los nombres reales que use la función; adáptalos.

En `campaign-plaza.ts`, cambia el comentario de `MERIDA_SIGNALS` a: "Respaldo para leads SIN cuenta (Lead Ads sin conector de marca, WhatsApp directo). Desde 2026-10-09 la plaza de un lead que entra por una cuenta con marca la da `brand.defaultPlaza` (capture-lead.ts)." No cambies la lógica.

- [ ] **Paso 4: Correr**

Corre: `npx vitest run src/lib/intake`. Esperado: PASA.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/intake
git commit -m "feat(marcas): plaza por marca de la cuenta y atribución contacto-marca en la entrada de leads"
```

---

### Tarea 8: Webhooks: Lead Ads estricto, WhatsApp con número desconocido y media por cuenta

**Archivos:**
- Modificar: `src/app/api/connectors/meta/webhook/route.ts` (~95-125), `src/app/api/webhooks/whatsapp/meta/route.ts` (~235-260 y donde se agrega a `botTargets` y se resuelve media), `src/lib/whatsapp/media.ts`
- Pruebas: las existentes de cada ruta (búscalas con `src/app/api/connectors/meta/webhook/*.test.ts` y `src/app/api/webhooks/whatsapp/meta/*.test.ts`); si no hay, créalas junto a la ruta. Además, `src/lib/whatsapp/media.test.ts` (nueva o existente).

**Interfaces:**
- Consume: `getWhatsAppCredentials(connector)` (`src/lib/whatsapp/accounts.ts`, existente).
- Produce: `resolveWaMediaToStorage(mediaId: string, accessToken?: string | null)`.

- [ ] **Paso 1: Pruebas que fallan**

Lead Ads:
1. **Dos cuentas META activas**, la firma valida con la A, y `page_id` no coincide con ninguna:
   - el lead **no** se reserva (`reservarLeadEntrante` no se llama);
   - se registra un `console.warn` que contiene el `page_id`;
   - la respuesta es 200.
2. **Una sola cuenta META activa** y un `page_id` distinto → se procesa con esa cuenta, como hoy.
3. **Dos cuentas** y un `page_id` que coincide con la B → se procesa con la B.

WhatsApp webhook:

4. **`phone_number_id` desconocido** (ni cuenta ni `META_WA_PHONE_NUMBER_ID`):
   - el mensaje se ingiere;
   - `botRespond` **no** se llama para ese contacto;
   - se registra un `console.warn` con el id.
5. **`phone_number_id` igual a `META_WA_PHONE_NUMBER_ID`** sin cuenta → el agente se llama, como hoy.
6. **`resolveConnectorByPhoneNumberId` lanza error** → se trata como desconocido: sin agente (Foco de revisión 4).
7. **Media con cuenta resuelta** → `resolveWaMediaToStorage` recibe el `accessToken` de la cuenta.

Media:

8. `resolveWaMediaToStorage("m1", "tok-cuenta")` usa `Bearer tok-cuenta`.
9. Sin token → usa `process.env.META_WA_ACCESS_TOKEN`, como hoy.
10. Ambos vacíos → `null`.

- [ ] **Paso 2: Correr y ver que fallan**

- [ ] **Paso 3: Implementar**

Lead Ads:

```ts
      // Cuenta de ESA página. Con 2+ cuentas META (2+ marcas) un page_id sin cuenta NO se
      // asigna a otra: antes caía en la cuenta cuya firma validó y podía contarse como de
      // otra marca (2026-10-09, spec marcas-agente §4.2). Con una sola cuenta se conserva el
      // respaldo (instalación de una sola página).
      const byPage = connectors.find((c) => readCredentials<MetaCredentials>(c)?.pageId === pageId);
      const target = byPage ?? (connectors.length === 1 ? matched.connector : null);
      if (!target) {
        console.warn("[meta-leadgen] page_id sin cuenta registrada; lead no asignado", { pageId, leadgenId });
        results.push({ status: "pagina_sin_cuenta" });
        continue;
      }
```

WhatsApp webhook: conserva también el objeto de la cuenta para el token.

```ts
      let connectorId: string | null = null;
      let connectorToken: string | null = null;
      let unknownNumber = false;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      if (phoneNumberId) {
        try {
          const conn = await resolveConnectorByPhoneNumberId(phoneNumberId);
          connectorId = conn?.id ?? null;
          connectorToken = conn ? getWhatsAppCredentials(conn)?.accessToken ?? null : null;
        } catch (err) {
          console.error("[whatsapp-meta] resolución de conector falló:", err);
        }
        // Número que llegó a la app pero no está dado de alta (2026-10-09, spec §4.3): se
        // ingiere para no perderlo, pero el agente NO contesta — respondería desde el número
        // global, o sea desde el WhatsApp de otra marca.
        unknownNumber = !connectorId && phoneNumberId !== process.env.META_WA_PHONE_NUMBER_ID?.trim();
        if (unknownNumber) console.warn("[whatsapp-meta] phone_number_id sin cuenta registrada; sin respuesta automática", { phoneNumberId });
      }
```

Busca en la ruta dónde se hace `botTargets.set(...)` y no lo hagas si `unknownNumber`. Busca dónde se llama `resolveWaMediaToStorage(mediaId)` y pasa `connectorToken` como segundo argumento.

`media.ts`:

```ts
export async function resolveWaMediaToStorage(
  mediaId: string,
  accessToken?: string | null,
): Promise<{ path: string; mimeType: string | null } | null> {
  try {
    // Token de la cuenta que recibió el mensaje (2026-10-09); sin cuenta, el global de siempre.
    const token = accessToken?.trim() || process.env.META_WA_ACCESS_TOKEN?.trim();
    // ...igual
```

- [ ] **Paso 4: Correr**

Corre: `npx vitest run src/app/api/connectors src/app/api/webhooks src/lib/whatsapp`. Esperado: PASA.

- [ ] **Paso 5: Commit**

```bash
git add src/app/api/connectors/meta/webhook src/app/api/webhooks/whatsapp src/lib/whatsapp
git commit -m "feat(marcas): Lead Ads sin asignación cruzada, WhatsApp de número desconocido sin agente y media por cuenta"
```

---

### Tarea 9: WhatsApp en Conexiones: prueba real y `accessToken` obligatorio

**Archivos:**
- Modificar: `src/lib/connectors/registry.ts` (`TestKind`, `WHATSAPP_FIELDS`, `WHATSAPP_STEPS`, entrada `WHATSAPP`), `src/lib/connectors/test-connection.ts`, `src/app/api/admin/connectors/route.ts` (validación de WHATSAPP en POST)
- Pruebas: `src/lib/connectors/test-connection.test.ts`, `src/lib/connectors/registry.test.ts`

**Interfaces:**
- Produce: `TestKind` incluye `"whatsapp"`, y `testConnection("WHATSAPP", { phoneNumberId, accessToken, ... })`.

- [ ] **Paso 1: Pruebas que fallan**

En `test-connection.test.ts`, siguiendo cómo se mockea `fetch` ahí:

```ts
it("WHATSAPP: valida el número contra Graph y devuelve nombre y teléfono", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ verified_name: "Yaxnáh Caucel", display_phone_number: "+52 999 368 4863", id: "123" }), { status: 200 }));
  const r = await testConnection("WHATSAPP", { phoneNumberId: "123", accessToken: "tok-test" });
  expect(r).toEqual({ ok: true, accountName: "Yaxnáh Caucel · +52 999 368 4863" });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://graph.facebook.com/v24.0/123?fields=display_phone_number,verified_name",
    { headers: { Authorization: "Bearer tok-test" } },
  );
});
it("WHATSAPP: token inválido → ok:false con el mensaje de Graph", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 401 }));
  expect(await testConnection("WHATSAPP", { phoneNumberId: "123", accessToken: "x" })).toEqual({ ok: false, detail: "Invalid OAuth access token" });
});
it("WHATSAPP: faltan datos → ok:false sin llamar a Graph", async () => {
  expect(await testConnection("WHATSAPP", { phoneNumberId: "", accessToken: "" })).toEqual({ ok: false, detail: "Faltan Phone Number ID o Access Token." });
  expect(fetchMock).not.toHaveBeenCalled();
});
```

En `registry.test.ts`: la entrada WHATSAPP tiene `testKind: "whatsapp"`, y el campo `accessToken` no menciona "opcional".

- [ ] **Paso 2: Correr y ver que fallan**

- [ ] **Paso 3: Implementar**

En `registry.ts`:
- agrega `"whatsapp"` al tipo `TestKind`;
- en la entrada WHATSAPP, cambia `testKind: "whatsapp"`;
- en `WHATSAPP_FIELDS`, el `accessToken` pasa a `{ key: "accessToken", label: "Access Token (System User, permanente)", help: "Token con acceso a la WABA de este número. Se usa para responder y para descargar fotos y audios.", secret: true }`;
- actualiza el comentario que dice que `accessToken` es opcional;
- en `WHATSAPP_STEPS`, el último paso pasa a `{ title: "Prueba y guarda", body: "Validamos el número y el token contra la API de Meta y guardamos el token cifrado." }`;
- el campo `brand` de texto queda, con la etiqueta "Marca visible en el Inbox (opcional)". La marca del agente se elige con el selector de la Tarea 11.

En `test-connection.ts`, agrega el caso:

```ts
      case "whatsapp": {
        if (!creds.phoneNumberId || !creds.accessToken) return { ok: false, detail: "Faltan Phone Number ID o Access Token." };
        const res = await fetch(
          `https://graph.facebook.com/v24.0/${encodeURIComponent(creds.phoneNumberId)}?fields=display_phone_number,verified_name`,
          { headers: { Authorization: `Bearer ${creds.accessToken}` } }
        );
        const data = (await res.json()) as { verified_name?: string; display_phone_number?: string; error?: { message?: string } };
        if (!res.ok || data.error) return { ok: false, detail: data.error?.message ?? `HTTP ${res.status}` };
        return { ok: true, accountName: [data.verified_name, data.display_phone_number].filter(Boolean).join(" · ") };
      }
```

El chequeo de faltantes va **antes** del `fetch` y dentro del `case`, así que el orden de la prueba se cumple.

En el `POST` de `api/admin/connectors/route.ts`, después de la validación de `phoneNumberId`:

```ts
  if (parsed.data.provider === "WHATSAPP" && !parsed.data.credentials?.accessToken) {
    return NextResponse.json({ error: "accessToken requerido para WhatsApp (se usa para responder y descargar media)" }, { status: 400 });
  }
```

- [ ] **Paso 4: Correr**

Corre: `npx vitest run src/lib/connectors src/app/api/admin/connectors`. Esperado: PASA.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/connectors src/app/api/admin/connectors/route.ts
git commit -m "feat(conexiones): prueba real de WhatsApp contra Graph y accessToken obligatorio"
```

---

### Tarea 10: API de marcas y `brandId` en la API de cuentas

**Archivos:**
- Crear:
  - `src/lib/brands/roles.ts`
  - `src/lib/validations/brand.ts`
  - `src/app/api/admin/brands/route.ts`
  - `src/app/api/admin/brands/[id]/route.ts`
  - `src/app/api/admin/brands/developments/route.ts`
- Modificar: `src/app/api/admin/connectors/route.ts` (GET y POST), `src/app/api/admin/connectors/[id]/route.ts` (PATCH)
- Pruebas: `src/lib/brands/roles.test.ts`, `src/lib/validations/brand.test.ts`, `src/app/api/admin/brands/route.test.ts`, `src/app/api/admin/brands/[id]/route.test.ts`, y casos de `brandId` en las pruebas de connectors, si existen (si no, crea `src/app/api/admin/connectors/brand.test.ts`).

**Interfaces:**
- Produce:

```ts
// roles.ts
export const BRAND_READ_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"] as const; // = roles de /conexiones
export const BRAND_WRITE_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"] as const;             // = roles de config del bot
export function canReadBrands(role: string | null | undefined): boolean;
export function canWriteBrands(role: string | null | undefined): boolean;

// validations/brand.ts
export const BRAND_CHANNELS = ["WHATSAPP", "INSTAGRAM", "MESSENGER"] as const;
export const brandCreateSchema: z.ZodObject<...>; // ver abajo
export const brandPatchSchema: z.ZodObject<...>;  // todos opcionales, sin isDefault
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;
```

Las respuestas HTTP son:
- `GET /api/admin/brands` → `{ data: Array<Brand & { connectors: { id, name, provider, status }[] }> }`;
- `POST` → `201 { data: Brand }`;
- `PATCH /[id]` → `{ data: Brand }`;
- `DELETE /[id]` → `{ ok: true }`;
- `GET /developments?q=` → `{ data: Array<{ id: string; name: string; city: string | null }> }`.

- [ ] **Paso 1: Pruebas que fallan**

`roles.test.ts`:
- MARKETING puede leer y no escribir;
- GERENTE puede las dos cosas;
- ASESOR no puede ninguna;
- `null` no puede ninguna.

`brand.test.ts` (validación):
- `slug` debe cumplir `/^[a-z0-9-]{2,40}$/`;
- `name` tiene entre 2 y 80 caracteres;
- `enabledChannels` es `null` o un arreglo de `BRAND_CHANNELS`, y `["SMS"]` es inválido;
- `developmentIds` es un arreglo de uuid con máximo 20;
- `defaultPlaza` es uno de `PDC | TULUM | MERIDA` o `null`;
- `tonePreset` es uno de los 4 presets o `null`;
- `persona` tiene máximo 2,000 caracteres y `knowledge` máximo 20,000;
- `botEnabled` es booleano y por defecto `false`;
- `playbookId` y `marketingOwnerUserId` son uuid o `null`;
- el esquema no acepta `isDefault` (`.strict()`).

`brands/route.test.ts` (mock de `getServerSession` y `prisma`):
- sin sesión, o con rol ASESOR → 403;
- GET con MARKETING → 200, lista no borradas, ordenada por `isDefault desc, name asc`, e incluye sus cuentas no borradas;
- POST con MARKETING → 403;
- POST con GERENTE y cuerpo válido → 201, crea con `isDefault: false`, y escribe `auditLog`;
- POST con `slug` o `name` repetido (Prisma P2002) → 409;
- POST con `playbookId` inexistente → 400;
- POST con `marketingOwnerUserId` de un usuario inactivo → 400;
- tabla inexistente (P2021) en GET → 200 `{ data: [] }`.

`brands/[id]/route.test.ts`:
- PATCH de la predeterminada que intenta cambiar algo distinto de `name` → 400 "La marca predeterminada usa la configuración global del bot; solo se puede renombrar";
- PATCH válido → 200 y `auditLog`;
- DELETE de la predeterminada → 400;
- DELETE de una marca con cuentas activas (`leadConnector.count > 0` con `status: "ACTIVE", deletedAt: null`) → 409;
- DELETE válido → borrado lógico (`deletedAt`).

Cuentas:
- POST con `brandId` inexistente o borrado → 400;
- POST con `brandId` válido → se guarda;
- PATCH con `brandId: null` → se guarda `null`;
- GET incluye `brandId` y `brand: { id, name }`.

- [ ] **Paso 2: Correr y ver que fallan**

- [ ] **Paso 3: Implementar**

`src/lib/brands/roles.ts`: módulo puro, con el mismo estilo que `src/lib/comments/roles.ts` y comentario de por qué existen dos listas.

`src/lib/validations/brand.ts`:

```ts
import { z } from "zod";

export const BRAND_CHANNELS = ["WHATSAPP", "INSTAGRAM", "MESSENGER"] as const;

const base = {
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, "Solo minúsculas, números y guiones (2-40)"),
  persona: z.string().max(2000).nullable().optional(),
  knowledge: z.string().max(20000).nullable().optional(),
  developmentIds: z.array(z.string().uuid()).max(20).optional(),
  defaultPlaza: z.enum(["PDC", "TULUM", "MERIDA"]).nullable().optional(),
  enabledChannels: z.array(z.enum(BRAND_CHANNELS)).nullable().optional(),
  tonePreset: z.enum(["PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"]).nullable().optional(),
  playbookId: z.string().uuid().nullable().optional(),
  marketingOwnerUserId: z.string().uuid().nullable().optional(),
  botEnabled: z.boolean().optional(),
};

export const brandCreateSchema = z.object(base).strict();
export const brandPatchSchema = z.object(base).partial().strict();
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;
```

Confirma los valores de `Plaza` y `BotTonePreset` contra `prisma/schema.prisma`.

Rutas: copia la estructura de `src/app/api/admin/comment-rules/route.ts` (helpers `assertRole`, `isMissingTable`, `isUniqueNameClash`, `auditLog.create(...).catch(() => {})`), con estas diferencias:
- La lectura usa `canReadBrands` y la escritura `canWriteBrands`.
- Antes de crear o actualizar:
  - si viene `playbookId`, verifica `prisma.botPlaybook.findFirst({ where: { id, deletedAt: null } })`;
  - si viene `marketingOwnerUserId`, verifica `prisma.user.findFirst({ where: { id, isActive: true, deletedAt: null } })`.
- `enabledChannels: null` se guarda como `Prisma.DbNull` (importa `Prisma` de `@prisma/client`). Un arreglo se guarda tal cual.
- `isDefault` nunca viene del cliente: POST crea siempre con `isDefault: false`.
- PATCH de la predeterminada: si el cuerpo trae cualquier clave distinta de `name`, responde 400 con el mensaje de arriba.
- DELETE: rechaza la predeterminada (400) y las marcas con cuentas activas (409). Si no, `update({ data: { deletedAt: new Date(), botEnabled: false } })`.
- `developments/route.ts` (lectura con `canReadBrands`): busca desarrollos **publicados** por nombre. Revisa en `src/lib/hub/catalog.ts` si ya existe una función de listado publicado con búsqueda (por ejemplo `listPublishedDevelopments`) y úsala. Si no, agrega en `catalog.ts`:

```ts
export async function searchPublishedDevelopments(q: string, limit = 20): Promise<CatalogResult<Array<{ id: string; name: string; city: string | null }>>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; city: string | null }>>(
      `SELECT d.id::text AS id, d.name::text AS name, d.city::text AS city
         FROM real_estate_hub.v_developments d
        WHERE d.approved_at IS NOT NULL AND d.deleted_at IS NULL
          AND ($1::text = '' OR d.name ILIKE '%' || $1 || '%')
        ORDER BY d.name ASC
        LIMIT ${clampLimit(limit, 20, 50)}`,
      q.trim()
    );
    return { data: rows, error: null };
  } catch (err) {
    return fail("searchPublishedDevelopments", err, []);
  }
}
```

Antes de usar `d.approved_at` y `d.deleted_at`, confirma que existen en `v_developments` mirando las otras consultas de `catalog.ts` sobre esa vista (la spec y la consulta del 2026-10-09 los usan). La respuesta de la ruta es `{ data }` o 502 con `{ error }` si `error`.

Cuentas:
- `createSchema` y `patchSchema` agregan `brandId: z.string().uuid().nullable().optional()`.
- En POST y PATCH, si `brandId` es un string, verifica `prisma.brand.findFirst({ where: { id: brandId, deletedAt: null } })`; si no existe, responde 400 "Marca no encontrada".
- PATCH: `if (parsed.data.brandId !== undefined) data.brandId = parsed.data.brandId;`.
- GET: agrega `brandId: true, brand: { select: { id: true, name: true } }` al `select`.

- [ ] **Paso 4: Correr**

Corre: `npx vitest run src/lib/brands src/lib/validations src/app/api/admin/brands src/app/api/admin/connectors`. Esperado: PASA.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/brands/roles.ts src/lib/brands/roles.test.ts src/lib/validations/brand.ts src/lib/validations/brand.test.ts src/app/api/admin/brands src/app/api/admin/connectors src/lib/hub/catalog.ts
git commit -m "feat(marcas): API de marcas (CRUD, buscador de desarrollos) y brandId en la API de cuentas"
```

---

### Tarea 11: UI: pestaña "Marcas del agente", tarjeta en Bot conversacional, selector en Conexiones e Inbox

**Archivos:**
- Crear: `src/components/admin/brands/brands-tab.tsx`, `src/components/admin/brands/brand-form-dialog.tsx`
- Modificar:
  - `src/components/admin/admin-content.tsx`: `ADMIN_TAB_TITLES` ~135 y el render de tabs ~951;
  - `src/components/config/config-center.tsx`: sección "Bot conversacional" ~78-84;
  - `src/components/conexiones/connect-wizard.tsx`;
  - `src/components/conexiones/connections-view.tsx`: la edición de una cuenta; si la edición vive en otro componente, búscalo desde ahí;
  - `src/components/inbox/inbox-view.tsx`: ~122, la etiqueta de marca;
  - el endpoint o consulta que alimenta esa etiqueta: búscalo desde `inbox-view.tsx`.
- Pruebas: `src/components/config/config-center.test.ts` (si verifica tarjetas, agrega la nueva). Para la UI basta `npm run typecheck`, `npm run lint` y una prueba pura de cualquier helper que extraigas.

**Interfaces:**
- Consume: las rutas de la Tarea 10.

- [ ] **Paso 1: Tarjeta y pestaña**

En `config-center.tsx`, sección "Bot conversacional", agrega después de "Agentes conversacionales":

```ts
{ href: "/admin?tab=botBrands", icon: Tag, title: "Marcas del agente", items: ["Presentación y conocimiento por marca", "Catálogo por marca", "Canales y encendido por marca", "Cuentas asignadas"] },
```

Importa `Tag` de `lucide-react`.

En `admin-content.tsx`:
- agrega `botBrands: "Marcas del agente"` a `ADMIN_TAB_TITLES`;
- agrega el render `{activeTab === "botBrands" && <BrandsTab canWrite={["ADMIN", "DIRECTOR", "GERENTE"].includes(currentUserRole)} />}` junto al de `botAgents`.

`BrandsTab` hace su propio `fetch`, así que no hay que cambiar `page.tsx`. Si `/admin` tiene un guard de roles por tab, verifica en `src/app/(dashboard)/admin/page.tsx` que `botBrands` quede con el mismo guard que `bot`.

- [ ] **Paso 2: `BrandsTab`**

Hace `fetch("/api/admin/brands")` al montar y muestra una `Card` por marca con:
- el nombre;
- el badge "Predeterminada" si `isDefault`;
- el badge "Agente encendido" o "apagado";
- la plaza;
- el número de desarrollos;
- la lista de cuentas (nombre · proveedor · estado).

Botones "Nueva marca" y "Editar" (solo si `canWrite`) abren `BrandFormDialog`. Para la predeterminada, el diálogo solo permite editar `name` y muestra el texto: "La marca predeterminada usa la configuración global del bot (pestaña Bot). Sus cuentas son todas las que no tienen marca asignada."

Usa los componentes de `@/components/ui/*` (`Card`, `Badge`, `Button`, `Input`, `Label`, `Select`, `Dialog`) y `useToast`, como `bot-agents-tab.tsx`. Lee ese archivo primero y copia su estructura de carga, error y guardado.

- [ ] **Paso 3: `BrandFormDialog`**

| Campo | Control |
|---|---|
| Nombre | `Input` |
| Identificador (slug) | `Input`, sugerido a partir del nombre: minúsculas, sin acentos, espacios → `-`. Solo editable al crear. |
| Presentación | `textarea`, 4 filas, con placeholder "Eres el asistente comercial de {Marca}, …" |
| Conocimiento | `textarea`, 14 filas, con la ayuda: "Precios y promociones vigentes, crédito, horario, contacto oficial y QUÉ NO SE PUEDE DECIR. El agente solo cita lo que está aquí o en el catálogo." |
| Desarrollos del Hub | Buscador: `Input` que llama `GET /api/admin/brands/developments?q=` con debounce de 300 ms, lista de resultados con botón "Agregar" y chips de los elegidos con "×". Al editar, muestra los ya guardados; si el nombre no está en los resultados, muestra el id. |
| Plaza predeterminada | `Select` (PDC / TULUM / MERIDA / Ninguna), con `PLAZA_LABELS` de `@/lib/constants` |
| Canales | Tres checkboxes (WhatsApp, Instagram, Messenger) más la opción "Usar los globales"; esa opción manda `null` |
| Tono | `Select` con los 4 presets más "Usar el global" (`null`). Toma las etiquetas de `tone-presets.ts` si exporta labels; si no, usa el nombre del enum. |
| Playbook | `Select` con los playbooks de `GET` (la misma fuente que usa `playbook-tab.tsx`), más "Ninguno" |
| Responsable de marketing | `Select` de usuarios activos (la misma fuente de usuarios que ya usa `admin-content.tsx` o una ruta existente de usuarios), más "El global" |
| Agente encendido | `Switch` o checkbox. Al prenderlo, si `knowledge` está vacío, muestra una confirmación: "Esta marca no tiene conocimiento cargado. ¿Encender de todos modos?" |

Al guardar, `POST` o `PATCH`; muestra el error del servidor en un toast y recarga la lista.

- [ ] **Paso 4: Selector de marca en Conexiones**

En `connect-wizard.tsx`:
- carga `GET /api/admin/brands` cuando el diálogo se abre;
- en el último paso, debajo de "Nombre de la cuenta", agrega un `select` nativo, con el mismo estilo `form-input` que los campos vecinos, etiquetado "Marca del agente", con "Predeterminada (Propyte)" = `null` más las marcas no predeterminadas;
- envía `brandId` en el `POST`;
- texto de ayuda: "Define con qué marca responde el agente en esta cuenta y a qué marca se atribuyen sus leads.".

En la edición de una cuenta existente (`connections-view.tsx`, o el componente de edición): el mismo selector, que guarda con `PATCH { brandId }`. La lista de cuentas muestra el nombre de la marca si `brand`.

- [ ] **Paso 5: Inbox**

La etiqueta de la conversación ("WhatsApp · Marca") usa `connector.brand?.name ?? connector.config.brand`. Encuentra la consulta que trae `connector` para la bandeja (desde `inbox-view.tsx:122`, sube a su fuente de datos) y agrégale `brand: { select: { name: true } }`. No cambies los filtros de esa consulta.

- [ ] **Paso 6: Verificar**

Corre: `npm run typecheck` y `npm run lint`. Esperado: sin errores; los avisos previos se toleran.
Corre: `npx vitest run src/components`. Esperado: PASA.

- [ ] **Paso 7: Commit**

```bash
git add src/components src/app
git commit -m "feat(marcas): pestaña Marcas del agente, tarjeta en Bot conversacional, selector de marca en Conexiones e Inbox"
```

Antes de hacer commit, revisa `git status`: agrega **solo** los archivos de esta tarea. Nada de `pnpm-lock.yaml`.

---

### Tarea 12: Auditor de QA, documentación y verificación final

**Archivos:**
- Modificar: `.claude/skills/crm-auditor/safety-contract.md` (~30), `.claude/skills/crm-auditor/provisioning.md` (~34-36), `.env.example`: la sección de WhatsApp, ~38-75.

- [ ] **Paso 1: Auditor**

Lee los dos archivos del auditor. Donde justifican usar MERIDA porque es "la plaza sin inbound":
- reemplaza la justificación: MERIDA ya tiene tráfico real (marca Yaxnáh, desde 2026-10-09). Las cuentas QA siguen siendo seguras **solo** porque las cuentas `.local` están excluidas del ruteo;
- agrega una regla explícita: "Nunca enviar mensajes de prueba por cuentas (conectores) asignadas a una marca no predeterminada, ni prender el agente de una marca para pruebas sin un número de prueba".

No cambies nada más del auditor.

- [ ] **Paso 2: `.env.example`**

En la sección de WhatsApp, agrega un comentario: "Multicuenta (2026-10-09): cada número dado de alta en Conexiones usa SU accessToken para responder y descargar media. META_WA_PHONE_NUMBER_ID/ACCESS_TOKEN quedan como el número global (marca predeterminada). Un phone_number_id que llegue sin cuenta y distinto del global se guarda pero el agente NO lo contesta."

- [ ] **Paso 3: Verificación completa**

Corre, en este orden y reportando la salida resumida:
1. `npm run typecheck` → código 0.
2. `npm test` → todos pasan. Si una prueba falla por timeout de carga, como `password-changed-at`, córrela sola para confirmar que es carga y no un error; repórtalo.
3. `npm run lint` → sin errores.
4. `git diff main --stat` → confirma que `pnpm-lock.yaml` **no** aparece.
5. `git diff main -- src/lib/bot/__snapshots__` → el snapshot congelado no cambió desde su commit inicial.

- [ ] **Paso 4: Commit**

```bash
git add .claude/skills/crm-auditor/safety-contract.md .claude/skills/crm-auditor/provisioning.md .env.example
git commit -m "docs(marcas): auditor QA sin MERIDA como plaza sin tráfico y notas de WhatsApp multicuenta"
```

---

### Tarea 13: Quitar del panel la opción "Agentes automáticos" (Agent Studio)

**Por qué:** lo pidió el usuario el 2026-10-09. La opción que se usa es "Agentes conversacionales" (`BotAgentProfile`). Verificado en producción ese día: la tabla `propyte_crm.agents` tiene 2 agentes ("SDR Speed-to-lead" y "Calificador"), ambos `isActive = false` y con **0 corridas** en `agent_runs` desde siempre. La tarjeta es la única entrada a su pantalla.

**Alcance: solo la UI.** No se tocan:
- `src/lib/agents/*`: `tools.ts` lo usa el servidor MCP (`src/lib/mcp/handlers/agent-tools.ts`, `config.ts`);
- `src/app/api/agents/**` ni `src/app/api/admin/agents/**`;
- los modelos `AgentDef` y `AgentRun`, ni sus tablas o filas.

Si más adelante se quiere retirar el backend, es otra tarea con su propia revisión del MCP.

**Archivos:**
- Modificar: `src/components/config/config-center.tsx`. Quita la tarjeta `{ key: "agents", icon: Bot, title: "Agentes automáticos", ... }` (~línea 72), el `import { AgentsSection } from "./agents-section";`, la clave `"agents"` del tipo `SectionKey` y el render de la sección `agents`. Busca `AgentsSection` y `"agents"` dentro del archivo.
- Borrar: `src/components/config/agents-section.tsx`, y su prueba si existe (`agents-section.test.ts[x]`).
- Modificar: el comentario de cabecera de `config-center.tsx`, que lista "Agentes automáticos (AgentDef, ...)" entre los editores embebidos.
- Prueba: `src/components/config/config-center.test.ts`.

- [ ] **Paso 1: Prueba que falla**

En `config-center.test.ts`, lee qué exporta o verifica (por ejemplo, la lista de secciones o tarjetas) y agrega un caso:
- ninguna tarjeta se titula "Agentes automáticos";
- "Agentes conversacionales" sigue presente.

Si la prueba no tiene acceso a la lista de tarjetas porque no se exporta, exporta la constante de secciones con un nombre explícito (por ejemplo `CONFIG_SECTIONS`) sin cambiar su contenido, y pruébala.

- [ ] **Paso 2: Correr y ver que falla**

Corre: `npx vitest run src/components/config`

- [ ] **Paso 3: Implementar**

Haz los cambios de la lista **Archivos**. Después, `grep -r "agents-section\|AgentsSection" src` no debe devolver nada.

Si `useSearchParams` abre la sección por `?section=agents` o similar, quita ese caso. Un enlace viejo con ese parámetro debe caer al índice, no romper la página.

- [ ] **Paso 4: Verificar**

Corre: `npx vitest run src/components/config`, `npm run typecheck` y `npm run lint`. Esperado: PASA, sin errores.

- [ ] **Paso 5: Commit**

```bash
git add src/components/config
git commit -m "chore(config): quitar del panel 'Agentes automáticos' (sin uso: 2 agentes inactivos, 0 corridas)"
```
