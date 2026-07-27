# Espejo del catálogo publicado (F1) + catálogo del agente IA (F3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/developments` del CRM muestre exactamente los desarrollos y unidades publicados en propyte.com, y que el agente IA consulte ese mismo catálogo con los datos que hoy le faltan.

**Architecture:** Un módulo nuevo `src/lib/hub/catalog.ts` concentra TODA la lectura del catálogo publicado con el gate escrito una sola vez (`approved_at IS NOT NULL AND deleted_at IS NULL` sobre `real_estate_hub.v_developments` / `v_units`). `hub/client.ts` y `bot/hub-catalog.ts` pasan a delegar en él. La pantalla `/developments` deja de leer la tabla Prisma local (0 filas) y consume la capa nueva.

**Tech Stack:** Next.js 14 (App Router, server components), Prisma `$queryRawUnsafe` contra el schema `real_estate_hub` de Supabase, vitest (mock de `@/lib/db`), shadcn/ui + Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-27-espejo-catalogo-publicado-design.md`

---

## Contexto que el implementador necesita

**El CRM no posee inventario.** El catálogo vive en el Hub, schema `real_estate_hub` de la
MISMA base Postgres (Supabase `oaijxdpevakashxshhvm`), accesible por la misma conexión Prisma.
Por eso se lee con SQL crudo (`prisma.$queryRawUnsafe`) y no con modelos Prisma. Es el patrón
ya establecido en `src/lib/hub/client.ts` — síguelo, no lo cambies.

**El bug que estamos arreglando.** Hay tres definiciones de "publicado" conviviendo:

| Dónde | Gate | Devs |
|---|---|---|
| propyte.com | `v_developments` + `approved_at IS NOT NULL` + `deleted_at IS NULL` | **21** |
| `src/lib/hub/client.ts:38` | `Propyte_desarrollos.pipeline_status = 'Publicado'` | 16 |
| `src/lib/bot/hub-catalog.ts:35` | idem | 16 |

El sitio manda. Los otros dos se alinean.

**Tipos de columna verificados** (no adivines):
- `v_developments.images`, `.amenities`, `.property_types` → `text[]` (1-indexado: `images[1]`)
- `v_developments.estimated_delivery` → `date` (castear a `::text`)
- `v_developments.construction_progress` → `int4`; `.commission_rate` → `numeric`
- `v_units.fin_esquemas_pago` → `jsonb`; `.fin_meses_opciones` → `int4[]`
- `v_units.area_m2`, `.built_area_m2` → `numeric` (castear a `::float8`)

**Convención de tests** (mira `src/app/api/admin/automation/plans/route.test.ts`): se mockea
`@/lib/db` con `vi.mock` ANTES de importar el módulo bajo prueba. `vitest.config.ts` tiene
`environment: "node"` e `include: ["src/**/*.test.ts", "src/**/*.test.tsx"]`.

**Comandos:**
- tests: `npm test` (vitest run) — un archivo: `npx vitest run src/lib/hub/catalog.test.ts`
- tipos: `npx tsc --noEmit`
- build: `npm run build`

**Rama:** trabaja en la rama actual. NO cambies a `main`. Hay cambios sin commitear de otra
sesión en `src/components/config/**` y `src/lib/bot/agent-profiles*` — **no los toques ni los
incluyas en tus commits**; usa siempre `git add <rutas explícitas>`, nunca `git add -A`.

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/lib/hub/catalog-types.ts` | Tipos del catálogo publicado (`PublishedDevelopment`, `PublishedUnit`, `CatalogResult`) | Crear |
| `src/lib/hub/catalog.ts` | Única capa de lectura del catálogo publicado. Gate en una constante. | Crear |
| `src/lib/hub/catalog.test.ts` | Gate presente en toda query, columnas internas ausentes, manejo de error | Crear |
| `src/lib/hub/types.ts` | Tipos legados del Hub (`HubDevelopment`, `HubUnit`, …) | Sin cambios |
| `src/lib/hub/client.ts` | Delega lectura en `catalog.ts`, conserva firmas y la mitad de mutación | Modificar |
| `src/lib/bot/hub-catalog.ts` | Catálogo del agente: delega + enriquece + `{ data, error }` | Modificar |
| `src/lib/bot/bot-respond.ts`, `ai-actions.ts`, `claude.ts`, `src/lib/agents/tools.ts`, `src/app/api/records/search/route.ts` | Call sites del catálogo del bot | Modificar |
| `src/app/(dashboard)/developments/page.tsx` | Server component de la lista | Modificar |
| `src/app/(dashboard)/developments/developments-client.tsx` | UI de la lista (espejo) | Reescribir |
| `src/app/(dashboard)/developments/[id]/page.tsx` | Server component de la ficha | Modificar |
| `src/app/(dashboard)/developments/[id]/development-detail-client.tsx` | UI de la ficha (espejo + tabla de unidades) | Reescribir |
| `src/server/developments.ts` | CRUD local — queda deprecated, sin borrar | Modificar (solo cabecera) |

---

## Task 1: Tipos y capa de catálogo con gate único

**Files:**
- Create: `src/lib/hub/catalog-types.ts`
- Create: `src/lib/hub/catalog.ts`
- Test: `src/lib/hub/catalog.test.ts`

- [ ] **Step 1: Crear los tipos**

Crea `src/lib/hub/catalog-types.ts`:

```ts
// Tipos del catálogo PUBLICADO — espejo de lo que muestra propyte.com.
// Fuente de verdad: real_estate_hub.v_developments / v_units con el gate público
// (approved_at IS NOT NULL AND deleted_at IS NULL). El CRM no posee estos datos.

/** Toda lectura del catálogo distingue "vacío legítimo" de "no pude consultar". */
export interface CatalogResult<T> {
  data: T;
  error: string | null;
}

export interface PublishedDevelopment {
  id: string;
  slug: string | null;
  name: string;
  developerName: string | null;
  developmentType: string | null;
  stage: string | null;
  city: string | null;
  state: string | null;
  zone: string | null;
  priceMinMxn: number | null;
  priceMaxMxn: number | null;
  currency: string | null;
  totalUnits: number | null;
  availableUnits: number | null;
  reservedUnits: number | null;
  soldUnits: number | null;
  /** Unidades que realmente están publicadas en el sitio (gate aplicado). */
  publishedUnits: number;
  discountedUnitsCount: number | null;
  coverImage: string | null;
  estimatedDelivery: string | null;
  deliveryText: string | null;
  constructionProgress: number | null;
}

export interface PublishedDevelopmentDetail extends PublishedDevelopment {
  images: string[];
  amenities: string[];
  propertyTypes: string[];
  descriptionEs: string | null;
  descriptionShortEs: string | null;
  roiProjected: number | null;
  roiRentalMonthly: number | null;
  roiAppreciation: number | null;
  financingDownPayment: number | null;
  financingMonths: number | null;
  financingInterest: number | null;
  address: string | null;
  neighborhood: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  beachDistance: string | null;
  brochureUrl: string | null;
  virtualTourUrl: string | null;
  masterplan: string | null;
  videoUrl: string | null;
  commissionRate: number | null;
  crmRelationship: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

export interface PublishedUnit {
  id: string;
  slug: string | null;
  title: string | null;
  unitNumber: string | null;
  unitType: string | null;
  typology: string | null;
  status: string | null;
  isPresale: boolean | null;
  bedrooms: number | null;
  bathrooms: number | null;
  halfBaths: number | null;
  areaM2: number | null;
  builtAreaM2: number | null;
  priceMxn: number | null;
  priceUsd: number | null;
  currency: string | null;
  discountPriceMxn: number | null;
  discountPct: number | null;
  isDiscountActive: boolean | null;
  coverImage: string | null;
  developmentId: string | null;
  developmentName: string | null;
  developmentSlug: string | null;
  city: string | null;
  zone: string | null;
  // Esquemas de pago — lo que el agente IA hoy no puede responder
  finDirecto: boolean | null;
  finHipotecario: boolean | null;
  finEnganchePct: number | null;
  finMesesOpciones: number[] | null;
  finTasa: number | null;
  finEsquemasPago: unknown;
  finPreventa: boolean | null;
}

export interface DevelopmentCatalogFilters {
  search?: string | null;
  city?: string | null;
  zone?: string | null;
  stage?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  onlyWithAvailable?: boolean;
  limit?: number;
}

export interface UnitCatalogFilters {
  developmentId?: string | null;
  search?: string | null;
  bedrooms?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  zone?: string | null;
  limit?: number;
}
```

- [ ] **Step 2: Escribir el test que falla**

Crea `src/lib/hub/catalog.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRaw = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({
  default: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a) },
}));

