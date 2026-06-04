# Formulario externo de captura de desarrollos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link público (sin login) con token para que asesores llenen la ficha completa de un desarrollo; lo enviado cae en una cola de revisión en `/developments › Captura` y, al aprobar, crea/actualiza el catálogo web `real_estate_hub.Propyte_desarrollos` + `Propyte_unidades` en borrador.

**Architecture:** Dos tablas Prisma nuevas en `propyte_crm` (`IntakeLink`, `IntakeSubmission`) guardan links y envíos sin tocar el catálogo. Rutas públicas `/captura/[token]` + `/api/captura/[token]/*` (fuera del `matcher` del middleware). Lógica pura aislada en `src/lib/intake/*` (token, zod schema, mapeo a catálogo) probada con vitest. Al aprobar, un endpoint protegido mapea el payload y escribe en Supabase con `getSupabaseServiceClient().schema("real_estate_hub")`, reutilizando el patrón de `upload-image/route.ts` para mover imágenes de cuarentena a producción.

**Tech Stack:** Next.js 14 (app router), TypeScript, Prisma 6 (multiSchema, `propyte_crm`), Supabase JS (service_role, schema `real_estate_hub`), `sharp` (WebP), `zod`, shadcn/ui, vitest (nuevo, solo dev).

**Spec:** `docs/superpowers/specs/2026-06-03-formulario-captura-externa-design.md`

**Convenciones de verificación (este repo no tiene tests):**
- Lógica pura (`src/lib/intake/token.ts`, `schema.ts`, `map-to-catalog.ts`) → **vitest** (TDD real).
- Rutas/UI/Supabase → `npx tsc --noEmit`, `npm run lint`, `npm run build`, + checkpoints de QA manual.
- Trabaja en la rama `feat/intake-form-captura-externa` (ya creada). Commits frecuentes y específicos (`git add <archivos>`, nunca `-A`).

---

## Task 1: Configurar vitest (solo para lógica pura)

**Files:**
- Modify: `package.json` (devDependencies + script `test`)
- Create: `vitest.config.ts`

- [ ] **Step 1: Instalar vitest**

Run: `npm install -D vitest@^2`
Expected: agrega `vitest` a devDependencies sin errores.

- [ ] **Step 2: Crear `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/lib/intake/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 3: Agregar script `test` en package.json**

En `"scripts"` añade: `"test": "vitest run"` y `"test:watch": "vitest"`.

- [ ] **Step 4: Verificar que vitest corre (sin tests aún)**

Run: `npm test`
Expected: "No test files found" o exit 0; sin errores de configuración.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for intake pure-logic unit tests"
```

---

## Task 2: Modelos Prisma `IntakeLink` / `IntakeSubmission`

**Files:**
- Modify: `prisma/schema.prisma` (agregar al final, antes de cerrar; respetar `@@schema("propyte_crm")`)

- [ ] **Step 1: Agregar enum y modelos a `prisma/schema.prisma`**

```prisma
enum IntakeStatus {
  PENDING
  APPROVED
  REJECTED

  @@schema("propyte_crm")
}

model IntakeLink {
  id          String            @id @default(uuid())
  token       String            @unique
  label       String
  targetDevId String?           // UUID de real_estate_hub.Propyte_desarrollos a actualizar; null = nuevo
  expiresAt   DateTime?         // default 15 días se calcula en el endpoint de creación
  createdBy   String
  revokedAt   DateTime?
  submissions IntakeSubmission[]
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  deletedAt   DateTime?

  @@map("intake_links")
  @@schema("propyte_crm")
}

model IntakeSubmission {
  id          String       @id @default(uuid())
  linkId      String
  link        IntakeLink   @relation(fields: [linkId], references: [id])
  payload     Json
  imageUrls   String[]
  status      IntakeStatus @default(PENDING)
  reviewNotes String?
  resultDevId String?      // UUID del dev creado/actualizado al aprobar (idempotencia)
  reviewedBy  String?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@index([status])
  @@index([linkId])
  @@map("intake_submissions")
  @@schema("propyte_crm")
}
```

- [ ] **Step 2: Generar el SQL de la migración SIN aplicarlo a prod**

Run: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/intake_migration.sql` (revisar el SQL generado: debe ser `CREATE TYPE propyte_crm.IntakeStatus...`, `CREATE TABLE propyte_crm.intake_links...`, `CREATE TABLE propyte_crm.intake_submissions...`).

> Nota: la DB es Supabase **prod compartida**. No usar `prisma migrate dev` ni `db push` contra prod. Aplicar el DDL revisado vía Supabase MCP `apply_migration` (requiere la frase exacta de autorización: `autorizado: aplicar add_intake_tables a prod`) o vía el dashboard. Pedir esa autorización al usuario antes de aplicar.

- [ ] **Step 3: Aplicar DDL a prod (tras autorización del usuario) y regenerar el cliente**

Aplicar `CREATE TYPE/TABLE` en schema `propyte_crm`. Luego:
Run: `npx prisma generate`
Expected: el cliente expone `prisma.intakeLink` y `prisma.intakeSubmission`.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores (los nuevos modelos compilan).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(intake): prisma models IntakeLink + IntakeSubmission"
```

---

## Task 3: `src/lib/intake/token.ts` (TDD)

**Files:**
- Create: `src/lib/intake/token.ts`
- Test: `src/lib/intake/token.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { generateToken, isLinkUsable, defaultExpiry } from "./token";

describe("generateToken", () => {
  it("genera tokens url-safe únicos de longitud estable", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });
});

describe("isLinkUsable", () => {
  const now = new Date("2026-06-03T12:00:00Z");
  it("usable cuando no está revocado ni expirado", () => {
    expect(isLinkUsable({ revokedAt: null, expiresAt: new Date("2026-06-10T00:00:00Z") }, now)).toBe(true);
  });
  it("no usable si revocado", () => {
    expect(isLinkUsable({ revokedAt: now, expiresAt: null }, now)).toBe(false);
  });
  it("no usable si expirado", () => {
    expect(isLinkUsable({ revokedAt: null, expiresAt: new Date("2026-06-01T00:00:00Z") }, now)).toBe(false);
  });
  it("usable si expiresAt es null (sin caducidad)", () => {
    expect(isLinkUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true);
  });
});

describe("defaultExpiry", () => {
  it("son 15 días después de now", () => {
    const now = new Date("2026-06-03T00:00:00Z");
    expect(defaultExpiry(now).toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Correr el test para verque falla**

Run: `npm test`
Expected: FAIL — `Cannot find module './token'`.

- [ ] **Step 3: Implementar `token.ts`**

```ts
import { randomBytes } from "crypto";

/** Token url-safe (~16 chars) para el link público. */
export function generateToken(): string {
  return randomBytes(12).toString("base64url");
}

/** Un link es usable si no está revocado y no ha expirado. */
export function isLinkUsable(
  link: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date
): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt.getTime() < now.getTime()) return false;
  return true;
}

