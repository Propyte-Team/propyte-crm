# Editor de mapeo Meta→Contact — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Editor por-conector (en /conexiones) para configurar el mapeo de leads Meta→Contact con fuentes question/metadata/constant, traducciones (value-map) para enums, y dry-run; reusando `LeadConnector.fieldMap` (sin migración).

**Architecture:** Mapper puro `mapLead` + `parseRules` (retrocompat shape viejo) → integrado en el webhook/`processIncomingLead`; zod rico para `fieldMap`; endpoint dry-run; UI drawer. Extensión menor de `incomingLeadSchema`/`captureLead` (contactType/temperature) y fix del clobber de `deriveInvestmentProfile`.

**Tech Stack:** Next.js 14, Prisma, Zod, Vitest, React client. Worktree `.claude/worktrees/crm-sla-segmento`, rama `feat/crm-meta-lead-mapping` off `origin/main` `6064201`. Baseline verde 458 tests. Autor `Propyte-Luis <webkoi@webkoi-ai.com>`. Commits limpios (sin co-author). Ejecutar DENTRO del worktree.

**No migración** (fieldMap es Json). No tocar prod DB.

---

## File Structure
- `src/lib/validations/rebuild-f1.ts` — MODIFICAR (`incomingLeadSchema` += `contactType?`, `temperature?`).
- `src/lib/intake/capture-lead.ts` — MODIFICAR (usar contactType/temperature opcionales con fallback).
- `src/lib/intake/map-lead.ts` — CREAR (`MappingRule`, `parseRules`, `mapLead`).
- `src/lib/intake/map-lead.test.ts` — CREAR.
- `src/lib/intake/mapping-model.ts` — CREAR (`mappingRuleSchema`, `TARGET_FIELDS`, `ENUM_OPTIONS`, `METADATA_KEYS`).
- `src/lib/intake/mapping-model.test.ts` — CREAR.
- `src/app/api/admin/connectors/[id]/route.ts` — MODIFICAR (`fieldMap` union legacy|rich).
- `src/app/api/connectors/meta/webhook/route.ts` — MODIFICAR (extraer *_id; usar mapLead).
- `src/lib/intake/connectors.ts` — MODIFICAR (explicit-wins sobre deriveInvestmentProfile).
- `src/app/api/admin/connectors/[id]/test-mapping/route.ts` — CREAR (dry-run).
- `src/components/conexiones/mapping-editor.tsx` — CREAR.
- `src/components/conexiones/connections-view.tsx` — MODIFICAR (botón "Editar mapeo").

---

## Task 1: Extender incomingLeadSchema + captureLead (contactType/temperature)

**Files:** Modify `src/lib/validations/rebuild-f1.ts`, `src/lib/intake/capture-lead.ts`; Test `src/lib/intake/capture-lead.contacttype.test.ts`

- [ ] **Step 1: Test (leer capture-lead.ts primero para el patrón de mock de prisma existente)**

Crea `src/lib/intake/capture-lead.contacttype.test.ts`. Mockea `@/lib/db` como en otros tests de intake (revisa `capture-lead` tests existentes o `sla.createTimer.test.ts` para el patrón). Casos:
- `captureLead({ source:"FACEBOOK_ADS", firstName:"A", contactType:"BROKER_EXTERNO" }, {connectorId})` → el `contact.create` recibe `contactType:"BROKER_EXTERNO"`.
- Sin `contactType` → `contactType:"COMPRADOR"` (fallback actual).
- `temperature:"HOT"` → create recibe `temperature:"HOT"`; sin él → no lo fuerza (default DB COLD).

- [ ] **Step 2:** Correr → FAIL.

- [ ] **Step 3: Implementar**