import {
  PUBLIC_GATE,
  listPublishedDevelopments,
  getPublishedDevelopment,
  listPublishedUnits,
  getPublishedUnit,
} from "./catalog";

/** SQL de la última llamada a $queryRawUnsafe. */
function lastSql(): string {
  return String(queryRaw.mock.calls[queryRaw.mock.calls.length - 1][0]);
}

beforeEach(() => {
  queryRaw.mockClear();
  queryRaw.mockResolvedValue([]);
});

describe("PUBLIC_GATE", () => {
  it("es el mismo gate que usa propyte.com", () => {
    expect(PUBLIC_GATE).toContain("approved_at IS NOT NULL");
    expect(PUBLIC_GATE).toContain("deleted_at IS NULL");
  });
});

describe("gate aplicado en toda lectura", () => {
  it("listPublishedDevelopments filtra por el gate", async () => {
    await listPublishedDevelopments();
    expect(lastSql()).toContain(PUBLIC_GATE);
  });

  it("getPublishedDevelopment filtra por el gate", async () => {
    await getPublishedDevelopment("dev-1");
    expect(lastSql()).toContain(PUBLIC_GATE);
  });

  it("listPublishedUnits filtra por el gate", async () => {
    await listPublishedUnits({ developmentId: "dev-1" });
    expect(lastSql()).toContain(PUBLIC_GATE);
  });

  it("getPublishedUnit filtra por el gate", async () => {
    await getPublishedUnit("unit-1");
    expect(lastSql()).toContain(PUBLIC_GATE);
  });

  it("nunca lee de Propyte_desarrollos ni usa pipeline_status", async () => {
    await listPublishedDevelopments();
    expect(lastSql()).toContain("v_developments");
    expect(lastSql()).not.toContain("pipeline_status");
    expect(lastSql()).not.toContain("Propyte_desarrollos");
  });
});

describe("no expone columnas internas", () => {
  it("no selecciona metadatos de SEO ni de scraping", async () => {
    await listPublishedDevelopments();
    const sql = lastSql();
    for (const col of ["meta_title", "meta_description", "detection_source", "source_url", "keywords"]) {
      expect(sql).not.toContain(col);
    }
  });

  it("nunca usa SELECT *", async () => {
    await listPublishedDevelopments();
    expect(lastSql()).not.toMatch(/select\s+\*/i);
  });
});