/** Caducidad por defecto: 15 días desde `now`. */
export function defaultExpiry(now: Date): Date {
  return new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Correr el test para ver que pasa**

Run: `npm test`
Expected: PASS (todos los casos de token).

- [ ] **Step 5: Commit**

```bash
git add src/lib/intake/token.ts src/lib/intake/token.test.ts
git commit -m "feat(intake): token helpers (generate, usable, default 15d expiry)"
```

---

## Task 4: `src/lib/intake/schema.ts` — zod payload (TDD)

**Files:**
- Create: `src/lib/intake/schema.ts`
- Test: `src/lib/intake/schema.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { intakePayloadSchema } from "./schema";

const valid = {
  generales: { nombre: "Gobernador 28", tipo: "vertical", unidadesTotales: 126 },
  ubicacion: { ciudad: "Playa del Carmen", playaDistanciaValor: 7, playaDistanciaUnidad: "min" },
  amenidades: { flags: { amenidad_gym: true }, adicionales: ["Sauna"] },
  descripciones: { descripcionEs: "Desarrollo..." },
  tipologias: [{ etiqueta: "A", recamaras: 1, banosCompletos: 1, mediosBanos: 1, m2: 65.9, precioDesde: 2455628 }],
  multimedia: { tourVirtual: "https://kuula.co/x" },
  faq: [{ pregunta: "¿Dónde?", respuesta: "Playa del Carmen" }],
};

describe("intakePayloadSchema", () => {
  it("acepta un payload válido y aplica defaults", () => {
    const r = intakePayloadSchema.parse(valid);
    expect(r.generales.nombre).toBe("Gobernador 28");
    expect(r.tipologias[0].moneda).toBe("MXN");
    expect(r.tipologias[0].estado).toBe("Preventa");
  });
  it("rechaza si no hay tipologías", () => {
    expect(() => intakePayloadSchema.parse({ ...valid, tipologias: [] })).toThrow();
  });
  it("rechaza nombre vacío", () => {
    expect(() => intakePayloadSchema.parse({ ...valid, generales: { nombre: "" } })).toThrow();
  });
  it("rechaza unidad de distancia inválida", () => {
    expect(() =>
      intakePayloadSchema.parse({ ...valid, ubicacion: { playaDistanciaUnidad: "minutos" } })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Correr el test para ver que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Implementar `schema.ts`**

```ts
import { z } from "zod";

export const ESTADO_UNIDAD = [
  "Disponible", "Preventa", "Reservada", "Vendida", "Entrega inmediata", "No Disponible",
] as const;

export const tipologiaSchema = z.object({
  etiqueta: z.string().min(1),
  recamaras: z.coerce.number().int().min(0),
  banosCompletos: z.coerce.number().int().min(0),
  mediosBanos: z.coerce.number().int().min(0).default(0),
  m2: z.coerce.number().positive(),
  precioDesde: z.coerce.number().nonnegative().optional(),
  moneda: z.enum(["MXN", "USD"]).default("MXN"),
  estado: z.enum(ESTADO_UNIDAD).default("Preventa"),
});
export type Tipologia = z.infer<typeof tipologiaSchema>;

export const intakePayloadSchema = z.object({
  generales: z.object({
    nombre: z.string().min(2),
    desarrollador: z.string().optional().default(""),
    tipo: z.enum(["vertical", "horizontal", "mixto", "lotes"]).default("vertical"),
    etapa: z.string().optional().default(""),
    avancePct: z.coerce.number().min(0).max(100).optional(),
    fechaEntrega: z.string().optional().default(""),
    unidadesTotales: z.coerce.number().int().nonnegative().optional(),
    unidadesDisponibles: z.coerce.number().int().nonnegative().optional(),
  }),
  ubicacion: z
    .object({
      estado: z.string().optional().default(""),
      municipio: z.string().optional().default(""),
      ciudad: z.string().optional().default(""),
      colonia: z.string().optional().default(""),
      calle: z.string().optional().default(""),
      numeroExt: z.string().optional().default(""),
      playaDistanciaValor: z.coerce.number().optional(),
      playaDistanciaUnidad: z.enum(["min", "horas", "metros", "km"]).optional(),
      linkMaps: z.string().optional().default(""),
      lat: z.coerce.number().optional(),
      lng: z.coerce.number().optional(),
    })
    .default({}),
  amenidades: z
    .object({
      flags: z.record(z.boolean()).default({}),
      adicionales: z.array(z.string()).default([]),
    })
    .default({ flags: {}, adicionales: [] }),
  descripciones: z
    .object({
      descripcionEs: z.string().optional().default(""),
      descripcionCortaEs: z.string().optional().default(""),
      conceptoDiseno: z.string().optional().default(""),
    })
    .default({}),
  tipologias: z.array(tipologiaSchema).min(1),
  multimedia: z
    .object({
      tourVirtual: z.string().optional().default(""),
      brochureUrl: z.string().optional().default(""),
    })
    .default({}),
  faq: z
    .array(z.object({ pregunta: z.string().min(1), respuesta: z.string().min(1) }))
    .default([]),
});
export type IntakePayload = z.infer<typeof intakePayloadSchema>;
```

- [ ] **Step 4: Correr el test para ver que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/intake/schema.ts src/lib/intake/schema.test.ts
git commit -m "feat(intake): zod payload schema (solo ES, tipologías requeridas)"
```

---

## Task 5: `src/lib/intake/map-to-catalog.ts` — mapeo a catálogo (TDD)

**Files:**
- Create: `src/lib/intake/map-to-catalog.ts`
- Test: `src/lib/intake/map-to-catalog.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { intakePayloadSchema } from "./schema";
import { mapPayloadToDevelopment, mapTypologyToUnit, mergeFillGaps } from "./map-to-catalog";

const payload = intakePayloadSchema.parse({
  generales: { nombre: "Gobernador 28", tipo: "vertical", unidadesTotales: 126, unidadesDisponibles: 19, fechaEntrega: "Mayo 2026" },
  ubicacion: { ciudad: "Playa del Carmen", estado: "Quintana Roo", playaDistanciaValor: 7, playaDistanciaUnidad: "min" },
  amenidades: { flags: { amenidad_gym: true, columna_invalida: true }, adicionales: ["Sauna"] },
  descripciones: { descripcionEs: "Desc" },
  tipologias: [
    { etiqueta: "A", recamaras: 1, banosCompletos: 1, mediosBanos: 1, m2: 65.9, precioDesde: 2455628 },
    { etiqueta: "B2", recamaras: 2, banosCompletos: 2, mediosBanos: 1, m2: 99.5, precioDesde: 3323250 },
  ],
  multimedia: {},
  faq: [{ pregunta: "¿Dónde?", respuesta: "PDC" }],
});

describe("mapPayloadToDevelopment", () => {
  const dev = mapPayloadToDevelopment(payload);
  it("mapea campos base y fuerza borrador", () => {
    expect(dev.nombre_desarrollo).toBe("Gobernador 28");
    expect(dev.ciudad).toBe("Playa del Carmen");
    expect(dev.ext_publicado).toBe(false);
    expect(dev.web_status).toBe("draft");
    expect(dev.last_source).toBe("intake-form");
  });
  it("calcula precio min/max desde tipologías", () => {
    expect(dev.ext_precio_min_mxn).toBe(2455628);
    expect(dev.ext_precio_max_mxn).toBe(3323250);
  });
  it("aplica solo flags de amenidad en whitelist", () => {
    expect(dev.amenidad_gym).toBe(true);
    expect("columna_invalida" in dev).toBe(false);
  });
  it("arma ext_content_es.faq", () => {
    expect((dev.ext_content_es as any).faq[0]).toEqual({ question: "¿Dónde?", answer: "PDC" });
  });
});

describe("mapTypologyToUnit", () => {
  it("mapea tipología a fila de unidad", () => {
    const u = mapTypologyToUnit(payload.tipologias[0], "dev-uuid", "Gobernador 28");
    expect(u.id_desarrollo).toBe("dev-uuid");
    expect(u.recamaras).toBe(1);
    expect(u.medios_banos).toBe(1);
    expect(u.superficie_total_m2).toBe(65.9);
    expect(u.precio_desde).toBe(2455628);
    expect(u.estado_unidad).toBe("Preventa");
    expect(u.es_preventa).toBe(true);
    expect(u.ext_publicado).toBe(false);
    expect(u.titulo_unidad).toContain("Gobernador 28");
    expect(u.titulo_unidad).toContain("A");
  });
});

describe("mergeFillGaps", () => {
  it("conserva valor existente cuando el entrante viene vacío", () => {
    const out = mergeFillGaps(
      { ciudad: "Playa del Carmen", colonia: "Centro" },
      { ciudad: "Playa del Carmen", colonia: null }
    );
    expect(out.colonia).toBe("Centro");
  });
  it("usa el entrante cuando trae valor", () => {
    const out = mergeFillGaps({ ciudad: "Cancún" }, { ciudad: "Playa del Carmen" });
    expect(out.ciudad).toBe("Playa del Carmen");
  });
});
```

- [ ] **Step 2: Correr el test para ver que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module './map-to-catalog'`.

- [ ] **Step 3: Implementar `map-to-catalog.ts`**

```ts
import type { IntakePayload, Tipologia } from "./schema";

const ALLOWED_AMENITY_COLUMNS = new Set([
  "amenidad_alberca_comunitaria", "amenidad_alberca_privada", "amenidad_gym", "amenidad_coworking",
  "amenidad_rooftop", "amenidad_elevador", "amenidad_area_ninos", "amenidad_cancha", "amenidad_salon_eventos",
  "amenidad_spa", "amenidad_seguridad_24h", "amenidad_acceso_controlado", "amenidad_lobby", "amenidad_pet_zone",
  "amenidad_jardin_comunitario", "amenidad_yoga", "amenidad_fire_pit", "amenidad_concierge", "amenidad_cctv",
  "amenidad_bodega", "amenidad_restaurante",
]);

function blankToNull(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
}

/** Mapea el payload del formulario a las columnas de real_estate_hub.Propyte_desarrollos (borrador). */
export function mapPayloadToDevelopment(p: IntakePayload): Record<string, unknown> {
  const precios = p.tipologias
    .map((t) => t.precioDesde)
    .filter((x): x is number => typeof x === "number" && x > 0);

  const dev: Record<string, unknown> = {
    nombre_desarrollo: p.generales.nombre.trim(),
    tipo_desarrollo: p.generales.tipo,
    avance_obra_porcentaje: p.generales.avancePct ?? null,
    ext_fecha_entrega_texto: blankToNull(p.generales.fechaEntrega),
    unidades_totales: p.generales.unidadesTotales ?? null,
    unidades_disponibles: p.generales.unidadesDisponibles ?? null,
    pais: "México",
    estado: blankToNull(p.ubicacion.estado),
    municipio: blankToNull(p.ubicacion.municipio),
    ciudad: blankToNull(p.ubicacion.ciudad),
    colonia: blankToNull(p.ubicacion.colonia),
    calle: blankToNull(p.ubicacion.calle),
    ext_numero_exterior: blankToNull(p.ubicacion.numeroExt),
    link_maps: blankToNull(p.ubicacion.linkMaps),
    latitud: p.ubicacion.lat ?? null,
    longitud: p.ubicacion.lng ?? null,
    playa_distancia_valor: p.ubicacion.playaDistanciaValor ?? null,
    playa_distancia_unidad: p.ubicacion.playaDistanciaUnidad ?? null,
    ext_descripcion_es: blankToNull(p.descripciones.descripcionEs),
    ext_descripcion_corta_es: blankToNull(p.descripciones.descripcionCortaEs),
    concepto_diseno: blankToNull(p.descripciones.conceptoDiseno),
    tour_virtual_desarrollo: blankToNull(p.multimedia.tourVirtual),
    brochure_pdf: blankToNull(p.multimedia.brochureUrl),
    amenidades_adicionales: p.amenidades.adicionales.length ? p.amenidades.adicionales : null,
    ext_content_es: p.faq.length
      ? { faq: p.faq.map((f) => ({ question: f.pregunta, answer: f.respuesta })) }
      : null,
    ext_precio_min_mxn: precios.length ? Math.min(...precios) : null,
    ext_precio_max_mxn: precios.length ? Math.max(...precios) : null,
    ext_moneda: "MXN",
    ext_publicado: false,
    web_status: "draft",
    last_source: "intake-form",
    ext_detection_source: "intake-form",
  };

  for (const [k, v] of Object.entries(p.amenidades.flags)) {
    if (ALLOWED_AMENITY_COLUMNS.has(k)) dev[k] = !!v;
  }
  return dev;
}

/** Mapea una tipología a una fila de real_estate_hub.Propyte_unidades (borrador). */
export function mapTypologyToUnit(
  t: Tipologia,
  devId: string,
  devName: string
): Record<string, unknown> {
  return {
    id_desarrollo: devId,
    titulo_unidad: `${devName} — Tipo ${t.etiqueta} · ${t.recamaras} rec`,
    subtitulo_unidad: `Departamento · ${t.m2} m²`,
    tipo_unidad: "Departamento",
    ext_tipologia: t.etiqueta,
    recamaras: t.recamaras,
    banos_completos: t.banosCompletos,
    medios_banos: t.mediosBanos,
    superficie_total_m2: t.m2,
    superficie_construida_m2: t.m2,
    precio_mxn: t.precioDesde ?? null,
    precio_desde: t.precioDesde ?? null,
    moneda_principal: t.moneda,
    estado_unidad: t.estado,
    es_preventa: t.estado === "Preventa",
    es_nueva_unidad: true,
    ext_publicado: false,
    web_status: "draft",
    last_source: "intake-form",
  };
}

/**
 * Merge "rellenar huecos": conserva el valor existente cuando el entrante viene vacío
 * (null / "" / array vacío). Lo de Supabase es autoritativo.
 */
export function mergeFillGaps(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  const isEmpty = (v: unknown) =>
    v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  for (const [k, v] of Object.entries(incoming)) {
    if (isEmpty(v) && !isEmpty(existing[k])) out[k] = existing[k];
  }
  return out;
}
```

- [ ] **Step 4: Correr el test para ver que pasa**

Run: `npm test`
Expected: PASS (todos los describe).

- [ ] **Step 5: Commit**

```bash
git add src/lib/intake/map-to-catalog.ts src/lib/intake/map-to-catalog.test.ts
git commit -m "feat(intake): mapeo payload -> Propyte_desarrollos/unidades + merge fill-gaps"
```

---

## Task 6: Helpers de escritura al catálogo + storage — `src/lib/intake/catalog-writer.ts`

**Files:**
- Create: `src/lib/intake/catalog-writer.ts`
- Create: `scripts/intake-smoke.ts` (smoke manual)

> Estos tocan Supabase (no unit test). Verificación: `tsc` + smoke script contra un registro de prueba.

- [ ] **Step 1: Crear bucket de cuarentena en Supabase**

Crear bucket `intake-quarantine` (público-read en v1, mismo modelo que `property-images`). Vía dashboard o MCP. Anotar: en una fase posterior puede hacerse privado con signed URLs.

- [ ] **Step 2: Implementar `catalog-writer.ts`**

```ts
import { getSupabaseServiceClient } from "@/lib/supabase";
import { mapPayloadToDevelopment, mapTypologyToUnit, mergeFillGaps } from "./map-to-catalog";
import type { IntakePayload } from "./schema";

const HUB = "real_estate_hub";
const PROD_BUCKET = "property-images";
const QUARANTINE_BUCKET = "intake-quarantine";

/** Crea o actualiza (merge fill-gaps) el desarrollo. Devuelve su id. */
export async function upsertDevelopment(
  payload: IntakePayload,
  targetDevId: string | null
): Promise<string> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");

  const incoming = mapPayloadToDevelopment(payload);

  if (targetDevId) {
    const { data: existing, error: selErr } = await supabase
      .schema(HUB)
      .from("Propyte_desarrollos")
      .select("*")
      .eq("id", targetDevId)
      .single();
    if (selErr) throw new Error(`No se encontró el desarrollo destino: ${selErr.message}`);

    const merged = mergeFillGaps(existing, incoming);
    const { error } = await supabase
      .schema(HUB)
      .from("Propyte_desarrollos")
      .update(merged)
      .eq("id", targetDevId);
    if (error) throw new Error(`Update dev falló: ${error.message}`);
    return targetDevId;
  }

  const { data, error } = await supabase
    .schema(HUB)
    .from("Propyte_desarrollos")
    .insert(incoming)
    .select("id")
    .single();
  if (error) throw new Error(`Insert dev falló: ${error.message}`);
  return data.id as string;
}