En `rebuild-f1.ts`, dentro de `incomingLeadSchema` (junto a los otros opcionales), añade:
```ts
  contactType: z.enum(["COMPRADOR","INVERSIONISTA","BROKER_EXTERNO","EMPLEO","REFERIDOR","LEAD","PROSPECTO","CLIENTE","REFERIDO"]).optional(),
  temperature: z.enum(["HOT","WARM","COLD","DEAD"]).optional(),
```
En `capture-lead.ts`, donde hoy hace `contactType: "COMPRADOR"` en el `contact.create`, cambia a `contactType: lead.contactType ?? "COMPRADOR"` y agrega `...(lead.temperature ? { temperature: lead.temperature } : {})` al objeto data. (Leer el archivo para ubicar el `create`.)

- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5: Commit** `feat(intake): incomingLead acepta contactType/temperature opcionales (para mapeo configurable)`

---

## Task 2: Mapper puro `map-lead.ts`

**Files:** Create `src/lib/intake/map-lead.ts`, `src/lib/intake/map-lead.test.ts`

- [ ] **Step 1: Test** `src/lib/intake/map-lead.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapLead, parseRules, type MappingRule } from "./map-lead";

const input = {
  fieldData: { full_name: "Ana Gómez", email: "a@x.com", "¿presupuesto?": "2mdp", platform_q: "fb" },
  metadata: { campaign_name: "77 - PDC", campaign_id: "123", ad_name: "Ad A" },
};

describe("mapLead", () => {
  it("question → campo; fullName se parte", () => {
    const rules: MappingRule[] = [{ source: "question", metaField: "full_name", target: "fullName" }];
    expect(mapLead(rules, input)).toEqual({ firstName: "Ana", lastName: "Gómez" });
  });
  it("metadata → campo", () => {
    const rules: MappingRule[] = [{ source: "metadata", metaField: "campaign_name", target: "sourceDetail" }];
    expect(mapLead(rules, input)).toEqual({ sourceDetail: "77 - PDC" });
  });
  it("constant → valor fijo", () => {
    const rules: MappingRule[] = [{ source: "constant", value: "META_ADS", target: "source" }];
    expect(mapLead(rules, input)).toEqual({ source: "META_ADS" });
  });
  it("valueMap traduce y aplica; passthrough si mapa vacío (GOTCHA)", () => {
    const tr: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.plat", valueMap: { fb: "Facebook" } }];
    expect(mapLead(tr, input)).toEqual({ "custom.plat": "Facebook" });
    const empty: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.plat", valueMap: {} }];
    expect(mapLead(empty, input)).toEqual({ "custom.plat": "fb" }); // {} = passthrough, NO omite
  });
  it("valueMap sin match → fallback", () => {
    const omit: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.p", valueMap: { ig: "IG" }, fallback: "omit" }];
    expect(mapLead(omit, input)).toEqual({});
    const pass: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.p", valueMap: { ig: "IG" }, fallback: "passthrough" }];
    expect(mapLead(pass, input)).toEqual({ "custom.p": "fb" });
    const fixed: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.p", valueMap: { ig: "IG" }, fallback: "fixed", fallbackValue: "OTRO" }];
    expect(mapLead(fixed, input)).toEqual({ "custom.p": "OTRO" });
  });
  it("omite vacíos (question), constant siempre", () => {
    const r: MappingRule[] = [{ source: "question", metaField: "ausente", target: "email" }, { source: "constant", value: "x", target: "notes" }];
    expect(mapLead(r, input)).toEqual({ notes: "x" });
  });
});

describe("parseRules (retrocompat)", () => {
  it("shape nuevo {rules}", () => {
    const r = parseRules({ rules: [{ source: "constant", value: "v", target: "source" }] });
    expect(r).toHaveLength(1);
  });
  it("shape viejo Record<string,string> → question rules", () => {
    expect(parseRules({ full_name: "fullName", phone_number: "phone" })).toEqual([
      { source: "question", metaField: "full_name", target: "fullName" },
      { source: "question", metaField: "phone_number", target: "phone" },
    ]);
  });
  it("{} → []", () => { expect(parseRules({})).toEqual([]); });
});
```