describe("manejo de errores", () => {
  it("distingue fallo de vacío legítimo", async () => {
    queryRaw.mockRejectedValueOnce(new Error("connection refused"));
    const res = await listPublishedDevelopments();
    expect(res.data).toEqual([]);
    expect(res.error).toBeTruthy();
  });

  it("vacío legítimo no reporta error", async () => {
    const res = await listPublishedDevelopments();
    expect(res.data).toEqual([]);
    expect(res.error).toBeNull();
  });

  it("getPublishedDevelopment devuelve null sin error cuando no existe", async () => {
    const res = await getPublishedDevelopment("no-existe");
    expect(res.data).toBeNull();
    expect(res.error).toBeNull();
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/hub/catalog.test.ts`
Expected: FAIL — `Failed to resolve import "./catalog"`.

- [ ] **Step 4: Implementar `catalog.ts`**

Crea `src/lib/hub/catalog.ts`:

```ts
// Catálogo PUBLICADO — única capa de lectura de lo que propyte.com muestra al público.
//
// El gate vive en UNA constante (PUBLIC_GATE) y se interpola en todas las queries.
// Motivo: repetir el criterio a mano produjo tres definiciones divergentes de "publicado"
// (sitio 21 devs vs pipeline_status='Publicado' 16). Si necesitas una query nueva,
// interpola PUBLIC_GATE — no reescribas la condición.
//
// SQL directo al schema real_estate_hub por la MISMA conexión Postgres, igual que
// src/lib/hub/client.ts y que el sitio web. El CRM no posee inventario: solo lo consulta.
import prisma from "@/lib/db";
import type {
  CatalogResult,
  DevelopmentCatalogFilters,
  PublishedDevelopment,
  PublishedDevelopmentDetail,
  PublishedUnit,
  UnitCatalogFilters,
} from "./catalog-types";

/** Gate público: idéntico al de Next_Propyte_web/src/lib/supabase/queries.ts */
export const PUBLIC_GATE = "approved_at IS NOT NULL AND deleted_at IS NULL";

function fail<T>(fnName: string, err: unknown, fallback: T): CatalogResult<T> {
  console.error(`[hub/catalog] ${fnName} falló`, { err });
  return { data: fallback, error: "No se pudo consultar el catálogo del Hub" };
}

// Columnas de tarjeta/lista. `publishedUnits` cuenta unidades con el MISMO gate,
// no confía en el contador denormalizado available_units del Hub.
const DEV_LIST_COLS = `
  d.id::text                        AS id,
  d.slug::text                      AS slug,
  COALESCE(d.publication_title, d.name)::text AS name,
  d.developer_name::text            AS "developerName",
  d.development_type::text          AS "developmentType",
  d.stage::text                     AS stage,
  d.city::text                      AS city,
  d.state::text                     AS state,
  d.zone::text                      AS zone,
  d.price_min_mxn::float8           AS "priceMinMxn",
  d.price_max_mxn::float8           AS "priceMaxMxn",
  d.currency::text                  AS currency,
  d.total_units::int                AS "totalUnits",
  d.available_units::int            AS "availableUnits",
  d.reserved_units::int             AS "reservedUnits",
  d.sold_units::int                 AS "soldUnits",
  d.discounted_units_count::int     AS "discountedUnitsCount",
  d.images[1]::text                 AS "coverImage",
  d.estimated_delivery::text        AS "estimatedDelivery",
  d.delivery_text::text             AS "deliveryText",
  d.construction_progress::int      AS "constructionProgress",
  (SELECT count(*) FROM real_estate_hub.v_units u
    WHERE u.development_id = d.id AND ${PUBLIC_GATE})::int AS "publishedUnits"
`;

export async function listPublishedDevelopments(
  filters: DevelopmentCatalogFilters = {}
): Promise<CatalogResult<PublishedDevelopment[]>> {
  const limit = Math.min(filters.limit ?? 200, 500);
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedDevelopment[]>(
      `SELECT ${DEV_LIST_COLS}
         FROM real_estate_hub.v_developments d
        WHERE ${PUBLIC_GATE}
          AND ($1::text IS NULL OR COALESCE(d.publication_title, d.name) ILIKE '%' || $1 || '%'
               OR d.developer_name ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR d.city ILIKE $2)
          AND ($3::text IS NULL OR d.zone ILIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR d.stage = $4)
          AND ($5::float8 IS NULL OR d.price_max_mxn >= $5)
          AND ($6::float8 IS NULL OR d.price_min_mxn <= $6)
          AND ($7::bool IS NOT TRUE OR COALESCE(d.available_units, 0) > 0)
        ORDER BY COALESCE(d.publication_title, d.name) ASC
        LIMIT ${limit}`,
      filters.search ?? null,
      filters.city ?? null,
      filters.zone ?? null,
      filters.stage ?? null,
      filters.priceMin ?? null,
      filters.priceMax ?? null,
      filters.onlyWithAvailable ?? null
    );
    return { data: rows, error: null };
  } catch (err) {
    return fail("listPublishedDevelopments", err, []);
  }
}

export async function getPublishedDevelopment(
  id: string
): Promise<CatalogResult<PublishedDevelopmentDetail | null>> {
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedDevelopmentDetail[]>(
      `SELECT ${DEV_LIST_COLS},
              COALESCE(d.images, '{}')::text[]          AS images,
              COALESCE(d.amenities, '{}')::text[]       AS amenities,
              COALESCE(d.property_types, '{}')::text[]  AS "propertyTypes",
              d.description_es::text                    AS "descriptionEs",
              d.description_short_es::text              AS "descriptionShortEs",
              d.roi_projected::float8                   AS "roiProjected",
              d.roi_rental_monthly::float8              AS "roiRentalMonthly",
              d.roi_appreciation::float8                AS "roiAppreciation",
              d.financing_down_payment::float8          AS "financingDownPayment",
              d.financing_months::int                   AS "financingMonths",
              d.financing_interest::float8              AS "financingInterest",
              d.address::text                           AS address,
              d.neighborhood::text                      AS neighborhood,
              d.municipality::text                      AS municipality,
              d.lat::float8                             AS lat,
              d.lng::float8                             AS lng,
              d.maps_url::text                          AS "mapsUrl",
              d.beach_distance::text                    AS "beachDistance",
              d.brochure_url::text                      AS "brochureUrl",
              d.virtual_tour_url::text                  AS "virtualTourUrl",
              d.masterplan::text                        AS masterplan,
              d.video_url::text                         AS "videoUrl",
              d.commission_rate::float8                 AS "commissionRate",
              d.crm_relationship::text                  AS "crmRelationship",
              d.contact_name::text                      AS "contactName",
              d.contact_phone::text                     AS "contactPhone"
         FROM real_estate_hub.v_developments d
        WHERE ${PUBLIC_GATE}
          AND (d.id::text = $1 OR d.slug = $1)
        LIMIT 1`,
      id
    );
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return fail("getPublishedDevelopment", err, null);
  }
}

const UNIT_COLS = `
  u.id::text                   AS id,
  u.slug::text                 AS slug,
  u.title::text                AS title,
  u.unit_number::text          AS "unitNumber",
  u.unit_type::text            AS "unitType",
  u.typology::text             AS typology,
  u.status::text               AS status,
  u.is_presale                 AS "isPresale",
  u.bedrooms::int              AS bedrooms,
  u.bathrooms::int             AS bathrooms,
  u.half_baths::int            AS "halfBaths",
  u.area_m2::float8            AS "areaM2",
  u.built_area_m2::float8      AS "builtAreaM2",
  u.price_mxn::float8          AS "priceMxn",
  u.price_usd::float8          AS "priceUsd",
  u.currency::text             AS currency,
  u.discount_price_mxn::float8 AS "discountPriceMxn",
  u.discount_pct::float8       AS "discountPct",
  u.is_discount_active         AS "isDiscountActive",
  COALESCE(u.cover_image, u.images[1])::text AS "coverImage",
  u.development_id::text       AS "developmentId",
  u.development_name::text     AS "developmentName",
  u.development_slug::text     AS "developmentSlug",
  u.city::text                 AS city,
  u.zone::text                 AS zone,
  u.fin_directo                AS "finDirecto",
  u.fin_hipotecario            AS "finHipotecario",
  u.fin_enganche_pct::float8   AS "finEnganchePct",
  u.fin_meses_opciones::int[]  AS "finMesesOpciones",
  u.fin_tasa::float8           AS "finTasa",
  u.fin_esquemas_pago          AS "finEsquemasPago",
  u.fin_preventa               AS "finPreventa"
`;

export async function listPublishedUnits(
  filters: UnitCatalogFilters = {}
): Promise<CatalogResult<PublishedUnit[]>> {
  const limit = Math.min(filters.limit ?? 200, 500);
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedUnit[]>(
      `SELECT ${UNIT_COLS}
         FROM real_estate_hub.v_units u
        WHERE ${PUBLIC_GATE}
          AND ($1::text IS NULL OR u.development_id::text = $1)
          AND ($2::text IS NULL OR u.title ILIKE '%' || $2 || '%' OR u.unit_number ILIKE '%' || $2 || '%')
          AND ($3::int IS NULL OR u.bedrooms >= $3)
          AND ($4::float8 IS NULL OR u.price_mxn >= $4)
          AND ($5::float8 IS NULL OR u.price_mxn <= $5)
          AND ($6::text IS NULL OR u.zone ILIKE '%' || $6 || '%')
        ORDER BY u.unit_number ASC NULLS LAST
        LIMIT ${limit}`,
      filters.developmentId ?? null,
      filters.search ?? null,
      filters.bedrooms ?? null,
      filters.priceMin ?? null,
      filters.priceMax ?? null,
      filters.zone ?? null
    );
    return { data: rows, error: null };
  } catch (err) {
    return fail("listPublishedUnits", err, []);
  }
}

export async function getPublishedUnit(id: string): Promise<CatalogResult<PublishedUnit | null>> {
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedUnit[]>(
      `SELECT ${UNIT_COLS}
         FROM real_estate_hub.v_units u
        WHERE ${PUBLIC_GATE}
          AND (u.id::text = $1 OR u.slug = $1)
        LIMIT 1`,
      id
    );
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return fail("getPublishedUnit", err, null);
  }
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/hub/catalog.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 6: Probar el guard por mutación**

El test del gate solo sirve si se pone rojo cuando el gate desaparece. Verifícalo:

En `catalog.ts`, cambia temporalmente en `listPublishedDevelopments` la línea
`WHERE ${PUBLIC_GATE}` por `WHERE 1=1`.

Run: `npx vitest run src/lib/hub/catalog.test.ts`
Expected: FAIL en "listPublishedDevelopments filtra por el gate".

**Revierte la mutación** y vuelve a correr: PASS.

- [ ] **Step 7: Verificar contra la BD real**

Corre este SQL en Supabase (`oaijxdpevakashxshhvm`) y anota los números:

```sql
SELECT
  (SELECT count(*) FROM real_estate_hub.v_developments WHERE approved_at IS NOT NULL AND deleted_at IS NULL) AS devs,
  (SELECT count(*) FROM real_estate_hub.v_units        WHERE approved_at IS NOT NULL AND deleted_at IS NULL) AS units;
```

Expected al 2026-07-27: `devs = 21`, `units = 56`. Si difiere, el catálogo cambió — usa los
números nuevos como referencia en la Task 7.

- [ ] **Step 8: Commit**

```bash
git add src/lib/hub/catalog-types.ts src/lib/hub/catalog.ts src/lib/hub/catalog.test.ts
git commit -m "feat(hub): capa de catálogo publicado con gate único del sitio"
```

---

## Task 2: Búsqueda de catálogo para el agente IA

**Files:**
- Modify: `src/lib/hub/catalog.ts` (agregar `searchCatalog`)
- Modify: `src/lib/hub/catalog-types.ts` (agregar `CatalogSearchFilters`)
- Test: `src/lib/hub/catalog.test.ts` (agregar bloque)

- [ ] **Step 1: Escribir el test que falla**

Agrega al final de `src/lib/hub/catalog.test.ts`:

```ts
describe("searchCatalog (agente IA)", () => {
  it("aplica el gate y devuelve unidades con su desarrollo", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "u1", developmentName: "Nativa", priceMxn: 4_000_000, bedrooms: 2 },
    ]);
    const res = await searchCatalog({ budgetMax: 5_000_000, bedrooms: 2 });
    expect(lastSql()).toContain(PUBLIC_GATE);
    expect(res.error).toBeNull();
    expect(res.data[0].developmentName).toBe("Nativa");
  });

  it("topa el límite a 25 aunque pidan más", async () => {
    await searchCatalog({ limit: 500 });
    expect(lastSql()).toContain("LIMIT 25");
  });

  it("ante fallo devuelve error, no lista vacía silenciosa", async () => {
    queryRaw.mockRejectedValueOnce(new Error("timeout"));
    const res = await searchCatalog({});
    expect(res.data).toEqual([]);
    expect(res.error).toBeTruthy();
  });
});
```

Y añade `searchCatalog` al import del inicio del archivo:

```ts
import {
  PUBLIC_GATE,
  listPublishedDevelopments,
  getPublishedDevelopment,
  listPublishedUnits,
  getPublishedUnit,
  searchCatalog,
} from "./catalog";
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/hub/catalog.test.ts`
Expected: FAIL — `searchCatalog is not a function` / error de import.

- [ ] **Step 3: Agregar el tipo de filtros**

En `src/lib/hub/catalog-types.ts`, al final:

```ts
export interface CatalogSearchFilters {
  budgetMin?: number | null;
  budgetMax?: number | null;
  zone?: string | null;
  city?: string | null;
  bedrooms?: number | null;
  limit?: number;
}
```

- [ ] **Step 4: Implementar `searchCatalog`**

En `src/lib/hub/catalog.ts`, agrega el import del tipo nuevo y la función al final:

```ts
/**
 * Búsqueda para el agente IA: unidades publicadas que encajan con el perfil,
 * con el contexto de su desarrollo y sus esquemas de pago.
 * Límite duro de 25 — es contexto de prompt, no un listado.
 */
export async function searchCatalog(
  filters: CatalogSearchFilters
): Promise<CatalogResult<PublishedUnit[]>> {
  const limit = Math.min(filters.limit ?? 5, 25);
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedUnit[]>(
      `SELECT ${UNIT_COLS}
         FROM real_estate_hub.v_units u
        WHERE ${PUBLIC_GATE}
          AND ($1::float8 IS NULL OR u.price_mxn >= $1)
          AND ($2::float8 IS NULL OR u.price_mxn <= $2)
          AND ($3::text IS NULL OR u.zone ILIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR u.city ILIKE $4)
          AND ($5::int IS NULL OR u.bedrooms >= $5)
        ORDER BY u.price_mxn ASC NULLS LAST
        LIMIT ${limit}`,
      filters.budgetMin ?? null,
      filters.budgetMax ?? null,
      filters.zone ?? null,
      filters.city ?? null,
      filters.bedrooms ?? null
    );
    return { data: rows, error: null };
  } catch (err) {
    return fail("searchCatalog", err, []);
  }
}
```

Actualiza el import de tipos en la cabecera para incluir `CatalogSearchFilters`.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/hub/catalog.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hub/catalog.ts src/lib/hub/catalog-types.ts src/lib/hub/catalog.test.ts
git commit -m "feat(hub): searchCatalog para el agente IA con esquemas de pago"
```

---

## Task 3: `hub/client.ts` delega — sin cambiar firmas

**Files:**
- Modify: `src/lib/hub/client.ts:23-140` (solo la mitad de lectura)
- Test: `src/lib/hub/client.test.ts` (crear)

Los 6 call sites de `client.ts` (`api/deals/route.ts`, `api/deals/[id]/route.ts`,
`api/hub/developments/route.ts`, `api/hub/units/route.ts`, `server/quotes.ts`,
`server/shortlists.ts`) **no se tocan**: las firmas se conservan.

- [ ] **Step 1: Escribir el test de no-divergencia**

Crea `src/lib/hub/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRaw = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({
  default: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a) },
}));