/** Inserta las unidades-tipología del desarrollo. */
export async function insertTypologies(
  payload: IntakePayload,
  devId: string
): Promise<number> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");

  const rows = payload.tipologias.map((t) =>
    mapTypologyToUnit(t, devId, payload.generales.nombre.trim())
  );
  const { error } = await supabase.schema(HUB).from("Propyte_unidades").insert(rows);
  if (error) throw new Error(`Insert unidades falló: ${error.message}`);
  return rows.length;
}

/** Copia imágenes de cuarentena al bucket de producción y devuelve las URLs públicas. */
export async function promoteQuarantineImages(
  quarantinePaths: string[],
  devId: string
): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");

  const out: string[] = [];
  for (const path of quarantinePaths) {
    const { data: file, error: dlErr } = await supabase.storage
      .from(QUARANTINE_BUCKET)
      .download(path);
    if (dlErr || !file) throw new Error(`Descarga cuarentena falló (${path}): ${dlErr?.message}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `development/${devId}/${path.split("/").pop()}`;
    const { error: upErr } = await supabase.storage
      .from(PROD_BUCKET)
      .upload(fileName, buffer, { contentType: "image/webp", upsert: false });
    if (upErr) throw new Error(`Subida a producción falló: ${upErr.message}`);

    const { data: urlData } = supabase.storage.from(PROD_BUCKET).getPublicUrl(fileName);
    out.push(urlData.publicUrl);
  }
  return out;
}

/** Setea fotos_desarrollo (append) y foto_portada (si está vacía) en el desarrollo. */
export async function attachDevelopmentImages(devId: string, urls: string[]): Promise<void> {
  if (!urls.length) return;
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");

  const { data: current } = await supabase
    .schema(HUB)
    .from("Propyte_desarrollos")
    .select("fotos_desarrollo, foto_portada")
    .eq("id", devId)
    .single();

  const existing: string[] = Array.isArray(current?.fotos_desarrollo) ? current.fotos_desarrollo : [];
  const update: Record<string, unknown> = { fotos_desarrollo: [...existing, ...urls] };
  if (!current?.foto_portada) update.foto_portada = urls[0];

  const { error } = await supabase
    .schema(HUB)
    .from("Propyte_desarrollos")
    .update(update)
    .eq("id", devId);
  if (error) throw new Error(`Attach imágenes falló: ${error.message}`);
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 4: Smoke manual del upsert (dev de prueba, sin imágenes)**

Crear `scripts/intake-smoke.ts`:

```ts
import { upsertDevelopment, insertTypologies } from "@/lib/intake/catalog-writer";
import { intakePayloadSchema } from "@/lib/intake/schema";

async function main() {
  const payload = intakePayloadSchema.parse({
    generales: { nombre: "ZZZ Smoke Captura", tipo: "vertical" },
    ubicacion: { ciudad: "Playa del Carmen" },
    descripciones: { descripcionEs: "smoke" },
    tipologias: [{ etiqueta: "A", recamaras: 1, banosCompletos: 1, m2: 60, precioDesde: 1000000 }],
    faq: [],
  });
  const devId = await upsertDevelopment(payload, null);
  const n = await insertTypologies(payload, devId);
  console.log("OK dev", devId, "unidades", n);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/intake-smoke.ts`
Expected: imprime `OK dev <uuid> unidades 1`. **Luego borrar manualmente el dev de prueba** (`ZZZ Smoke Captura`) del catálogo vía Supabase.

- [ ] **Step 5: Commit**

```bash
git add src/lib/intake/catalog-writer.ts scripts/intake-smoke.ts
git commit -m "feat(intake): catalog-writer (upsert dev/unidades + promote imágenes)"
```

---

## Task 7: Layout de tabs en `/developments` + guard de la subpestaña Captura

**Files:**
- Create: `src/app/(dashboard)/developments/layout.tsx`
- Create: `src/app/(dashboard)/developments/captura/page.tsx`

- [ ] **Step 1: Crear `layout.tsx` con tabs (patrón meta-ads)**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const baseTabs = [{ label: "Desarrollos", href: "/developments" }];
const adminTabs = [{ label: "Captura", href: "/developments/captura" }];

export default function DevelopmentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role as string | undefined;
  const tabs = ["DIRECTOR", "GERENTE", "ADMIN"].includes(role ?? "")
    ? [...baseTabs, ...adminTabs]
    : baseTabs;

  const isActive = (href: string) =>
    href === "/developments" ? pathname === "/developments" : pathname?.startsWith(href);

  return (
    <div className="space-y-5">
      <div className="flex gap-1" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative px-4 py-2 text-[13px] font-medium transition-colors"
              style={{ color: active ? "var(--color-teal)" : "var(--text-tertiary)" }}
            >
              {tab.label}
              {active && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: "var(--color-teal)" }} />
              )}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Crear la página Captura con guard de rol (server)**

```tsx
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import CapturaClient from "./captura-client";

export default async function CapturaPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!["DIRECTOR", "GERENTE", "ADMIN"].includes(session.user.role)) redirect("/developments");
  return <CapturaClient />;
}
```

- [ ] **Step 3: Stub temporal de `captura-client.tsx` (se completa en Tasks 8 y 12)**

```tsx
"use client";
export default function CapturaClient() {
  return <div className="text-sm text-muted-foreground">Captura — en construcción.</div>;
}
```

Create: `src/app/(dashboard)/developments/captura/captura-client.tsx` con ese contenido.

- [ ] **Step 4: Verificar build/tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores. (Verificación visual del tab queda para QA en Task 14.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/developments/layout.tsx" "src/app/(dashboard)/developments/captura/page.tsx" "src/app/(dashboard)/developments/captura/captura-client.tsx"
git commit -m "feat(intake): subpestaña Captura en /developments con guard DIRECTOR/GERENTE"
```

---

## Task 8: API de links + UI de generación/listado

**Files:**
- Create: `src/app/api/captura/links/route.ts` (GET lista, POST crear)
- Create: `src/app/api/captura/links/[id]/route.ts` (PATCH revocar)
- Modify: `src/app/(dashboard)/developments/captura/captura-client.tsx`

- [ ] **Step 1: Implementar `links/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { generateToken, defaultExpiry } from "@/lib/intake/token";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const links = await prisma.intakeLink.findMany({
    where: { deletedAt: null },
    include: { _count: { select: { submissions: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ data: links });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.label || typeof body.label !== "string") {
    return NextResponse.json({ error: "label requerido" }, { status: 400 });
  }
  const noExpiry = body.noExpiry === true;
  const link = await prisma.intakeLink.create({
    data: {
      token: generateToken(),
      label: body.label.trim(),
      targetDevId: typeof body.targetDevId === "string" && body.targetDevId ? body.targetDevId : null,
      expiresAt: noExpiry ? null : defaultExpiry(new Date()),
      createdBy: session.user.id ?? session.user.email ?? "unknown",
    },
  });
  return NextResponse.json({ data: link }, { status: 201 });
}
```

- [ ] **Step 2: Implementar `links/[id]/route.ts` (revocar)**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const link = await prisma.intakeLink.update({
    where: { id: params.id },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ data: link });
}
```

- [ ] **Step 3: UI de links en `captura-client.tsx` (sub-vista "Links")**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Link = { id: string; token: string; label: string; targetDevId: string | null; expiresAt: string | null; revokedAt: string | null; _count: { submissions: number } };

export default function CapturaClient() {
  const [view, setView] = useState<"links" | "bandeja">("links");
  const [links, setLinks] = useState<Link[]>([]);
  const [label, setLabel] = useState("");
  const [targetDevId, setTargetDevId] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const r = await fetch("/api/captura/links");
    const j = await r.json();
    setLinks(j.data ?? []);
  }
  useEffect(() => { load(); }, []);

  async function createLink() {
    if (!label.trim()) return;
    setCreating(true);
    await fetch("/api/captura/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, targetDevId: targetDevId || undefined }),
    });
    setLabel(""); setTargetDevId(""); setCreating(false); load();
  }
  async function revoke(id: string) {
    await fetch(`/api/captura/links/${id}`, { method: "PATCH" });
    load();
  }
  function copyUrl(token: string) {
    const url = `${window.location.origin}/captura/${token}`;
    navigator.clipboard.writeText(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button variant={view === "links" ? "default" : "outline"} onClick={() => setView("links")}>Links</Button>
        <Button variant={view === "bandeja" ? "default" : "outline"} onClick={() => setView("bandeja")}>Bandeja</Button>
      </div>

      {view === "links" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
            <div className="flex-1 min-w-[200px]">
              <Label>Etiqueta</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Gobernador 28 – Grupo 28" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label>Actualizar desarrollo (UUID, opcional)</Label>
              <Input value={targetDevId} onChange={(e) => setTargetDevId(e.target.value)} placeholder="dejar vacío = nuevo" />
            </div>
            <Button onClick={createLink} disabled={creating || !label.trim()}>Generar link</Button>
          </div>

          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground">
              <th className="p-2">Etiqueta</th><th className="p-2">Envíos</th><th className="p-2">Caduca</th><th className="p-2">Estado</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2">{l.label}</td>
                  <td className="p-2">{l._count.submissions}</td>
                  <td className="p-2">{l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : "—"}</td>
                  <td className="p-2">{l.revokedAt ? "Revocado" : "Activo"}</td>
                  <td className="p-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyUrl(l.token)}>Copiar URL</Button>
                    {!l.revokedAt && <Button size="sm" variant="outline" onClick={() => revoke(l.id)}>Revocar</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "bandeja" && <BandejaPlaceholder />}
    </div>
  );
}

function BandejaPlaceholder() {
  return <div className="text-sm text-muted-foreground">Bandeja — se implementa en Task 12.</div>;
}
```