- [ ] **Step 2:** Correr → FAIL.

- [ ] **Step 3: Implementar** `src/lib/intake/map-lead.ts`:
```ts
// Mapper puro Meta→Contact configurable por conector. Sin BD.
export interface MappingRule {
  source: "question" | "metadata" | "constant";
  metaField?: string;
  target: string;
  value?: string;
  valueMap?: Record<string, string>;
  fallback?: "omit" | "passthrough" | "fixed";
  fallbackValue?: string;
}

// Normaliza el fieldMap almacenado (shape nuevo {rules} | shape viejo Record<string,string>) a reglas.
export function parseRules(fieldMap: unknown): MappingRule[] {
  if (fieldMap && typeof fieldMap === "object" && Array.isArray((fieldMap as { rules?: unknown }).rules)) {
    return (fieldMap as { rules: MappingRule[] }).rules;
  }
  if (fieldMap && typeof fieldMap === "object") {
    return Object.entries(fieldMap as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string")
      .map(([metaField, target]) => ({ source: "question" as const, metaField, target: target as string }));
  }
  return [];
}

function rawValue(rule: MappingRule, input: { fieldData: Record<string, unknown>; metadata: Record<string, unknown> }): unknown {
  if (rule.source === "constant") return rule.value;
  const src = rule.source === "metadata" ? input.metadata : input.fieldData;
  return rule.metaField ? src[rule.metaField] : undefined;
}

function applyValueMap(rule: MappingRule, value: string): string | undefined {
  const vm = rule.valueMap;
  // GOTCHA: {} es truthy → sin la guarda de length omitiría todo. Mapa vacío = passthrough.
  if (!vm || Object.keys(vm).length === 0) return value;
  if (value in vm) return vm[value];
  switch (rule.fallback) {
    case "passthrough": return value;
    case "fixed": return rule.fallbackValue;
    case "omit": default: return undefined;
  }
}

export function mapLead(
  rules: MappingRule[],
  input: { fieldData: Record<string, unknown>; metadata: Record<string, unknown> }
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rule of rules) {
    if (!rule.target) continue;
    let v = rawValue(rule, input);
    if (typeof v === "string") v = v.trim();
    if (v == null || v === "") continue; // constant con value vacío también se omite
    let str = String(v);
    const mapped = applyValueMap(rule, str);
    if (mapped == null) continue;
    str = mapped;
    if (rule.target === "fullName") {
      const parts = str.split(/\s+/);
      out.firstName = parts[0];
      out.lastName = parts.slice(1).join(" ") || "(sin apellido)";
    } else {
      out[rule.target] = str;
    }
  }
  return out;
}
```

- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5: Commit** `feat(intake): mapper puro map-lead (question/metadata/constant + value-map + retrocompat)`

---

## Task 3: zod `mapping-model.ts` + PUT connectors union

**Files:** Create `src/lib/intake/mapping-model.ts`, `src/lib/intake/mapping-model.test.ts`; Modify `src/app/api/admin/connectors/[id]/route.ts`

- [ ] **Step 1: Test** `mapping-model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fieldMapSchema } from "./mapping-model";

describe("fieldMapSchema", () => {
  it("acepta legacy Record<string,string>", () => {
    expect(fieldMapSchema.safeParse({ full_name: "fullName" }).success).toBe(true);
  });
  it("acepta {} ", () => { expect(fieldMapSchema.safeParse({}).success).toBe(true); });
  it("acepta rich rules válidas", () => {
    expect(fieldMapSchema.safeParse({ rules: [{ source: "constant", value: "META_ADS", target: "source" }] }).success).toBe(true);
  });
  it("acepta target custom.*", () => {
    expect(fieldMapSchema.safeParse({ rules: [{ source: "question", metaField: "q", target: "custom.presupuesto" }] }).success).toBe(true);
  });
  it("rechaza target fuera de whitelist", () => {
    expect(fieldMapSchema.safeParse({ rules: [{ source: "question", metaField: "q", target: "ownerId" }] }).success).toBe(false);
  });
  it("rechaza source inválido", () => {
    expect(fieldMapSchema.safeParse({ rules: [{ source: "bogus", target: "email" }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2:** Correr → FAIL.

- [ ] **Step 3: Implementar** `src/lib/intake/mapping-model.ts`:
```ts
import { z } from "zod";