import { PUBLIC_GATE } from "./catalog";
import { listHubDevelopments, getHubDevelopment, listHubUnits, getHubUnit } from "./client";

function lastSql(): string {
  return String(queryRaw.mock.calls[queryRaw.mock.calls.length - 1][0]);
}

beforeEach(() => {
  queryRaw.mockClear();
  queryRaw.mockResolvedValue([]);
});

describe("client.ts usa el mismo gate que el sitio", () => {
  it("listHubDevelopments ya no filtra por pipeline_status", async () => {
    await listHubDevelopments();
    expect(lastSql()).toContain(PUBLIC_GATE);
    expect(lastSql()).not.toContain("pipeline_status");
  });

  it("listHubUnits usa el gate público", async () => {
    await listHubUnits({});
    expect(lastSql()).toContain(PUBLIC_GATE);
  });
});

describe("firmas legadas intactas", () => {
  it("listHubDevelopments devuelve un array, no un CatalogResult", async () => {
    const res = await listHubDevelopments();
    expect(Array.isArray(res)).toBe(true);
  });

  it("ante fallo devuelve [] para no romper a los callers", async () => {
    queryRaw.mockRejectedValueOnce(new Error("db caída"));
    const res = await listHubDevelopments();
    expect(res).toEqual([]);
  });

  it("getHubDevelopment devuelve null cuando no hay fila", async () => {
    expect(await getHubDevelopment("x")).toBeNull();
  });

  it("getHubUnit mapea al shape legado HubUnit", async () => {
    queryRaw.mockResolvedValueOnce([
      { id: "u1", developmentId: "d1", unitNumber: "101", title: "PH", unitType: "Depa",
        typology: "2R", bedrooms: 2, bathrooms: 2, builtAreaM2: 90, areaM2: 100,
        priceMxn: 4_000_000, priceUsd: null, currency: "MXN", status: "disponible" },
    ]);
    const u = await getHubUnit("u1");
    expect(u).toMatchObject({
      id: "u1", developmentId: "d1", numero: "101", recamaras: 2,
      m2Construccion: 90, precioMxn: 4_000_000, moneda: "MXN",
    });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/hub/client.test.ts`
Expected: FAIL — el SQL contiene `pipeline_status`.

- [ ] **Step 3: Reemplazar la mitad de lectura de `client.ts`**

En `src/lib/hub/client.ts`, sustituye TODO el bloque entre el comentario
`// ───────────────────────── Lectura (SQL directo) ─────────────────────────`
y el comentario `// ───────────────────── Mutación de inventario (REST al Hub) ─────────────────────`
por:

```ts
// ───────────────────────── Lectura (delega en catalog.ts) ─────────────────────────
// El gate público vive en catalog.ts. Aquí solo se adapta al shape legado HubDevelopment /
// HubUnit y se conserva la firma (array / T|null) para no tocar a los 6 callers actuales.

function toHubDevelopment(d: PublishedDevelopment): HubDevelopment {
  return {
    id: d.id,
    nombre: d.name,
    zona: d.zone,
    plaza: d.city,
    status: d.stage,
    precioMin: d.priceMinMxn,
    precioMax: d.priceMaxMxn,
    moneda: d.currency ?? "MXN",
  };
}

function toHubUnit(u: PublishedUnit): HubUnit {
  return {
    id: u.id,
    developmentId: u.developmentId,
    numero: u.unitNumber,
    titulo: u.title,
    tipo: u.unitType,
    tipologia: u.typology,
    recamaras: u.bedrooms,
    banos: u.bathrooms,
    m2Construccion: u.builtAreaM2,
    m2Total: u.areaM2,
    precioMxn: u.priceMxn,
    precioUsd: u.priceUsd,
    moneda: u.currency ?? "MXN",
    status: u.status,
  };
}

export async function listHubDevelopments(
  filters: HubDevelopmentFilters = {}
): Promise<HubDevelopment[]> {
  const { data } = await listPublishedDevelopments({
    search: filters.search ?? null,
    zone: filters.zone ?? null,
    priceMin: filters.budgetMin ?? null,
    priceMax: filters.budgetMax ?? null,
    limit: filters.limit ?? 100,
  });
  return data.map(toHubDevelopment);
}

export async function getHubDevelopment(id: string): Promise<HubDevelopment | null> {
  const { data } = await getPublishedDevelopment(id);
  return data ? toHubDevelopment(data) : null;
}

export async function listHubUnits(filters: HubUnitFilters = {}): Promise<HubUnit[]> {
  const { data } = await listPublishedUnits({
    developmentId: filters.developmentId ?? null,
    search: filters.search ?? null,
    limit: filters.limit ?? 200,
  });
  const units = data.map(toHubUnit);
  // onlyAvailable se resuelve en JS: v_units ya trae solo publicadas y `status` es texto libre.
  return filters.onlyAvailable
    ? units.filter((u) => (u.status ?? "").toLowerCase() === "disponible")
    : units;
}

export async function getHubUnit(id: string): Promise<HubUnit | null> {
  const { data } = await getPublishedUnit(id);
  return data ? toHubUnit(data) : null;
}
```

Actualiza los imports de la cabecera del archivo:

```ts
import {
  listPublishedDevelopments,
  getPublishedDevelopment,
  listPublishedUnits,
  getPublishedUnit,
} from "./catalog";
import type { PublishedDevelopment, PublishedUnit } from "./catalog-types";
import type {
  HubDevelopment,
  HubUnit,
  HubHoldResult,
  HubUnitFilters,
  HubDevelopmentFilters,
} from "./types";
```

**Elimina** el `import prisma from "@/lib/db";` si ya no se usa en el archivo (la mitad de
mutación usa `fetch`, no Prisma). Verifica con `grep -n "prisma" src/lib/hub/client.ts`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/hub/client.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Verificar que los callers siguen compilando**

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hub/client.ts src/lib/hub/client.test.ts
git commit -m "fix(hub): client.ts usa el gate del sitio (16→21 devs) delegando en catalog.ts"
```

---

## Task 4: Catálogo del agente IA enriquecido + `{ data, error }`

**Files:**
- Modify: `src/lib/bot/hub-catalog.ts` (reescritura completa)
- Modify: `src/lib/bot/bot-respond.ts:8` y su uso de `findMatchingDevelopments`
- Modify: `src/lib/bot/ai-actions.ts:8` y su uso
- Modify: `src/lib/bot/claude.ts:5` (`catalogBrief`)
- Modify: `src/lib/agents/tools.ts:111`
- Modify: `src/app/api/records/search/route.ts:6`
- Modify: mocks en `src/lib/bot/ai-actions.test.ts:46`, `bot-respond.agents.test.ts:54`, `bot-respond.channel.test.ts:59`
- Test: `src/lib/bot/hub-catalog.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crea `src/lib/bot/hub-catalog.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const searchCatalog = vi.fn();
vi.mock("@/lib/hub/catalog", () => ({ searchCatalog: (...a: unknown[]) => searchCatalog(...a) }));

import { findMatchingDevelopments, catalogBrief } from "./hub-catalog";

beforeEach(() => searchCatalog.mockReset());

describe("findMatchingDevelopments", () => {
  it("agrupa unidades por desarrollo y conserva el rango de precio", async () => {
    searchCatalog.mockResolvedValue({
      data: [
        { developmentId: "d1", developmentName: "Nativa", zone: "Tulum", city: "Tulum",
          priceMxn: 3_000_000, bedrooms: 1, finEnganchePct: 20, finMesesOpciones: [12, 24] },
        { developmentId: "d1", developmentName: "Nativa", zone: "Tulum", city: "Tulum",
          priceMxn: 5_000_000, bedrooms: 2, finEnganchePct: 20, finMesesOpciones: [12, 24] },
        { developmentId: "d2", developmentName: "Turena", zone: "Mérida", city: "Mérida",
          priceMxn: 2_000_000, bedrooms: 2, finEnganchePct: null, finMesesOpciones: null },
      ],
      error: null,
    });
    const res = await findMatchingDevelopments({ budgetMax: 6_000_000 });
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2);
    const nativa = res.data.find((d) => d.id === "d1")!;
    expect(nativa.precio_min).toBe(3_000_000);
    expect(nativa.precio_max).toBe(5_000_000);
    expect(nativa.unidades_publicadas).toBe(2);
    expect(nativa.enganche_pct).toBe(20);
  });

  it("propaga el error en vez de fingir catálogo vacío", async () => {
    searchCatalog.mockResolvedValue({ data: [], error: "No se pudo consultar el catálogo del Hub" });
    const res = await findMatchingDevelopments({});
    expect(res.data).toEqual([]);
    expect(res.error).toBeTruthy();
  });
});

describe("catalogBrief", () => {
  it("incluye enganche y plazos cuando existen", () => {
    const brief = catalogBrief([
      { id: "d1", nombre: "Nativa", zona: "Tulum", ciudad: "Tulum", precio_min: 3_000_000,
        precio_max: 5_000_000, moneda: "MXN", unidades_publicadas: 2, recamaras_min: 1,
        recamaras_max: 2, enganche_pct: 20, meses_opciones: [12, 24] },
    ]);
    expect(brief).toContain("Nativa");
    expect(brief).toContain("Tulum");
    expect(brief).toContain("20%");
    expect(brief).toContain("12");
  });

  it("devuelve cadena vacía sin desarrollos", () => {
    expect(catalogBrief([])).toBe("");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/bot/hub-catalog.test.ts`
Expected: FAIL — `res.error` es undefined (hoy devuelve array pelón).

- [ ] **Step 3: Reescribir `hub-catalog.ts`**

Reemplaza el contenido completo de `src/lib/bot/hub-catalog.ts` por:

```ts
// HubCatalog del agente — proyección read-only del catálogo PUBLICADO en propyte.com.
// Delega en src/lib/hub/catalog.ts: el gate público vive allí, escrito una sola vez.
//
// Devuelve { data, error } a propósito: el bot NO debe decir "no tengo inventario"
// cuando en realidad la consulta falló.
import { searchCatalog } from "@/lib/hub/catalog";
import type { CatalogResult } from "@/lib/hub/catalog-types";

export interface HubDevelopmentSummary {
  id: string;
  nombre: string;
  zona: string | null;
  ciudad: string | null;
  precio_min: number | null;
  precio_max: number | null;
  moneda: string | null;
  unidades_publicadas: number;
  recamaras_min: number | null;
  recamaras_max: number | null;
  enganche_pct: number | null;
  meses_opciones: number[] | null;
}

function minOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.min(...nums) : null;
}

function maxOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

/** Desarrollos publicados que encajan con el perfil, agregados desde sus unidades. */
export async function findMatchingDevelopments(opts: {
  budgetMin?: number | null;
  budgetMax?: number | null;
  zone?: string | null;
  city?: string | null;
  bedrooms?: number | null;
  limit?: number;
}): Promise<CatalogResult<HubDevelopmentSummary[]>> {
  const maxDevs = Math.min(opts.limit ?? 3, 10);
  // Se piden más unidades que desarrollos porque varias unidades caen en el mismo dev.
  const { data: units, error } = await searchCatalog({
    budgetMin: opts.budgetMin ?? null,
    budgetMax: opts.budgetMax ?? null,
    zone: opts.zone ?? null,
    city: opts.city ?? null,
    bedrooms: opts.bedrooms ?? null,
    limit: 25,
  });
  if (error) return { data: [], error };

  const byDev = new Map<string, typeof units>();
  for (const u of units) {
    if (!u.developmentId) continue;
    const bucket = byDev.get(u.developmentId);
    if (bucket) bucket.push(u);
    else byDev.set(u.developmentId, [u]);
  }

  const summaries: HubDevelopmentSummary[] = [...byDev.entries()].map(([id, us]) => ({
    id,
    nombre: us[0].developmentName ?? "Sin nombre",
    zona: us[0].zone,
    ciudad: us[0].city,
    precio_min: minOf(us.map((u) => u.priceMxn)),
    precio_max: maxOf(us.map((u) => u.priceMxn)),
    moneda: us[0].currency ?? "MXN",
    unidades_publicadas: us.length,
    recamaras_min: minOf(us.map((u) => u.bedrooms)),
    recamaras_max: maxOf(us.map((u) => u.bedrooms)),
    enganche_pct: us.find((u) => u.finEnganchePct != null)?.finEnganchePct ?? null,
    meses_opciones: us.find((u) => u.finMesesOpciones?.length)?.finMesesOpciones ?? null,
  }));

  summaries.sort((a, b) => (a.precio_min ?? Infinity) - (b.precio_min ?? Infinity));
  return { data: summaries.slice(0, maxDevs), error: null };
}

export function catalogBrief(devs: HubDevelopmentSummary[]): string {
  if (devs.length === 0) return "";
  const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
  const lines = devs.map((d) => {
    const partes: string[] = [`• ${d.nombre}`];
    const ubic = [d.zona, d.ciudad].filter(Boolean).join(", ");
    if (ubic) partes.push(`(${ubic})`);
    if (d.precio_min != null) {
      partes.push(
        d.precio_max != null && d.precio_max !== d.precio_min
          ? `— ${money(d.precio_min)} a ${money(d.precio_max)} ${d.moneda ?? "MXN"}`
          : `— desde ${money(d.precio_min)} ${d.moneda ?? "MXN"}`
      );
    }
    if (d.recamaras_min != null) {
      partes.push(
        d.recamaras_max != null && d.recamaras_max !== d.recamaras_min
          ? `· ${d.recamaras_min}-${d.recamaras_max} rec`
          : `· ${d.recamaras_min} rec`
      );
    }
    if (d.enganche_pct != null) partes.push(`· enganche ${d.enganche_pct}%`);
    if (d.meses_opciones?.length) partes.push(`· financiamiento ${d.meses_opciones.join("/")} meses`);
    partes.push(`· ${d.unidades_publicadas} unid. publicadas`);
    return partes.join(" ");
  });
  return `Catálogo publicado en propyte.com (fuente oficial, puedes citar estos datos):\n${lines.join("\n")}`;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/bot/hub-catalog.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Actualizar los 5 call sites**

**Lee cada archivo antes de editarlo** — abajo va el patrón, no el diff literal.
`npx tsc --noEmit` te lista exactamente las líneas. Dos cambios de forma:

1. Antes recibían un array, ahora reciben `{ data, error }`.
2. `HubDevelopmentSummary` **pierde el campo `status`** (era `pipeline_status`, que ya no
   existe en este flujo) y **gana** `ciudad`, `unidades_publicadas`, `recamaras_min/max`,
   `enganche_pct`, `meses_opciones`. Verificado: ningún caller actual lee `.status` del
   summary, así que no debería haber roturas por ahí — si tsc dice lo contrario, mapea el
   campo al dato equivalente del nuevo shape en vez de reintroducir `pipeline_status`.

En `src/lib/bot/bot-respond.ts` y `src/lib/bot/ai-actions.ts`, donde hoy hay algo como
`const devs = await findMatchingDevelopments({...})`, cámbialo a:

```ts
const { data: devs, error: catalogError } = await findMatchingDevelopments({ /* mismos args */ });
```

y usa `devs` igual que antes. Cuando `catalogError` sea truthy, el bot **no debe afirmar que
no hay inventario**: omite el brief del prompt y deja que responda sin catálogo.

En `src/lib/bot/claude.ts:5`, `catalogBrief` no cambia de firma — solo asegúrate de que
recibe `devs` (el `.data`) y no el objeto completo.

En `src/lib/agents/tools.ts:111`:

```ts
const { findMatchingDevelopments } = await import("@/lib/bot/hub-catalog");
const { data, error } = await findMatchingDevelopments({ /* mismos args */ });
if (error) return { ok: false, error: "El catálogo no está disponible ahora mismo" };
// usar `data` donde antes iba el array
```

En `src/app/api/records/search/route.ts:6`, ante error devuelve **503**, no una lista vacía:

```ts
const { data, error } = await findMatchingDevelopments({ /* mismos args */ });
if (error) return NextResponse.json({ error }, { status: 503 });
// responder con `data`
```

Ajusta la forma exacta de cada respuesta al estilo que ya tenga cada archivo.

- [ ] **Step 6: Actualizar los 3 mocks de tests existentes**

`src/lib/bot/ai-actions.test.ts:46`, `bot-respond.agents.test.ts:54` y
`bot-respond.channel.test.ts:59` mockean `findMatchingDevelopments` devolviendo un array.
Cámbialos para que devuelvan el nuevo shape. Ejemplo del más simple
(`bot-respond.agents.test.ts:54`):

```ts
vi.mock("./hub-catalog", () => ({
  findMatchingDevelopments: async () => ({ data: [], error: null }),
  catalogBrief: () => "",
}));
```

Aplica el mismo cambio en los otros dos, conservando los datos que cada uno ya devolvía
(envueltos ahora en `{ data: <lo de antes>, error: null }`).

- [ ] **Step 7: Correr toda la suite**

Run: `npm test`
Expected: PASS, sin regresiones.

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 8: Commit**

```bash
git add src/lib/bot/hub-catalog.ts src/lib/bot/hub-catalog.test.ts src/lib/bot/bot-respond.ts \
        src/lib/bot/ai-actions.ts src/lib/bot/claude.ts src/lib/agents/tools.ts \
        src/app/api/records/search/route.ts src/lib/bot/ai-actions.test.ts \
        src/lib/bot/bot-respond.agents.test.ts src/lib/bot/bot-respond.channel.test.ts
git commit -m "feat(bot): catálogo del agente con gate del sitio, esquemas de pago y error explícito"
```

---

## Task 5: Lista `/developments` como espejo

**Files:**
- Modify: `src/app/(dashboard)/developments/page.tsx` (33 líneas → reescritura)
- Rewrite: `src/app/(dashboard)/developments/developments-client.tsx`

- [ ] **Step 1: Reescribir el server component**

Reemplaza el contenido de `src/app/(dashboard)/developments/page.tsx` por:

```tsx
// Espejo del catálogo publicado en propyte.com — server component.
// El CRM no posee inventario: esta pantalla solo refleja real_estate_hub.v_developments
// con el gate público. La edición vive en el Hub.
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { listPublishedDevelopments } from "@/lib/hub/catalog";
import { DevelopmentsClient } from "./developments-client";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"];

export default async function DevelopmentsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const { data: developments, error } = await listPublishedDevelopments();

  return (
    <DevelopmentsClient
      developments={developments}
      loadError={error}
      isAdmin={ADMIN_ROLES.includes(session.user.role)}
    />
  );
}
```

- [ ] **Step 2: Reescribir el cliente de la lista**

Reemplaza el contenido de `src/app/(dashboard)/developments/developments-client.tsx` por:

```tsx
// Lista del catálogo publicado — espejo de propyte.com. Solo lectura.
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, DollarSign, Filter, Building2, Tag, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/constants";
import type { PublishedDevelopment } from "@/lib/hub/catalog-types";

interface Props {
  developments: PublishedDevelopment[];
  loadError: string | null;
  isAdmin: boolean;
}

const SITE_BASE = "https://propyte.com/es/desarrollos";

export function DevelopmentsClient({ developments, loadError, isAdmin }: Props) {
  const router = useRouter();
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCity, setFilterCity] = useState("all");
  const [filterStage, setFilterStage] = useState("all");

  const cities = useMemo(
    () => [...new Set(developments.map((d) => d.city).filter((c): c is string => !!c))].sort(),
    [developments]
  );
  const stages = useMemo(
    () => [...new Set(developments.map((d) => d.stage).filter((s): s is string => !!s))].sort(),
    [developments]
  );

  const filtered = developments.filter((d) => {
    if (filterCity !== "all" && d.city !== filterCity) return false;
    if (filterStage !== "all" && d.stage !== filterStage) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${d.name} ${d.developerName ?? ""} ${d.zone ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Fallo de consulta ≠ catálogo vacío. Nunca los muestres igual.
  if (loadError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Desarrollos</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">No se pudo cargar el catálogo del Hub</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Esto no significa que no haya desarrollos publicados: la consulta falló.
            </p>
            <Button variant="outline" size="sm" onClick={() => router.refresh()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Desarrollos</h1>
          <p className="text-muted-foreground">
            Espejo de lo publicado en propyte.com ({filtered.length})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="mr-1 h-4 w-4" />
            Filtros
          </Button>
          <span
            className="inline-flex items-center rounded-full border px-3 py-1 text-xs text-muted-foreground"
            title="El catálogo es propiedad del Hub (Propyte Hub). El CRM solo lo consulta."
          >
            Catálogo del Hub · solo lectura
          </span>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 p-4">
            <div className="w-64">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Buscar</label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, desarrollador o zona"
              />
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Ciudad</label>
              <Select value={filterCity} onValueChange={setFilterCity}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las ciudades</SelectItem>
                  {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Etapa</label>
              <Select value={filterStage} onValueChange={setFilterStage}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las etapas</SelectItem>
                  {stages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(""); setFilterCity("all"); setFilterStage("all"); }}
            >
              Limpiar
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((dev) => (
          <Card
            key={dev.id}
            className="cursor-pointer overflow-hidden transition-shadow hover:shadow-lg"
            onClick={() => router.push(`/developments/${dev.id}`)}
          >
            {dev.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dev.coverImage} alt={dev.name} className="h-36 w-full object-cover" />
            ) : (
              <div className="flex h-36 items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                <Building2 className="h-12 w-12 text-primary/30" />
              </div>
            )}

            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="truncate text-lg">{dev.name}</CardTitle>
                {dev.stage && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                    {dev.stage}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {dev.developerName ?? "Sin desarrollador"}
              </p>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="truncate">{[dev.zone, dev.city].filter(Boolean).join(", ") || "—"}</span>
              </div>

              <div className="flex items-center gap-1 text-sm">
                <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">
                  {dev.priceMinMxn != null
                    ? `${formatCurrency(dev.priceMinMxn, "MXN")}${
                        dev.priceMaxMxn != null && dev.priceMaxMxn !== dev.priceMinMxn
                          ? ` – ${formatCurrency(dev.priceMaxMxn, "MXN")}`
                          : ""
                      }`
                    : "Precio no publicado"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{dev.publishedUnits} unid. publicadas</span>
                {dev.availableUnits != null && <span>· {dev.availableUnits} disponibles</span>}
                {(dev.discountedUnitsCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                    <Tag className="h-3 w-3" />
                    {dev.discountedUnitsCount} con descuento
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            {developments.length === 0
              ? "No hay desarrollos publicados en propyte.com"
              : "Ningún desarrollo coincide con los filtros"}
          </div>
        )}
      </div>

      {isAdmin && (
        <p className="text-xs text-muted-foreground">
          ¿Falta un desarrollo? Se publica desde el Hub —{" "}
          <a href={SITE_BASE} target="_blank" rel="noreferrer" className="underline">
            ver catálogo en propyte.com
          </a>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: 0 errores. (`src/components/ui/input.tsx` existe — verificado.)

Run: `npm run build`
Expected: build verde.

- [ ] **Step 4: Verificar en el navegador**

Levanta `npm run dev`, entra a `/developments` autenticado.
Expected: grid con los desarrollos publicados (21 al 2026-07-27), badge "Catálogo del Hub ·
solo lectura", filtros de ciudad y etapa poblados con valores reales.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/developments/page.tsx" "src/app/(dashboard)/developments/developments-client.tsx"
git commit -m "feat(developments): lista como espejo del catálogo publicado en propyte.com"
```

---

## Task 6: Ficha del desarrollo con sus unidades publicadas

**Files:**
- Modify: `src/app/(dashboard)/developments/[id]/page.tsx`
- Rewrite: `src/app/(dashboard)/developments/[id]/development-detail-client.tsx`

- [ ] **Step 1: Reescribir el server component de la ficha**

Reemplaza el contenido de `src/app/(dashboard)/developments/[id]/page.tsx` por:

```tsx
// Ficha del desarrollo — espejo de la página pública. Solo lectura.
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getPublishedDevelopment, listPublishedUnits } from "@/lib/hub/catalog";
import { DevelopmentDetailClient } from "./development-detail-client";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"];

export default async function DevelopmentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const { data: development, error: devError } = await getPublishedDevelopment(params.id);
  if (!devError && !development) notFound();

  const { data: units, error: unitsError } = development
    ? await listPublishedUnits({ developmentId: development.id })
    : { data: [], error: null };

  return (
    <DevelopmentDetailClient
      development={development}
      units={units}
      loadError={devError ?? unitsError}
      isAdmin={ADMIN_ROLES.includes(session.user.role)}
    />
  );
}
```

- [ ] **Step 2: Reescribir el cliente de la ficha**

Reemplaza el contenido de
`src/app/(dashboard)/developments/[id]/development-detail-client.tsx` por:

```tsx
// Ficha del desarrollo publicado — espejo de propyte.com. Solo lectura.
"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft, MapPin, ExternalLink, Building2, AlertCircle, Tag, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/constants";
import type { PublishedDevelopmentDetail, PublishedUnit } from "@/lib/hub/catalog-types";

interface Props {
  development: PublishedDevelopmentDetail | null;
  units: PublishedUnit[];
  loadError: string | null;
  isAdmin: boolean;
}

const SITE = "https://propyte.com/es";

export function DevelopmentDetailClient({ development, units, loadError, isAdmin }: Props) {
  const router = useRouter();

  if (loadError || !development) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/developments")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Desarrollos
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">No se pudo cargar el desarrollo</p>
            <Button variant="outline" size="sm" onClick={() => router.refresh()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const d = development;
  const ubicacion = [d.neighborhood, d.zone, d.city, d.state].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => router.push("/developments")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Desarrollos
          </Button>
          <h1 className="truncate text-2xl font-bold tracking-tight">{d.name}</h1>
          <p className="text-sm text-muted-foreground">
            {d.developerName ?? "Sin desarrollador"}
            {d.stage ? ` · ${d.stage}` : ""}
          </p>
          {ubicacion && (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" /> {ubicacion}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {d.slug && (
            <Button asChild variant="outline" size="sm">
              <a href={`${SITE}/desarrollos/${d.slug}`} target="_blank" rel="noreferrer">
                Ver en propyte.com <ExternalLink className="ml-1 h-4 w-4" />
              </a>
            </Button>
          )}
          {isAdmin && (
            <a
              href="https://hub.propyte.com"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline"
            >
              Editar en el Hub
            </a>
          )}
        </div>
      </div>

      {d.images.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {d.images.slice(0, 8).map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={`${d.name} ${i + 1}`} className="h-40 w-64 shrink-0 rounded-lg object-cover" />
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Rango de precio</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {d.priceMinMxn != null ? formatCurrency(d.priceMinMxn, "MXN") : "—"}
              {d.priceMaxMxn != null && d.priceMaxMxn !== d.priceMinMxn && ` – ${formatCurrency(d.priceMaxMxn, "MXN")}`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Unidades publicadas</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{units.length}</p>
            {d.availableUnits != null && (
              <p className="text-xs text-muted-foreground">{d.availableUnits} disponibles según el Hub</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Entrega</CardTitle></CardHeader>
          <CardContent>
            <p className="flex items-center gap-1 text-lg font-semibold">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {d.deliveryText ?? d.estimatedDelivery ?? "—"}
            </p>
            {d.constructionProgress != null && (
              <p className="text-xs text-muted-foreground">{d.constructionProgress}% de avance</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Financiamiento</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {d.financingDownPayment != null ? `${d.financingDownPayment}% enganche` : "—"}
            </p>
            {d.financingMonths != null && (
              <p className="text-xs text-muted-foreground">
                hasta {d.financingMonths} meses{d.financingInterest != null ? ` · ${d.financingInterest}%` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {d.descriptionEs && (
        <Card>
          <CardHeader><CardTitle className="text-base">Descripción</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-line text-sm text-muted-foreground">{d.descriptionEs}</p></CardContent>
        </Card>
      )}

      {d.amenities.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Amenidades</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {d.amenities.map((a) => (
              <span key={a} className="rounded-full bg-muted px-3 py-1 text-xs">{a}</span>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unidades publicadas ({units.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {units.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              Este desarrollo no tiene unidades publicadas en el sitio
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Unidad</th>
                    <th className="px-4 py-2 font-medium">Tipología</th>
                    <th className="px-4 py-2 font-medium">Rec / Baños</th>
                    <th className="px-4 py-2 font-medium">m²</th>
                    <th className="px-4 py-2 font-medium">Precio</th>
                    <th className="px-4 py-2 font-medium">Estado</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">{u.unitNumber ?? u.title ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{u.typology ?? u.unitType ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {u.bedrooms ?? "—"} / {u.bathrooms ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {u.builtAreaM2 ?? u.areaM2 ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        {u.isDiscountActive && u.discountPriceMxn != null ? (
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{formatCurrency(u.discountPriceMxn, "MXN")}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                              <Tag className="h-3 w-3" />
                              {u.discountPct != null ? `-${u.discountPct}%` : "descuento"}
                            </span>
                          </span>
                        ) : u.priceMxn != null ? (
                          formatCurrency(u.priceMxn, "MXN")
                        ) : u.priceUsd != null ? (
                          formatCurrency(u.priceUsd, "USD")
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{u.status ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        {u.slug && (
                          <a
                            href={`${SITE}/propiedades/${u.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs underline"
                          >
                            Ver <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {units.length === 0 && d.images.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Building2 className="h-4 w-4" /> El contenido de esta ficha se administra en el Hub.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: 0 errores.

Run: `npm run build`
Expected: build verde.

- [ ] **Step 4: Verificar en el navegador**

Con `npm run dev`, entra a `/developments`, abre un desarrollo con unidades.
Expected: header con "Ver en propyte.com", galería, 4 tarjetas de resumen y la tabla de
unidades publicadas. Abre el link del sitio y confirma que es el mismo desarrollo.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/developments/[id]/page.tsx" "src/app/(dashboard)/developments/[id]/development-detail-client.tsx"
git commit -m "feat(developments): ficha espejo con unidades publicadas y link al sitio"
```

---

## Task 7: Deprecar el CRUD local y verificación de paridad

**Files:**
- Modify: `src/server/developments.ts` (solo la cabecera)

- [ ] **Step 1: Confirmar que ya no quedan importadores**

Run: `grep -rn "server/developments" src --include=*.ts --include=*.tsx`
Expected: **cero resultados**. Si aparece alguno, migra ese caller a `@/lib/hub/catalog`
antes de continuar — no borres nada.

- [ ] **Step 2: Marcar el módulo como deprecated**

Inserta al inicio de `src/server/developments.ts`, ANTES de `"use server";`:

```ts
// ============================================================
// @deprecated — el CRM no posee inventario.
//
// Este módulo opera propyte_crm.developments / units, tablas VACÍAS (0 filas) que quedaron
// del diseño anterior. El catálogo real vive en el Hub y se consulta con
// src/lib/hub/catalog.ts, que aplica el mismo gate público que propyte.com.
//
// Se conserva sin borrar (decisión D5 del spec 2026-07-27) por si hace falta revertir.
// NO agregues callers nuevos: usa @/lib/hub/catalog.
// ============================================================
```

- [ ] **Step 3: Verificar paridad contra el sitio**

Corre en Supabase (`oaijxdpevakashxshhvm`):

```sql
SELECT slug, COALESCE(publication_title, name) AS nombre
  FROM real_estate_hub.v_developments
 WHERE approved_at IS NOT NULL AND deleted_at IS NULL
 ORDER BY nombre;
```

Compara el resultado con lo que muestra `/developments` en el CRM.
Expected: **mismo conteo y mismos nombres** (21 al 2026-07-27).

Abre `https://propyte.com/es/desarrollos` y confirma que los slugs coinciden.

- [ ] **Step 4: Verificar que el bot ve lo mismo**

Con `npm run dev`, llama al endpoint del agente:

```bash
curl -s "http://localhost:3000/api/records/search?type=developments&budgetMax=10000000" | head -40
```

Expected: 200 con desarrollos del catálogo publicado. Si tu ruta espera otros parámetros,
ajústalos — lo que se verifica es que responde con desarrollos del gate nuevo y que ante
fallo de BD devolvería 503, no una lista vacía.

- [ ] **Step 5: Gates finales**

Run: `npm test`
Expected: PASS, toda la suite.

Run: `npx tsc --noEmit`
Expected: 0 errores.

Run: `npm run build`
Expected: build verde.

- [ ] **Step 6: Commit**

```bash
git add src/server/developments.ts
git commit -m "chore(developments): deprecar el CRUD local — el catálogo vive en el Hub"
```

---

## Verificación final (checklist del spec)

- [ ] `/developments` muestra los mismos desarrollos que propyte.com (21 al 2026-07-27)
- [ ] La ficha muestra solo unidades publicadas y enlaza a la unidad en el sitio
- [ ] `hub/client.ts` y `bot/hub-catalog.ts` usan el gate del sitio — cero `pipeline_status`
- [ ] El test del gate se pone rojo si el gate desaparece (probado por mutación en Task 1)
- [ ] Ni la UI ni el prompt del agente reciben `meta_*`, `detection_source`, `source_url`
- [ ] Fallo de BD se ve distinto de catálogo vacío, en la pantalla y en el bot
- [ ] `npm test` + `npx tsc --noEmit` + `npm run build` verdes
- [ ] Ningún commit incluye los cambios ajenos de `src/components/config/**`

## Fuera de alcance (no lo hagas en este plan)

- Acciones comerciales en la ficha: vincular a Deal, shortlist, cotizar, hold/release (F2)
- Entidad `Company` — desarrolladoras, master brokers, agencias (F4)
- Originación "quién trae el desarrollo" (F5)
- Mostrar unidades vendidas/apartadas en la ficha (fast-follow)
- Borrar los modelos Prisma `Development` / `Unit` o sus tablas