- [ ] **Step 4: Verificar tipos + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/captura/links/route.ts" "src/app/api/captura/links/[id]/route.ts" "src/app/(dashboard)/developments/captura/captura-client.tsx"
git commit -m "feat(intake): API + UI de generación/listado/revocación de links"
```

---

## Task 9: Validación de token (server) + ruta pública del formulario

**Files:**
- Create: `src/lib/intake/get-usable-link.ts`
- Create: `src/app/captura/[token]/page.tsx`
- Verify: `src/middleware.ts` (confirmar que `/captura` y `/api/captura/[token]` NO están en `matcher`)

- [ ] **Step 1: Helper server `get-usable-link.ts`**

```ts
import prisma from "@/lib/db";
import { isLinkUsable } from "./token";

/** Devuelve el link si es usable (existe, no revocado, no expirado); si no, null. */
export async function getUsableLink(token: string) {
  const link = await prisma.intakeLink.findUnique({ where: { token } });
  if (!link || link.deletedAt) return null;
  if (!isLinkUsable({ revokedAt: link.revokedAt, expiresAt: link.expiresAt }, new Date())) return null;
  return link;
}
```

- [ ] **Step 2: Página pública `/captura/[token]/page.tsx`**

```tsx
import { getUsableLink } from "@/lib/intake/get-usable-link";
import CapturaFormClient from "./captura-form-client";