// Campos Contact permitidos como destino (+ custom.*). Deben existir en incomingLeadSchema/captureLead.
export const TARGET_FIELDS = [
  "firstName", "lastName", "fullName", "phone", "email", "source", "sourceDetail", "language",
  "contactType", "temperature", "investmentProfile", "propertyType", "purchaseTimeline",
  "paymentMethod", "purchaseModality", "rentalStrategy", "budgetMin", "budgetMax", "preferredZone", "notes",
] as const;

export const METADATA_KEYS = [
  "campaign_name", "campaign_id", "adset_name", "adset_id", "ad_name", "ad_id", "form_id", "leadgen_id",
] as const;

// Opciones de enum por destino (para el value-map en la UI).
export const ENUM_OPTIONS: Record<string, string[]> = {
  contactType: ["COMPRADOR","INVERSIONISTA","BROKER_EXTERNO","EMPLEO","REFERIDOR"],
  temperature: ["HOT","WARM","COLD","DEAD"],
  source: ["WALK_IN","FACEBOOK_ADS","GOOGLE_ADS","INSTAGRAM","TIKTOK_ADS","LINKEDIN","PORTAL_INMOBILIARIO","REFERIDO_CLIENTE","REFERIDO_BROKER","LLAMADA_FRIA","EVENTO","WEBSITE","WHATSAPP","MESSENGER","OTRO"],
  investmentProfile: ["END_USER","INVESTOR_RENTAL","INVESTOR_FLIP","INVESTOR_LAND","MIXED"],
  propertyType: ["DEPARTAMENTO","CASA","TERRENO","MACROLOTE","LOCAL_COMERCIAL","OTRO"],
  purchaseTimeline: ["IMMEDIATE","ONE_TO_THREE_MONTHS","THREE_TO_SIX_MONTHS","SIX_PLUS_MONTHS"],
  paymentMethod: ["CONTADO","CREDITO_HIPOTECARIO","FINANCIAMIENTO_DIRECTO","MIXTO"],
  purchaseModality: ["PREVENTA","ENTREGA_INMEDIATA","REVENTA","ABIERTO"],
  rentalStrategy: ["LONG_TERM","AIRBNB","BOTH","NA"],
};

const targetSchema = z.string().refine(
  (t) => (TARGET_FIELDS as readonly string[]).includes(t) || /^custom\.[A-Za-z0-9_]+$/.test(t),
  { message: "target inválido" }
);

export const mappingRuleSchema = z.object({
  source: z.enum(["question", "metadata", "constant"]),
  metaField: z.string().optional(),
  target: targetSchema,
  value: z.string().optional(),
  valueMap: z.record(z.string()).optional(),
  fallback: z.enum(["omit", "passthrough", "fixed"]).optional(),
  fallbackValue: z.string().optional(),
});

// Union: legacy Record<string,string> | rich {rules}
export const fieldMapSchema = z.union([
  z.object({ rules: z.array(mappingRuleSchema) }).strict(),
  z.record(z.string()),
]);
```

- [ ] **Step 4:** Correr → PASS.

- [ ] **Step 5: Modificar el PUT** `src/app/api/admin/connectors/[id]/route.ts`: importar `fieldMapSchema` y reemplazar `fieldMap: z.record(z.string()).optional()` por `fieldMap: fieldMapSchema.optional()`. (Leer el archivo; conservar el resto del `patchSchema`.)

- [ ] **Step 6:** `npx tsc --noEmit` (sin errores nuevos). **Commit** `feat(intake): zod fieldMap rico (rules|legacy) + whitelist de destinos`

---

## Task 4: Integración webhook + fix clobber

**Files:** Modify `src/app/api/connectors/meta/webhook/route.ts`, `src/lib/intake/connectors.ts`; Test `src/lib/intake/connectors.explicit-wins.test.ts`

- [ ] **Step 1:** En el webhook (`route.ts`): (a) extender el tipo `lead` y extraer `campaign_id`, `adset_id`, `ad_id` (ya vienen en el `fields=` de Graph); (b) construir `metadata = { campaign_name, campaign_id, adset_name, adset_id, ad_name, ad_id, form_id: change.value?.form_id, leadgen_id: leadgenId }`; (c) reemplazar `mapExternalFields(fieldMap, external)` por `mapLead(parseRules(target.fieldMap), { fieldData: external, metadata })`; conservar la asignación de AdAttribution (`mapped.campaignName=...`, etc.) y `mapped.socialLeadId`. Pasar `metadata` dentro de `rawPayload.meta` (para el dry-run "último lead"). Importa `mapLead, parseRules` de `@/lib/intake/map-lead`.

- [ ] **Step 2: Fix explicit-wins** en `connectors.ts`: donde hoy `const { budgetCurrency, ...profileFields } = ...; Object.assign(fields, profileFields);` — cambiar a rellenar SOLO los campos que el mapeo NO fijó:
```ts
  const { budgetCurrency, ...profileFields } = custom ? deriveInvestmentProfile(custom) : {};
  for (const [k, v] of Object.entries(profileFields)) {
    if (fields[k] === undefined || fields[k] === null || fields[k] === "") fields[k] = v;
  }