export default async function PublicCapturaPage({ params }: { params: { token: string } }) {
  const link = await getUsableLink(params.token);

  if (!link) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Link inválido o expirado</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pide a tu contacto en Propyte que te genere un nuevo enlace.
        </p>
      </div>
    );
  }

  return (
    <CapturaFormClient
      token={params.token}
      label={link.label}
      isUpdate={!!link.targetDevId}
    />
  );
}
```

- [ ] **Step 3: Confirmar que la ruta es pública**

Abrir `src/middleware.ts` y verificar que `config.matcher` **no** contiene `/captura` ni `/api/captura/:path*`. No agregar nada (los públicos quedan fuera). Anotar mentalmente para Task 13 que SÍ se agregará `/api/captura/submissions/:path*` y `/api/captura/links/:path*` (protegidos).

- [ ] **Step 4: Verificar tipos (con un stub temporal del client)**

Crear stub mínimo `src/app/captura/[token]/captura-form-client.tsx`:

```tsx
"use client";
export default function CapturaFormClient(props: { token: string; label: string; isUpdate: boolean }) {
  return <div>Formulario {props.label} ({props.token})</div>;
}
```

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 5: Commit**

```bash
git add "src/lib/intake/get-usable-link.ts" "src/app/captura/[token]/page.tsx" "src/app/captura/[token]/captura-form-client.tsx"
git commit -m "feat(intake): ruta pública /captura/[token] + validación de link"
```

---

## Task 10: Endpoint público de subida de imágenes (cuarentena)

**Files:**
- Create: `src/app/api/captura/[token]/upload/route.ts`

- [ ] **Step 1: Implementar el endpoint (mirror de upload-image, gated por token, a `intake-quarantine`)**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getUsableLink } from "@/lib/intake/get-usable-link";
import sharp from "sharp";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const BUCKET = "intake-quarantine";

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const link = await getUsableLink(params.token);
  if (!link) return NextResponse.json({ error: "Link inválido o expirado" }, { status: 410 });

  const supabase = getSupabaseServiceClient();
  if (!supabase) return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });

  let formData: FormData;
  try { formData = await request.formData(); }
  catch { return NextResponse.json({ error: "FormData inválido" }, { status: 400 }); }

  const files = formData.getAll("files") as File[];
  if (!files.length) return NextResponse.json({ error: "No se enviaron archivos" }, { status: 400 });

  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: `Tipo no permitido: ${file.type}` }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: `Archivo > 10MB` }, { status: 400 });
  }

  const paths: string[] = [];
  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const optimized = await sharp(buffer)
        .resize(1920, undefined, { withoutEnlargement: true, fit: "inside" })
        .webp({ quality: 80 })
        .toBuffer();
      const path = `${params.token}/${randomUUID()}.webp`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, optimized, {
        contentType: "image/webp", upsert: false,
      });
      if (error) throw new Error(error.message);
      paths.push(path);
    }
    return NextResponse.json({ success: true, paths });
  } catch (err) {
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

> Nota: devuelve **paths** de cuarentena (no URLs públicas), que es lo que se guarda en `IntakeSubmission.imageUrls` y consume `promoteQuarantineImages` al aprobar.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/captura/[token]/upload/route.ts"
git commit -m "feat(intake): upload público de imágenes a bucket de cuarentena (token-gated)"
```

---

## Task 11: Formulario público (cliente) + endpoint submit

**Files:**
- Create: `src/app/api/captura/[token]/submit/route.ts`
- Rewrite: `src/app/captura/[token]/captura-form-client.tsx`

- [ ] **Step 1: Implementar `submit/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getUsableLink } from "@/lib/intake/get-usable-link";
import { intakePayloadSchema } from "@/lib/intake/schema";

const MAX_SUBMISSIONS_PER_LINK = 50; // tope anti-abuso

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const link = await getUsableLink(params.token);
  if (!link) return NextResponse.json({ error: "Link inválido o expirado" }, { status: 410 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  // Honeypot: si viene relleno, fingir éxito sin guardar.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ success: true });
  }

  const parsed = intakePayloadSchema.safeParse(body.payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const count = await prisma.intakeSubmission.count({ where: { linkId: link.id } });
  if (count >= MAX_SUBMISSIONS_PER_LINK) {
    return NextResponse.json({ error: "Este link alcanzó el máximo de envíos" }, { status: 429 });
  }

  const imageUrls: string[] = Array.isArray(body.imagePaths)
    ? body.imagePaths.filter((p: unknown) => typeof p === "string")
    : [];

  const submission = await prisma.intakeSubmission.create({
    data: { linkId: link.id, payload: parsed.data, imageUrls, status: "PENDING" },
  });
  return NextResponse.json({ success: true, id: submission.id }, { status: 201 });
}
```

- [ ] **Step 2: Reescribir `captura-form-client.tsx` (form por secciones, autosave, upload, submit)**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AMENITY_OPTIONS: { key: string; label: string }[] = [
  { key: "amenidad_alberca_comunitaria", label: "Alberca" },
  { key: "amenidad_gym", label: "Gimnasio" },
  { key: "amenidad_coworking", label: "Coworking" },
  { key: "amenidad_rooftop", label: "Rooftop" },
  { key: "amenidad_elevador", label: "Elevador" },
  { key: "amenidad_area_ninos", label: "Área de niños" },
  { key: "amenidad_cancha", label: "Canchas" },
  { key: "amenidad_seguridad_24h", label: "Seguridad 24h" },
];

type Tipologia = { etiqueta: string; recamaras: string; banosCompletos: string; mediosBanos: string; m2: string; precioDesde: string };

const emptyTipologia: Tipologia = { etiqueta: "", recamaras: "", banosCompletos: "", mediosBanos: "0", m2: "", precioDesde: "" };