```

- [ ] **Step 3: Test** `connectors.explicit-wins.test.ts`: con un `mappedFields` que ya trae `investmentProfile:"INVESTOR_FLIP"` y un `rawPayload.external` cuyo heurístico daría `END_USER`, tras `processIncomingLead` el `captureLead` recibe `investmentProfile:"INVESTOR_FLIP"` (explicit gana). (Mockear prisma + captureLead como en tests de intake existentes; si es más simple, extraer la lógica de merge a un helper puro `mergeProfileDefaults(fields, profileFields)` y testear ese helper directamente — preferible.)

- [ ] **Step 4:** Correr tests intake (`npx vitest run src/lib/intake/`) → PASS. `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(intake): webhook usa map-lead + metadata IDs; mapeo explícito gana sobre heurístico`

---

## Task 5: Endpoint dry-run test-mapping

**Files:** Create `src/app/api/admin/connectors/[id]/test-mapping/route.ts`

- [ ] **Step 1: Implementar** (espejo RBAC de `[id]/route.ts`, `ALLOWED_ROLES = ["ADMIN","DIRECTOR","GERENTE","MARKETING"]`):
```ts
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { mapLead, parseRules } from "@/lib/intake/map-lead";
import { mappingRuleSchema } from "@/lib/intake/mapping-model";
import { z } from "zod";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];
const bodySchema = z.object({
  rules: z.array(mappingRuleSchema),
  sample: z.object({ fieldData: z.record(z.unknown()).optional(), metadata: z.record(z.unknown()).optional() }).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let fieldData = parsed.data.sample?.fieldData ?? {};
  let metadata = parsed.data.sample?.metadata ?? {};
  let usedLastLead = false;
  if (!parsed.data.sample) {
    const last = await prisma.connectorLeadLog.findFirst({
      where: { connectorId: id },
      orderBy: { receivedAt: "desc" },
      select: { rawPayload: true },
    });
    const raw = (last?.rawPayload ?? {}) as { external?: Record<string, unknown>; meta?: Record<string, unknown> };
    if (last) { fieldData = raw.external ?? {}; metadata = raw.meta ?? {}; usedLastLead = true; }
  }
  const mapped = mapLead(parsed.data.rules, { fieldData, metadata });
  return NextResponse.json({ data: { mapped, usedLastLead } });
}
```

- [ ] **Step 2:** `npx tsc --noEmit`. **Commit** `feat(intake): endpoint dry-run POST /admin/connectors/[id]/test-mapping`

---

## Task 6: UI editor de mapeo

**Files:** Create `src/components/conexiones/mapping-editor.tsx`; Modify `src/components/conexiones/connections-view.tsx`

**Referencias:** `connections-view.tsx` (patrón de acciones por conector, fetch PATCH/DELETE), `sla-policy-editor.tsx` (patrón lista+form+guardar creado en sub-D), `mapping-model.ts` (`TARGET_FIELDS`, `METADATA_KEYS`, `ENUM_OPTIONS`).

- [ ] **Step 1:** En `connections-view.tsx`, agregar un 3er botón "Editar mapeo" en el `<span>` de acciones por conector (solo provider META/INSTAGRAM), que abre `<MappingEditor connectorId={c.id} name={c.name} onClose/onSaved={reload}/>`.

- [ ] **Step 2:** Crear `mapping-editor.tsx` (client, drawer/modal):
  - Al abrir: `GET /api/admin/connectors` (o el que liste, para traer el `fieldMap` actual del conector) → `parseRules` para poblar filas. (Si no hay endpoint GET de un conector, reusar la lista ya cargada en connections-view y pasar el fieldMap como prop.)
  - Filas de reglas: `source` select (question/metadata/constant) → si question: input `metaField`; si metadata: select de `METADATA_KEYS`; si constant: input `value`. Luego selector de **campo destino** (input con datalist de `TARGET_FIELDS` + permite `custom.<x>`; filtro insensible a acentos, orden alfabético). Si `target ∈ ENUM_OPTIONS`: sub-editor value-map (pares: input valor-origen → select del enum) + select fallback (omit/passthrough/fixed + input fallbackValue si fixed). Botones "+ Agregar regla", ✕.
  - Botón **"Probar"**: `POST /api/admin/connectors/{id}/test-mapping` con `{ rules }` (sin sample → último lead; o con sample escrito). Muestra `data.mapped` (JSON legible) + si `usedLastLead`.
  - **Guardar**: `PATCH /api/admin/connectors/{id}` con `{ fieldMap: { rules } }`. Cerrar+`onSaved` al 200. Mostrar error 400/403.
  - Validar client-side: cada regla necesita target; question/metadata necesitan metaField; constant necesita value.

- [ ] **Step 3:** `npx tsc --noEmit && npm run build` → verde. **Commit** `feat(conexiones): editor de mapeo Meta→Contact por conector (UI + dry-run)`

---

## Task 7: Verificación final
- [ ] `npx vitest run` → baseline (458) + nuevos verdes.
- [ ] `npx tsc --noEmit` (solo 2 pre-existentes builder-model) + `npm run build` verde.
- [ ] Resumen para review de Luis (no desplegar sin su OK; él dijo "en revisiones volvemos a checar").

---

## Self-Review (cobertura vs spec)
- Fuentes question/metadata/constant → Task 2. ✅
- value-map + GOTCHA {} passthrough → Task 2 (test regresión). ✅
- Retrocompat shape viejo → Task 2 `parseRules`. ✅
- Destinos whitelist + custom.* + contactType/temperature → Task 1 + Task 3. ✅
- Fix clobber deriveInvestmentProfile → Task 4. ✅
- Metadata IDs extraídos → Task 4. ✅
- zod rico + PUT → Task 3. ✅
- dry-run último lead/sample → Task 5. ✅
- UI editor + Probar → Task 6. ✅
- Sin migración; no deploy sin OK. ✅

Nombres consistentes: `mapLead`/`parseRules`/`MappingRule`/`fieldMapSchema`/`mappingRuleSchema`/`TARGET_FIELDS`/`METADATA_KEYS`/`ENUM_OPTIONS`.