export default function CapturaFormClient({ token, label, isUpdate }: { token: string; label: string; isUpdate: boolean }) {
  const storageKey = `captura:${token}`;
  const [generales, setGenerales] = useState({ nombre: "", desarrollador: "", tipo: "vertical", etapa: "", avancePct: "", fechaEntrega: "", unidadesTotales: "", unidadesDisponibles: "" });
  const [ubicacion, setUbicacion] = useState({ estado: "", municipio: "", ciudad: "", colonia: "", calle: "", numeroExt: "", playaDistanciaValor: "", playaDistanciaUnidad: "", linkMaps: "" });
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [adicionales, setAdicionales] = useState("");
  const [descripciones, setDescripciones] = useState({ descripcionEs: "", descripcionCortaEs: "", conceptoDiseno: "" });
  const [tipologias, setTipologias] = useState<Tipologia[]>([{ ...emptyTipologia }]);
  const [multimedia, setMultimedia] = useState({ tourVirtual: "", brochureUrl: "" });
  const [faq, setFaq] = useState<{ pregunta: string; respuesta: string }[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Autosave / restore
  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        s.generales && setGenerales(s.generales);
        s.ubicacion && setUbicacion(s.ubicacion);
        s.flags && setFlags(s.flags);
        typeof s.adicionales === "string" && setAdicionales(s.adicionales);
        s.descripciones && setDescripciones(s.descripciones);
        s.tipologias && setTipologias(s.tipologias);
        s.multimedia && setMultimedia(s.multimedia);
        s.faq && setFaq(s.faq);
      } catch { /* ignore */ }
    }
  }, [storageKey]);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ generales, ubicacion, flags, adicionales, descripciones, tipologias, multimedia, faq }));
  }, [storageKey, generales, ubicacion, flags, adicionales, descripciones, tipologias, multimedia, faq]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    const r = await fetch(`/api/captura/${token}/upload`, { method: "POST", body: fd });
    const j = await r.json();
    if (j.paths) setImagePaths((prev) => [...prev, ...j.paths]);
  }

  function buildPayload() {
    return {
      generales: {
        nombre: generales.nombre, desarrollador: generales.desarrollador, tipo: generales.tipo,
        etapa: generales.etapa, avancePct: generales.avancePct || undefined, fechaEntrega: generales.fechaEntrega,
        unidadesTotales: generales.unidadesTotales || undefined, unidadesDisponibles: generales.unidadesDisponibles || undefined,
      },
      ubicacion: {
        ...ubicacion,
        playaDistanciaValor: ubicacion.playaDistanciaValor || undefined,
        playaDistanciaUnidad: ubicacion.playaDistanciaUnidad || undefined,
      },
      amenidades: { flags, adicionales: adicionales.split(",").map((s) => s.trim()).filter(Boolean) },
      descripciones,
      tipologias: tipologias.map((t) => ({
        etiqueta: t.etiqueta, recamaras: t.recamaras || 0, banosCompletos: t.banosCompletos || 0,
        mediosBanos: t.mediosBanos || 0, m2: t.m2 || 0, precioDesde: t.precioDesde || undefined,
      })),
      multimedia,
      faq,
    };
  }

  async function submit() {
    setStatus("saving"); setErrorMsg("");
    const r = await fetch(`/api/captura/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: buildPayload(), imagePaths, website }),
    });
    if (r.ok) { localStorage.removeItem(storageKey); setStatus("done"); }
    else { const j = await r.json().catch(() => ({})); setErrorMsg(j.error ?? "Error al enviar"); setStatus("error"); }
  }

  if (status === "done") {
    return <div className="mx-auto max-w-md p-8 text-center"><h1 className="text-xl font-semibold">¡Gracias!</h1><p className="mt-2 text-sm text-muted-foreground">La información de <b>{label}</b> fue enviada para revisión.</p></div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Captura de desarrollo</h1>
        <p className="text-sm text-muted-foreground">{label}{isUpdate ? " · (actualización)" : ""}</p>
      </header>

      {/* Honeypot oculto */}
      <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />

      <Section title="1. Generales">
        <Field label="Nombre del desarrollo *"><Input value={generales.nombre} onChange={(e) => setGenerales({ ...generales, nombre: e.target.value })} /></Field>
        <Field label="Desarrolladora"><Input value={generales.desarrollador} onChange={(e) => setGenerales({ ...generales, desarrollador: e.target.value })} /></Field>
        <Field label="Fecha de entrega (texto)"><Input value={generales.fechaEntrega} onChange={(e) => setGenerales({ ...generales, fechaEntrega: e.target.value })} placeholder="Mayo 2026" /></Field>
        <Field label="Unidades totales"><Input value={generales.unidadesTotales} onChange={(e) => setGenerales({ ...generales, unidadesTotales: e.target.value })} /></Field>
        <Field label="Unidades disponibles"><Input value={generales.unidadesDisponibles} onChange={(e) => setGenerales({ ...generales, unidadesDisponibles: e.target.value })} /></Field>
      </Section>

      <Section title="2. Ubicación">
        <Field label="Estado"><Input value={ubicacion.estado} onChange={(e) => setUbicacion({ ...ubicacion, estado: e.target.value })} /></Field>
        <Field label="Ciudad"><Input value={ubicacion.ciudad} onChange={(e) => setUbicacion({ ...ubicacion, ciudad: e.target.value })} /></Field>
        <Field label="Colonia"><Input value={ubicacion.colonia} onChange={(e) => setUbicacion({ ...ubicacion, colonia: e.target.value })} /></Field>
        <Field label="Link de Google Maps"><Input value={ubicacion.linkMaps} onChange={(e) => setUbicacion({ ...ubicacion, linkMaps: e.target.value })} /></Field>
      </Section>

      <Section title="3. Amenidades">
        <div className="grid grid-cols-2 gap-2">
          {AMENITY_OPTIONS.map((a) => (
            <label key={a.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!flags[a.key]} onChange={(e) => setFlags({ ...flags, [a.key]: e.target.checked })} />
              {a.label}
            </label>
          ))}
        </div>
        <Field label="Otras amenidades (separadas por coma)"><Input value={adicionales} onChange={(e) => setAdicionales(e.target.value)} placeholder="Sauna, Boliche, Pádel" /></Field>
      </Section>

      <Section title="4. Descripción">
        <Field label="Descripción"><textarea className="w-full rounded border p-2 text-sm" rows={4} value={descripciones.descripcionEs} onChange={(e) => setDescripciones({ ...descripciones, descripcionEs: e.target.value })} /></Field>
        <Field label="Concepto de diseño"><Input value={descripciones.conceptoDiseno} onChange={(e) => setDescripciones({ ...descripciones, conceptoDiseno: e.target.value })} /></Field>
      </Section>

      <Section title="5. Tipologías *">
        {tipologias.map((t, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 rounded border p-3">
            <Field label="Etiqueta"><Input value={t.etiqueta} onChange={(e) => updateTip(i, "etiqueta", e.target.value)} placeholder="A" /></Field>
            <Field label="Recámaras"><Input value={t.recamaras} onChange={(e) => updateTip(i, "recamaras", e.target.value)} /></Field>
            <Field label="m²"><Input value={t.m2} onChange={(e) => updateTip(i, "m2", e.target.value)} /></Field>
            <Field label="Baños completos"><Input value={t.banosCompletos} onChange={(e) => updateTip(i, "banosCompletos", e.target.value)} /></Field>
            <Field label="Medios baños"><Input value={t.mediosBanos} onChange={(e) => updateTip(i, "mediosBanos", e.target.value)} /></Field>
            <Field label="Precio desde (MXN)"><Input value={t.precioDesde} onChange={(e) => updateTip(i, "precioDesde", e.target.value)} /></Field>
          </div>
        ))}
        <Button variant="outline" onClick={() => setTipologias([...tipologias, { ...emptyTipologia }])}>+ Agregar tipología</Button>
      </Section>

      <Section title="6. Multimedia e imágenes">
        <Field label="Tour virtual (URL)"><Input value={multimedia.tourVirtual} onChange={(e) => setMultimedia({ ...multimedia, tourVirtual: e.target.value })} /></Field>
        <Field label="Brochure (URL)"><Input value={multimedia.brochureUrl} onChange={(e) => setMultimedia({ ...multimedia, brochureUrl: e.target.value })} /></Field>
        <Field label="Fotos / renders / plantas">
          <input type="file" accept="image/*" multiple onChange={(e) => uploadFiles(e.target.files)} />
          <p className="mt-1 text-xs text-muted-foreground">{imagePaths.length} imagen(es) subida(s).</p>
        </Field>
      </Section>

      <Section title="7. Preguntas frecuentes">
        {faq.map((f, i) => (
          <div key={i} className="space-y-1 rounded border p-3">
            <Input value={f.pregunta} onChange={(e) => updateFaq(i, "pregunta", e.target.value)} placeholder="Pregunta" />
            <Input value={f.respuesta} onChange={(e) => updateFaq(i, "respuesta", e.target.value)} placeholder="Respuesta" />
          </div>
        ))}
        <Button variant="outline" onClick={() => setFaq([...faq, { pregunta: "", respuesta: "" }])}>+ Agregar pregunta</Button>
      </Section>

      {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
      <Button onClick={submit} disabled={status === "saving" || !generales.nombre || !tipologias[0]?.etiqueta} className="w-full">
        {status === "saving" ? "Enviando…" : "Enviar para revisión"}
      </Button>
    </div>
  );

  function updateTip(i: number, key: keyof Tipologia, value: string) {
    setTipologias((prev) => prev.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)));
  }
  function updateFaq(i: number, key: "pregunta" | "respuesta", value: string) {
    setFaq((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">{title}</h2>{children}</section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}
```

- [ ] **Step 3: Verificar tipos + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/captura/[token]/submit/route.ts" "src/app/captura/[token]/captura-form-client.tsx"
git commit -m "feat(intake): formulario público por secciones + endpoint submit (honeypot + tope)"
```

---

## Task 12: Bandeja de revisión (GET submissions + UI)

**Files:**
- Create: `src/app/api/captura/submissions/route.ts` (GET)
- Modify: `src/app/(dashboard)/developments/captura/captura-client.tsx` (reemplazar `BandejaPlaceholder`)

- [ ] **Step 1: Implementar GET `submissions/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const status = new URL(request.url).searchParams.get("status") ?? "PENDING";
  const subs = await prisma.intakeSubmission.findMany({
    where: { status: status as "PENDING" | "APPROVED" | "REJECTED" },
    include: { link: { select: { label: true, targetDevId: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ data: subs });
}
```

- [ ] **Step 2: Reemplazar `BandejaPlaceholder` por la bandeja real**

En `captura-client.tsx`, sustituir la función `BandejaPlaceholder` por:

```tsx
function BandejaPlaceholder() {
  const [subs, setSubs] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/captura/submissions?status=PENDING");
    const j = await r.json();
    setSubs(j.data ?? []);
  }
  useEffect(() => { load(); }, []);

  async function approve(id: string) {
    setBusy(id);
    const r = await fetch(`/api/captura/submissions/${id}/approve`, { method: "POST" });
    setBusy(null);
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error ?? "Error al aprobar"); return; }
    load();
  }
  async function reject(id: string) {
    const note = prompt("Motivo del rechazo (opcional):") ?? "";
    setBusy(id);
    await fetch(`/api/captura/submissions/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", reviewNotes: note }),
    });
    setBusy(null); load();
  }

  if (!subs.length) return <div className="text-sm text-muted-foreground">No hay envíos pendientes.</div>;

  return (
    <div className="space-y-4">
      {subs.map((s) => (
        <div key={s.id} className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{s.payload?.generales?.nombre ?? "(sin nombre)"}</p>
              <p className="text-xs text-muted-foreground">
                {s.link?.label} · {s.payload?.tipologias?.length ?? 0} tipologías · {s.imageUrls?.length ?? 0} imágenes
                {s.link?.targetDevId ? " · actualización" : " · nuevo"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy === s.id} onClick={() => approve(s.id)}>Aprobar</Button>
              <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => reject(s.id)}>Rechazar</Button>
            </div>
          </div>
          <pre className="mt-3 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(s.payload, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
```

(Renombrar la llamada `<BandejaPlaceholder />` a `<Bandeja />` opcional; mantener consistencia con el nombre de la función.)

- [ ] **Step 3: Verificar tipos + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build OK (el endpoint `approve` aún no existe pero se llama por fetch en runtime; no rompe el build).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/captura/submissions/route.ts" "src/app/(dashboard)/developments/captura/captura-client.tsx"
git commit -m "feat(intake): bandeja de revisión de envíos (lista + acciones)"
```

---

## Task 13: Endpoints de aprobación / rechazo + proteger rutas admin en middleware

**Files:**
- Create: `src/app/api/captura/submissions/[id]/approve/route.ts`
- Create: `src/app/api/captura/submissions/[id]/route.ts` (PATCH reject/edit)
- Modify: `src/middleware.ts` (agregar prefijos protegidos)

- [ ] **Step 1: Implementar `approve/route.ts` (idempotente)**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { intakePayloadSchema } from "@/lib/intake/schema";
import { upsertDevelopment, insertTypologies, promoteQuarantineImages, attachDevelopmentImages } from "@/lib/intake/catalog-writer";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const sub = await prisma.intakeSubmission.findUnique({ where: { id: params.id }, include: { link: true } });
  if (!sub) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
  if (sub.status === "APPROVED" && sub.resultDevId) {
    return NextResponse.json({ success: true, devId: sub.resultDevId, alreadyApproved: true });
  }

  const parsed = intakePayloadSchema.safeParse(sub.payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const devId = await upsertDevelopment(parsed.data, sub.link.targetDevId);
    await insertTypologies(parsed.data, devId);
    if (sub.imageUrls.length) {
      const urls = await promoteQuarantineImages(sub.imageUrls, devId);
      await attachDevelopmentImages(devId, urls);
    }
    await prisma.intakeSubmission.update({
      where: { id: sub.id },
      data: { status: "APPROVED", resultDevId: devId, reviewedBy: session.user.id ?? session.user.email ?? "unknown" },
    });
    return NextResponse.json({ success: true, devId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implementar `submissions/[id]/route.ts` (PATCH reject/edit payload)**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { intakePayloadSchema } from "@/lib/intake/schema";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "action requerida" }, { status: 400 });

  if (body.action === "reject") {
    const sub = await prisma.intakeSubmission.update({
      where: { id: params.id },
      data: { status: "REJECTED", reviewNotes: typeof body.reviewNotes === "string" ? body.reviewNotes : null, reviewedBy: session.user.id ?? session.user.email ?? "unknown" },
    });
    return NextResponse.json({ data: sub });
  }

  if (body.action === "edit") {
    const parsed = intakePayloadSchema.safeParse(body.payload);
    if (!parsed.success) return NextResponse.json({ error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 });
    const sub = await prisma.intakeSubmission.update({ where: { id: params.id }, data: { payload: parsed.data } });
    return NextResponse.json({ data: sub });
  }

  return NextResponse.json({ error: "action inválida" }, { status: 400 });
}
```

- [ ] **Step 3: Proteger las rutas admin en `src/middleware.ts`**

En `config.matcher`, **agregar** (sin tocar los públicos `/captura` ni `/api/captura/[token]`):

```ts
    "/api/captura/links/:path*",
    "/api/captura/submissions/:path*",
```

> No agregar `/api/captura/:path*` genérico (atraparía submit/upload públicos). Solo los dos prefijos admin.

- [ ] **Step 4: Verificar tipos + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/captura/submissions/[id]/approve/route.ts" "src/app/api/captura/submissions/[id]/route.ts" src/middleware.ts
git commit -m "feat(intake): aprobar (idempotente)/rechazar envíos + proteger rutas admin"
```

---

## Task 14: Limpieza de cuarentena + QA manual end-to-end

**Files:**
- Create: `scripts/intake-cleanup-quarantine.ts`

- [ ] **Step 1: Script de limpieza de cuarentena (> 30 días, submissions no aprobadas)**

```ts
import prisma from "@/lib/db";
import { getSupabaseServiceClient } from "@/lib/supabase";

const QUARANTINE_BUCKET = "intake-quarantine";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const cutoff = new Date(Date.now() - THIRTY_DAYS);

  const stale = await prisma.intakeSubmission.findMany({
    where: { status: { in: ["PENDING", "REJECTED"] }, createdAt: { lt: cutoff } },
    select: { id: true, imageUrls: true },
  });
  let removed = 0;
  for (const s of stale) {
    if (s.imageUrls.length) {
      await supabase.storage.from(QUARANTINE_BUCKET).remove(s.imageUrls);
      removed += s.imageUrls.length;
    }
  }
  console.log(`Limpieza: ${stale.length} envíos, ${removed} imágenes borradas de cuarentena.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Agregar script en package.json: `"intake:cleanup": "tsx scripts/intake-cleanup-quarantine.ts"`. (Agendar con cron en una fase posterior.)

- [ ] **Step 2: QA manual end-to-end (entorno dev: `npm run dev`)**

Verificar y marcar cada uno:
- [ ] Como DIRECTOR/GERENTE, en `/developments` aparece el tab **Captura**; como ASESOR **no** aparece y `/developments/captura` redirige.
- [ ] Generar un link → copiar URL → abrir en ventana incógnito (sin login) → el formulario carga.
- [ ] Llenar generales + 2 tipologías + subir 1–2 imágenes + enviar → pantalla "¡Gracias!".
- [ ] El envío aparece en la **Bandeja**; el JSON y conteos son correctos.
- [ ] **Aprobar** → en Supabase, `Propyte_desarrollos` tiene el dev en borrador (`ext_publicado=false`, `last_source='intake-form'`), las `Propyte_unidades` por tipología, y `fotos_desarrollo`/`foto_portada` con las imágenes movidas a `property-images`.
- [ ] Re-aprobar el mismo envío → responde `alreadyApproved`, no duplica.
- [ ] Generar link con `targetDevId` de un dev existente con datos → aprobar → campos llenos **no** se pisan con vacíos (merge fill-gaps).
- [ ] Token revocado/expirado → la ruta pública muestra "Link inválido o expirado" y submit/upload responden 410.
- [ ] **Limpiar** los registros de prueba creados en el catálogo.

- [ ] **Step 3: Commit**

```bash
git add scripts/intake-cleanup-quarantine.ts package.json
git commit -m "chore(intake): script de limpieza de cuarentena + checklist QA"
```

---

## Self-review (cobertura del spec)

- Modelo de datos `IntakeLink`/`IntakeSubmission` → Task 2. ✅
- Token + caducidad 15d + usable → Task 3. ✅
- Payload solo-ES con tipologías requeridas → Task 4. ✅
- Mapeo a `Propyte_desarrollos`/`Propyte_unidades` + amenidades whitelist + precio min/max + FAQ + merge fill-gaps → Tasks 5/6/13. ✅
- Subpestaña "Captura" en `/developments` con guard DIRECTOR/GERENTE → Task 7. ✅
- Generar/listar/revocar links → Task 8. ✅
- Ruta pública + validación token → Task 9. ✅
- Upload público a cuarentena (mime/10MB/sin tope/rate por token) → Task 10. ✅
- Formulario por secciones + autosave + honeypot + tope de envíos → Task 11. ✅
- Bandeja de revisión + aprobar (idempotente)/rechazar → Tasks 12/13. ✅
- Imágenes cuarentena → producción al aprobar → Tasks 6/13. ✅
- Middleware: públicos fuera del matcher, admin protegidos → Tasks 9/13. ✅
- Limpieza de cuarentena + QA bordes (token expirado, doble aprobación, update sin pisar) → Task 14. ✅

**Pendiente explícito de ejecución:** el DDL de Task 2 a Supabase prod requiere autorización del usuario (`autorizado: aplicar add_intake_tables a prod`); el inglés (`_en`) y el agendado del cron de limpieza son fase posterior (fuera de v1).
