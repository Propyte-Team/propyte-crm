# Bot de reclutamiento — Fase 1 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ Anexo vigente (2026-11-02, decisión de Luis):** las tareas 1, 6, 8, 9, 10 y 11 de este plan
> quedan REEMPLAZADAS y las 4, 12 y 14 enmendadas por
> `2026-11-02-bot-reclutamiento-f1-integracion-926.md`: el bot se integra a la tabla y pantalla del
> módulo Reclutamiento existente (#926) en vez de crear `recruitment_candidates`.

**Goal:** El bot del CRM perfila a candidatos a asesor por WhatsApp, Instagram y Messenger con el guion nuevo, los evalúa (APTO / REVISAR / NO_APTO) con un modelo configurable, liga el CV que manden, guarda todo en `recruitment_candidates` y avisa al responsable de la plaza.

**Architecture:** Se reescribe el playbook del "Agente Reclutamiento" (captura a `custom.reclutamiento_*` con el motor de playbooks existente, sin tocar `apply.ts`/`engine.ts`). Un módulo nuevo `src/lib/reclutamiento/` evalúa al terminar el playbook (función pura + rúbrica de actitud con Claude), persiste en la tabla nueva, avisa y devuelve al bot el objetivo de cierre según el resultado. `core.ts` liga adjuntos como CV; `bot-respond.ts` pasa los adjuntos al historial y llama al hook de reclutamiento.

**Tech Stack:** Next.js 14, Prisma (schema `propyte_crm`, migraciones SQL manuales en `prisma/migrations-manual/`), zod, Claude vía `askClaude` (`src/lib/bot/claude.ts`, fetch directo), vitest con `vi.mock("@/lib/db")`.

**Spec:** `docs/superpowers/specs/2026-11-02-bot-reclutamiento-design.md`

**Desviación respecto al spec §5.1, decidida al planear:** el playbook escribe en `Contact.custom.reclutamiento_*` (camino probado: `skipIfFilled`, cronología y auditoría ya funcionan) y la evaluación copia esas respuestas a `recruitment_candidates.respuestas`. No se agrega el targetField virtual `recruitment.*` a `fields.ts`/`apply.ts`. La tabla sigue siendo la fuente para la UI de F2.

**Convenciones del repo que aplican a TODAS las tareas:**
- Trabajar en el worktree `.claude/worktrees/bot-reclutamiento` (rama `feat/bot-reclutamiento`), nunca en el checkout principal.
- Antes de cada commit: `git config user.name "Propyte-Luis"; git config user.email "marketing@propyte.com"`.
- Correr tests con `npx vitest run <ruta>`; la suite completa es `npm test`.
- `npm run typecheck` tiene ~7000 errores preexistentes de entorno; se verifica solo que los archivos tocados no agreguen errores: `npx tsc --noEmit 2>&1 | grep "src/lib/reclutamiento\|segment-playbooks\|bot-respond.ts\|core.ts" || echo "sin errores en archivos tocados"`.
- Todo texto para humanos (comentarios, mensajes, commits) en español.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `prisma/schema.prisma` | Modificar | enums `RecruitmentStage`, `RecruitmentVerdict`; modelo `RecruitmentCandidate` |
| `prisma/migrations-manual/2026-11-02-recruitment-candidates.sql` | Crear | tabla + enums + índices; canales del bot; identidad del agente |
| `src/lib/reclutamiento/modelo.ts` | Crear | zod del modelo de criterios, default, `resolverModelo`, `cargarModelo` |
| `src/lib/reclutamiento/evaluar.ts` | Crear | función pura `evaluar()` |
| `src/lib/reclutamiento/actitud.ts` | Crear | rúbrica de actitud con Claude |
| `src/lib/reclutamiento/etapas.ts` | Crear | transiciones válidas |
| `src/lib/reclutamiento/respuestas.ts` | Crear | leer `custom.reclutamiento_*` → `Respuestas` tipadas |
| `src/lib/reclutamiento/candidato.ts` | Crear | `asegurarCandidato`, `persistirEvaluacion`, `resumenIA` |
| `src/lib/reclutamiento/avisos.ts` | Crear | tarea + notificaciones + eventos según resultado |
| `src/lib/reclutamiento/cv.ts` | Crear | `ligarCv` desde un mensaje con adjunto |
| `src/lib/reclutamiento/hook.ts` | Crear | `hookReclutamiento`: qué hace el bot al terminar el playbook y después |
| `src/lib/bot/playbook/segment-playbooks.ts` | Modificar | playbook nuevo de reclutamiento |
| `src/lib/bot/playbook/segment-playbooks.test.ts` | Modificar | validar el playbook nuevo |
| `src/lib/bot/classify.ts` | Modificar | pista de palabras clave de EMPLEO |
| `src/lib/bot/bot-respond.ts` | Modificar | adjuntos en el historial; llamar al hook |
| `src/lib/messaging/core.ts` | Modificar | llamar a `ligarCv` tras guardar un inbound con media |
| `src/lib/workflows/events.ts` | Modificar | tipos de evento `recruitment.*` |
| `docs/qa/reclutamiento-smoke.md` | Crear | prueba de humo por canal |

---

### Task 1: Esquema y migración SQL

**Files:**
- Modify: `prisma/schema.prisma` (después del `enum Plaza`, y al final del archivo)
- Create: `prisma/migrations-manual/2026-11-02-recruitment-candidates.sql`

- [ ] **Step 1: Agregar enums y modelo a Prisma**

Después del bloque `enum Plaza { ... }` (línea ~51) agregar:

```prisma
// Reclutamiento de asesores (spec 2026-11-02-bot-reclutamiento-design.md §5.2)
enum RecruitmentStage {
  NUEVO
  PERFILANDO
  CV_PENDIENTE
  APTO
  REVISAR
  NO_APTO
  ENTREVISTA
  CONTRATADO
  DESCARTADO

  @@schema("propyte_crm")
}

enum RecruitmentVerdict {
  APTO
  REVISAR
  NO_APTO

  @@schema("propyte_crm")
}
```

Al final de `prisma/schema.prisma` agregar:

```prisma
// Candidato a asesor: una fila por contacto que entra al Agente Reclutamiento.
// Sin relation a Contact a propósito (mismo criterio que contact_scores): un deploy
// que salga antes de aplicar la migración no debe tumbar las consultas de contactos.
model RecruitmentCandidate {
  id                String              @id @default(uuid())
  contactId         String              @unique
  etapa             RecruitmentStage    @default(NUEVO)
  plaza             Plaza?
  canal             ConversationChannel
  respuestas        Json                @default("{}")
  filtros           Json                @default("{}")
  puntaje           Int?
  desglose          Json?
  resultado         RecruitmentVerdict?
  motivo            String?
  cvUrl             String?
  cvMime            String?
  cvFilename        String?
  cvMessageId       String?
  horarioEntrevista String?
  entrevistaAt      DateTime?
  responsableId     String?
  resumenIA         String?             @db.Text
  evaluadoAt        DateTime?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @default(now()) @updatedAt

  @@index([etapa])
  @@index([plaza, etapa])
  @@map("recruitment_candidates")
  @@schema("propyte_crm")
}
```

- [ ] **Step 2: Escribir la migración SQL**

`prisma/migrations-manual/2026-11-02-recruitment-candidates.sql`:

```sql
-- Bot de reclutamiento F1 (spec docs/superpowers/specs/2026-11-02-bot-reclutamiento-design.md).
-- Solo AGREGA. Idempotente. Correr ANTES del merge, vía execute_sql al proyecto del CRM
-- (schema propyte_crm). Mientras no se corra, el hook de reclutamiento falla con guarda
-- (console.error) y el bot sigue contestando con el playbook.

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."RecruitmentStage" AS ENUM
    ('NUEVO','PERFILANDO','CV_PENDIENTE','APTO','REVISAR','NO_APTO','ENTREVISTA','CONTRATADO','DESCARTADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."RecruitmentVerdict" AS ENUM ('APTO','REVISAR','NO_APTO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."recruitment_candidates" (
  "id"                TEXT PRIMARY KEY,
  "contactId"         TEXT NOT NULL UNIQUE,
  "etapa"             "propyte_crm"."RecruitmentStage" NOT NULL DEFAULT 'NUEVO',
  "plaza"             "propyte_crm"."Plaza",
  "canal"             "propyte_crm"."ConversationChannel" NOT NULL,
  "respuestas"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "filtros"           JSONB NOT NULL DEFAULT '{}'::jsonb,
  "puntaje"           INTEGER,
  "desglose"          JSONB,
  "resultado"         "propyte_crm"."RecruitmentVerdict",
  "motivo"            TEXT,
  "cvUrl"             TEXT,
  "cvMime"            TEXT,
  "cvFilename"        TEXT,
  "cvMessageId"       TEXT,
  "horarioEntrevista" TEXT,
  "entrevistaAt"      TIMESTAMP(3),
  "responsableId"     TEXT,
  "resumenIA"         TEXT,
  "evaluadoAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "recruitment_candidates_etapa_idx"
  ON "propyte_crm"."recruitment_candidates" ("etapa");
CREATE INDEX IF NOT EXISTS "recruitment_candidates_plaza_etapa_idx"
  ON "propyte_crm"."recruitment_candidates" ("plaza", "etapa");

-- Identidad del Agente Reclutamiento alineada al guion nuevo (spec §4).
UPDATE "propyte_crm"."bot_agent_profiles"
   SET "identity" = 'Atiendes a personas que quieren unirse al equipo de asesores inmobiliarios de Propyte en Playa del Carmen o Mérida. Tu misión: conocer al candidato con preguntas naturales, una o dos por mensaje, sin sonar a formulario. Eres honesto sobre el esquema: 100 % comisión, sin sueldo base, con capacitación y acompañamiento del equipo. Si pregunta por sueldo, comisiones, horario o la empresa, contesta breve con la ficha de la vacante y retoma la pregunta pendiente. No prometas contratación ni fechas. Cuando se te indique el resultado, cierra con calidez y sin listar criterios.',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "name" = 'Agente Reclutamiento';

-- Canales del bot (spec §9): WhatsApp ya estaba; entran Instagram y Messenger.
UPDATE "propyte_crm"."bot_config"
   SET "enabledChannels" = '["WHATSAPP","INSTAGRAM","MESSENGER"]'::jsonb;
```

Nota para quien aplique: verificar el nombre de la columna de `bot_config` con
`SELECT column_name FROM information_schema.columns WHERE table_name='bot_config'` antes de correr el último UPDATE; en Prisma es `enabledChannels`.

- [ ] **Step 3: Generar el cliente de Prisma y verificar**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sin errores. Después: `npx prisma validate` → `The schema is valid`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-11-02-recruitment-candidates.sql
git commit -m "feat(reclutamiento): tabla recruitment_candidates y migración manual

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Modelo de criterios (zod + default + carga)

**Files:**
- Create: `src/lib/reclutamiento/modelo.ts`
- Test: `src/lib/reclutamiento/modelo.test.ts`

- [ ] **Step 1: Test que falla**

`src/lib/reclutamiento/modelo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MODELO_DEFAULT, resolverModelo, CLAVE_MODELO } from "./modelo";

describe("modelo de reclutamiento", () => {
  it("el default suma 100 puntos: puntuables + actitud + CV", () => {
    const puntuables = Object.values(MODELO_DEFAULT.puntuables).reduce(
      (acc, p) => acc + Math.max(...Object.values(p.puntos)),
      0,
    );
    expect(puntuables).toBe(75);
    expect(puntuables + MODELO_DEFAULT.actitudMax + MODELO_DEFAULT.cvPuntos).toBe(100);
  });

  it("el default tiene los 6 filtros eliminatorios del spec", () => {
    expect(Object.keys(MODELO_DEFAULT.filtros).sort()).toEqual(
      ["acepta_comision", "colchon_meses", "disponibilidad", "mayor_edad", "movilidad", "plaza"].sort(),
    );
  });

  it("sin valor en SystemConfig usa el default sin error", () => {
    expect(resolverModelo(undefined)).toEqual({ modelo: MODELO_DEFAULT });
  });

  it("un modelo inválido cae al default y reporta el error", () => {
    const r = resolverModelo({ umbrales: { apto: "alto" } });
    expect(r.modelo).toEqual(MODELO_DEFAULT);
    expect(r.error).toBeTruthy();
  });

  it("un modelo válido con umbrales distintos se respeta", () => {
    const r = resolverModelo({ ...MODELO_DEFAULT, umbrales: { apto: 70, revisar: 50 } });
    expect(r.error).toBeUndefined();
    expect(r.modelo.umbrales).toEqual({ apto: 70, revisar: 50 });
  });

  it("la clave de SystemConfig es estable", () => {
    expect(CLAVE_MODELO).toBe("reclutamiento.modelo");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/reclutamiento/modelo.test.ts`
Expected: FAIL, `Cannot find module './modelo'`.

- [ ] **Step 3: Implementar `modelo.ts`**

```ts
// Modelo de criterios del bot de reclutamiento (spec §3). Es DATO, no código: vive en
// SystemConfig bajo `reclutamiento.modelo` y se edita sin deploy (F2 le pone pantalla).
// Inválido o ausente → MODELO_DEFAULT, igual que scoring.modelo.
import { z } from "zod";
import prisma from "@/lib/db";

export const CLAVE_MODELO = "reclutamiento.modelo";
export const CLAVE_FICHA = "reclutamiento.ficha";
export const CLAVE_RESPONSABLES = "reclutamiento.responsables";

/** Claves de respuesta que el playbook captura en custom.reclutamiento_<clave>. */
export const CLAVES_FILTRO = ["mayor_edad", "acepta_comision", "disponibilidad", "colchon_meses", "plaza", "movilidad"] as const;
export const CLAVES_PUNTUABLE = [
  "experiencia_inmobiliaria", "cartera_clientes", "experiencia_ventas", "ingles", "prospeccion_digital",
] as const;
export type ClaveFiltro = (typeof CLAVES_FILTRO)[number];
export type ClavePuntuable = (typeof CLAVES_PUNTUABLE)[number];

/** Un filtro eliminatorio: qué valores PASAN y cuáles son AMBIGUOS (ni pasa ni falla claro). */
const filtroSchema = z.object({
  activo: z.boolean().default(true),
  pasa: z.array(z.string().min(1)).min(1),
  ambiguo: z.array(z.string()).default([]),
});

/** Un puntuable: puntos por valor de la opción. */
const puntuableSchema = z.object({
  puntos: z.record(z.string(), z.number().min(0)),
});

export const modeloSchema = z.object({
  version: z.number().int().positive(),
  filtros: z.record(z.enum(CLAVES_FILTRO), filtroSchema),
  puntuables: z.record(z.enum(CLAVES_PUNTUABLE), puntuableSchema),
  /** Puntos máximos de la rúbrica de actitud (3 preguntas situacionales). */
  actitudMax: z.number().min(0),
  /** Puntos por haber mandado CV. */
  cvPuntos: z.number().min(0),
  umbrales: z.object({ apto: z.number().min(0).max(100), revisar: z.number().min(0).max(100) }),
});
export type ModeloReclutamiento = z.infer<typeof modeloSchema>;

export const MODELO_DEFAULT: ModeloReclutamiento = {
  version: 1,
  filtros: {
    mayor_edad:      { activo: true, pasa: ["SI"], ambiguo: [] },
    acepta_comision: { activo: true, pasa: ["SI"], ambiguo: ["NO_SE"] },
    disponibilidad:  { activo: true, pasa: ["TIEMPO_COMPLETO", "MEDIO_TIEMPO"], ambiguo: ["NO_SE"] },
    colchon_meses:   { activo: true, pasa: ["TRES_A_SEIS", "MAS_DE_SEIS"], ambiguo: ["NO_SE"] },
    plaza:           { activo: true, pasa: ["PDC", "MERIDA", "OTRA_CON_MUDANZA"], ambiguo: [] },
    movilidad:       { activo: true, pasa: ["SI"], ambiguo: ["SOLO_DISPOSICION"] },
  },
  puntuables: {
    experiencia_inmobiliaria: { puntos: { SIN_EXPERIENCIA: 0, MENOS_1_ANO: 10, DE_1_A_3_ANOS: 18, MAS_DE_3_ANOS: 25 } },
    cartera_clientes:         { puntos: { NO: 0, MENOS_10: 8, DE_10_A_50: 14, MAS_50_O_INVERSIONISTAS: 20 } },
    experiencia_ventas:       { puntos: { NINGUNA: 0, OTRO_GIRO: 8, CONSULTIVA_ALTO_VALOR: 15 } },
    ingles:                   { puntos: { NO: 0, BASICO: 4, CONVERSACIONAL: 10 } },
    prospeccion_digital:      { puntos: { NO: 0, SI: 5 } },
  },
  actitudMax: 20,
  cvPuntos: 5,
  umbrales: { apto: 65, revisar: 40 },
};

export function resolverModelo(valor: unknown): { modelo: ModeloReclutamiento; error?: string } {
  if (valor === undefined || valor === null) return { modelo: MODELO_DEFAULT };
  const r = modeloSchema.safeParse(valor);
  if (r.success) return { modelo: r.data };
  return { modelo: MODELO_DEFAULT, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

export const FICHA_DEFAULT =
  "Buscamos asesores inmobiliarios para Playa del Carmen y Mérida. Esquema 100 % comisión (sin sueldo base), " +
  "comisiones competitivas por venta, capacitación continua, inventario de desarrollos y acompañamiento del equipo. " +
  "Necesitas vehículo propio y disponibilidad para moverte por la zona. El proceso: una charla aquí, tu CV y una entrevista con el gerente de la plaza.";

export interface ResponsablesReclutamiento {
  PDC?: string[];
  MERIDA?: string[];
  default?: string[];
}

export async function cargarConfigReclutamiento(): Promise<{
  modelo: ModeloReclutamiento;
  ficha: string;
  responsables: ResponsablesReclutamiento;
  errorModelo?: string;
}> {
  const filas = await prisma.systemConfig.findMany({
    where: { key: { in: [CLAVE_MODELO, CLAVE_FICHA, CLAVE_RESPONSABLES] } },
  });
  const valor = (k: string) => filas.find((f) => f.key === k)?.value;
  const { modelo, error } = resolverModelo(valor(CLAVE_MODELO));
  const ficha = typeof valor(CLAVE_FICHA) === "string" && (valor(CLAVE_FICHA) as string).trim()
    ? (valor(CLAVE_FICHA) as string)
    : FICHA_DEFAULT;
  const resp = valor(CLAVE_RESPONSABLES);
  const responsables = resp && typeof resp === "object" && !Array.isArray(resp) ? (resp as ResponsablesReclutamiento) : {};
  return { modelo, ficha, responsables, ...(error ? { errorModelo: error } : {}) };
}
```

- [ ] **Step 4: Correr tests**

Run: `npx vitest run src/lib/reclutamiento/modelo.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/modelo.ts src/lib/reclutamiento/modelo.test.ts
git commit -m "feat(reclutamiento): modelo de criterios configurable en SystemConfig

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Lectura de respuestas desde `custom`

**Files:**
- Create: `src/lib/reclutamiento/respuestas.ts`
- Test: `src/lib/reclutamiento/respuestas.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from "vitest";
import { leerRespuestas, PREFIJO_CUSTOM, CLAVES_ACTITUD } from "./respuestas";

describe("leerRespuestas", () => {
  it("toma solo las llaves reclutamiento_* y les quita el prefijo", () => {
    const r = leerRespuestas({
      reclutamiento_plaza: "PDC",
      reclutamiento_colchon_meses: "TRES_A_SEIS",
      propiedad_venta_tipo: "CASA",
      reclutamiento_actitud_1: "Porque me gusta tratar con gente",
    });
    expect(r).toEqual({
      plaza: "PDC",
      colchon_meses: "TRES_A_SEIS",
      actitud_1: "Porque me gusta tratar con gente",
    });
  });

  it("ignora valores vacíos o no string", () => {
    expect(leerRespuestas({ reclutamiento_plaza: "", reclutamiento_ingles: 3 })).toEqual({});
  });

  it("custom null → sin respuestas", () => {
    expect(leerRespuestas(null)).toEqual({});
  });

  it("expone el prefijo y las claves de actitud que usa el playbook", () => {
    expect(PREFIJO_CUSTOM).toBe("reclutamiento_");
    expect(CLAVES_ACTITUD).toEqual(["actitud_1", "actitud_2", "actitud_3"]);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/reclutamiento/respuestas.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`src/lib/reclutamiento/respuestas.ts`:

```ts
// Las respuestas del candidato las escribe el playbook en Contact.custom con el prefijo
// `reclutamiento_` (ver segment-playbooks.ts). Aquí se leen tipadas; la evaluación las
// copia a recruitment_candidates.respuestas para que la UI no dependa del Json del contacto.
export const PREFIJO_CUSTOM = "reclutamiento_";
export const CLAVES_ACTITUD = ["actitud_1", "actitud_2", "actitud_3"] as const;

export type Respuestas = Record<string, string>;

export function leerRespuestas(custom: unknown): Respuestas {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return {};
  const out: Respuestas = {};
  for (const [k, v] of Object.entries(custom as Record<string, unknown>)) {
    if (!k.startsWith(PREFIJO_CUSTOM)) continue;
    if (typeof v !== "string" || !v.trim()) continue;
    out[k.slice(PREFIJO_CUSTOM.length)] = v;
  }
  return out;
}

export function claveCustom(clave: string): string {
  return `${PREFIJO_CUSTOM}${clave}`;
}
```

- [ ] **Step 4: Correr tests** → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/respuestas.ts src/lib/reclutamiento/respuestas.test.ts
git commit -m "feat(reclutamiento): lectura tipada de respuestas desde custom

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Evaluación pura

**Files:**
- Create: `src/lib/reclutamiento/evaluar.ts`
- Test: `src/lib/reclutamiento/evaluar.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from "vitest";
import { evaluar } from "./evaluar";
import { MODELO_DEFAULT } from "./modelo";

const pasaTodo = {
  mayor_edad: "SI", acepta_comision: "SI", disponibilidad: "TIEMPO_COMPLETO",
  colchon_meses: "TRES_A_SEIS", plaza: "PDC", movilidad: "SI",
};

describe("evaluar", () => {
  it("APTO: pasa filtros y suma ≥ 65", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "DE_10_A_50", experiencia_ventas: "CONSULTIVA_ALTO_VALOR", ingles: "CONVERSACIONAL", prospeccion_digital: "SI" },
      actitudPuntos: 10, cvRecibido: false, modelo: MODELO_DEFAULT,
    });
    // 25 + 14 + 15 + 10 + 5 + 10 = 79
    expect(r.puntaje).toBe(79);
    expect(r.resultado).toBe("APTO");
    expect(r.filtros).toEqual({ mayor_edad: "PASA", acepta_comision: "PASA", disponibilidad: "PASA", colchon_meses: "PASA", plaza: "PASA", movilidad: "PASA" });
    expect(r.motivo).toBeNull();
  });

  it("NO_APTO por filtro claro aunque el puntaje sea alto", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, movilidad: "NO", experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "MAS_50_O_INVERSIONISTAS", experiencia_ventas: "CONSULTIVA_ALTO_VALOR", ingles: "CONVERSACIONAL", prospeccion_digital: "SI" },
      actitudPuntos: 20, cvRecibido: true, modelo: MODELO_DEFAULT,
    });
    expect(r.puntaje).toBe(100);
    expect(r.resultado).toBe("NO_APTO");
    expect(r.motivo).toBe("filtro:movilidad");
  });

  it("REVISAR: un solo filtro ambiguo con puntaje ≥ apto", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, colchon_meses: "NO_SE", experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "MAS_50_O_INVERSIONISTAS", experiencia_ventas: "CONSULTIVA_ALTO_VALOR", ingles: "CONVERSACIONAL", prospeccion_digital: "SI" },
      actitudPuntos: 0, cvRecibido: false, modelo: MODELO_DEFAULT,
    });
    expect(r.filtros.colchon_meses).toBe("AMBIGUO");
    expect(r.resultado).toBe("REVISAR");
    expect(r.motivo).toBe("ambiguo:colchon_meses");
  });

  it("dos filtros ambiguos → NO_APTO", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, colchon_meses: "NO_SE", disponibilidad: "NO_SE", experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "MAS_50_O_INVERSIONISTAS", experiencia_ventas: "CONSULTIVA_ALTO_VALOR", ingles: "CONVERSACIONAL", prospeccion_digital: "SI" },
      actitudPuntos: 20, cvRecibido: true, modelo: MODELO_DEFAULT,
    });
    expect(r.resultado).toBe("NO_APTO");
  });

  it("REVISAR por banda media; NO_APTO por banda baja", () => {
    const medio = evaluar({ respuestas: { ...pasaTodo, experiencia_inmobiliaria: "DE_1_A_3_ANOS", cartera_clientes: "MENOS_10", experiencia_ventas: "OTRO_GIRO", ingles: "BASICO" }, actitudPuntos: 10, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(medio.puntaje).toBe(48);
    expect(medio.resultado).toBe("REVISAR");
    const bajo = evaluar({ respuestas: { ...pasaTodo }, actitudPuntos: 5, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(bajo.puntaje).toBe(5);
    expect(bajo.resultado).toBe("NO_APTO");
    expect(bajo.motivo).toBe("puntaje");
  });

  it("filtro sin respuesta cuenta como AMBIGUO", () => {
    const { plaza: _omit, ...sinPlaza } = pasaTodo;
    const r = evaluar({ respuestas: sinPlaza, actitudPuntos: 0, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(r.filtros.plaza).toBe("AMBIGUO");
  });

  it("actitud null no suma y lo marca en el desglose", () => {
    const r = evaluar({ respuestas: pasaTodo, actitudPuntos: null, cvRecibido: true, modelo: MODELO_DEFAULT });
    expect(r.desglose.actitud).toBeNull();
    expect(r.desglose.cv_recibido).toBe(5);
    expect(r.puntaje).toBe(5);
  });

  it("filtro desactivado en el modelo no elimina", () => {
    const modelo = { ...MODELO_DEFAULT, filtros: { ...MODELO_DEFAULT.filtros, movilidad: { ...MODELO_DEFAULT.filtros.movilidad, activo: false } } };
    const r = evaluar({ respuestas: { ...pasaTodo, movilidad: "NO" }, actitudPuntos: 20, cvRecibido: true, modelo });
    expect(r.filtros.movilidad).toBe("PASA");
  });

  it("la actitud se recorta a actitudMax", () => {
    const r = evaluar({ respuestas: pasaTodo, actitudPuntos: 50, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(r.desglose.actitud).toBe(20);
  });
});
```

- [ ] **Step 2: Correr y ver que falla** → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `evaluar.ts`**

```ts
// Evaluación pura del candidato (spec §3.3). Sin BD, sin IA: recibe respuestas, los puntos de
// actitud ya calculados y el modelo, y devuelve filtros, puntaje, desglose y resultado.
import type { RecruitmentVerdict } from "@prisma/client";
import { CLAVES_FILTRO, CLAVES_PUNTUABLE, type ModeloReclutamiento } from "./modelo";
import type { Respuestas } from "./respuestas";

export type EstadoFiltro = "PASA" | "FALLA" | "AMBIGUO";
export type Filtros = Record<(typeof CLAVES_FILTRO)[number], EstadoFiltro>;
export type Desglose = Record<string, number | null>;

export interface Evaluacion {
  filtros: Filtros;
  puntaje: number;
  desglose: Desglose;
  resultado: RecruitmentVerdict;
  /** `filtro:<clave>` | `ambiguo:<clave>` | `puntaje` | null (APTO limpio). */
  motivo: string | null;
}

export function evaluar(input: {
  respuestas: Respuestas;
  actitudPuntos: number | null;
  cvRecibido: boolean;
  modelo: ModeloReclutamiento;
}): Evaluacion {
  const { respuestas, modelo } = input;

  const filtros = {} as Filtros;
  for (const clave of CLAVES_FILTRO) {
    const f = modelo.filtros[clave];
    if (!f || !f.activo) { filtros[clave] = "PASA"; continue; }
    const v = respuestas[clave];
    if (!v) { filtros[clave] = "AMBIGUO"; continue; }
    filtros[clave] = f.pasa.includes(v) ? "PASA" : f.ambiguo.includes(v) ? "AMBIGUO" : "FALLA";
  }

  const desglose: Desglose = {};
  let puntaje = 0;
  for (const clave of CLAVES_PUNTUABLE) {
    const p = modelo.puntuables[clave];
    const v = respuestas[clave];
    const pts = p && v && v in p.puntos ? p.puntos[v] : 0;
    desglose[clave] = pts;
    puntaje += pts;
  }
  const actitud = input.actitudPuntos === null ? null : Math.max(0, Math.min(modelo.actitudMax, Math.round(input.actitudPuntos)));
  desglose.actitud = actitud;
  puntaje += actitud ?? 0;
  const cv = input.cvRecibido ? modelo.cvPuntos : 0;
  desglose.cv_recibido = cv;
  puntaje += cv;
  puntaje = Math.min(100, Math.round(puntaje));

  const fallados = CLAVES_FILTRO.filter((c) => filtros[c] === "FALLA");
  const ambiguos = CLAVES_FILTRO.filter((c) => filtros[c] === "AMBIGUO");

  let resultado: RecruitmentVerdict;
  let motivo: string | null = null;
  if (fallados.length > 0) {
    resultado = "NO_APTO"; motivo = `filtro:${fallados[0]}`;
  } else if (ambiguos.length > 1) {
    resultado = "NO_APTO"; motivo = `ambiguo:${ambiguos.join(",")}`;
  } else if (ambiguos.length === 1) {
    // Un solo filtro sin respuesta clara: lo decide un humano si el resto es fuerte.
    resultado = puntaje >= modelo.umbrales.apto ? "REVISAR" : "NO_APTO";
    motivo = `ambiguo:${ambiguos[0]}`;
  } else if (puntaje >= modelo.umbrales.apto) {
    resultado = "APTO";
  } else if (puntaje >= modelo.umbrales.revisar) {
    resultado = "REVISAR"; motivo = "puntaje";
  } else {
    resultado = "NO_APTO"; motivo = "puntaje";
  }

  return { filtros, puntaje, desglose, resultado, motivo };
}
```

- [ ] **Step 4: Correr tests** → 9 passed. Si "REVISAR por banda media" da otro número, revisar la aritmética del test (18+8+8+4+10 = 48) y no el código.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/evaluar.ts src/lib/reclutamiento/evaluar.test.ts
git commit -m "feat(reclutamiento): evaluación pura de filtros, puntaje y resultado

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Rúbrica de actitud con Claude

**Files:**
- Create: `src/lib/reclutamiento/actitud.ts`
- Test: `src/lib/reclutamiento/actitud.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const askClaude = vi.fn();
vi.mock("@/lib/bot/claude", () => ({ askClaude: (...a: unknown[]) => askClaude(...a) }));

import { evaluarActitud, parsearActitud } from "./actitud";

beforeEach(() => askClaude.mockReset());

describe("parsearActitud", () => {
  it("acepta JSON limpio y con fences", () => {
    expect(parsearActitud('{"ejes":{"motivacion":4,"rechazo":3,"ambicion":5,"claridad":4},"razones":["clara"]}'))
      .toEqual({ puntos: 16, razones: ["clara"] });
    expect(parsearActitud('```json\n{"ejes":{"motivacion":1,"rechazo":1,"ambicion":1,"claridad":1},"razones":[]}\n```'))
      .toEqual({ puntos: 4, razones: [] });
  });
  it("recorta ejes fuera de 0-5 y rechaza basura", () => {
    expect(parsearActitud('{"ejes":{"motivacion":9,"rechazo":-2,"ambicion":5,"claridad":5},"razones":[]}')).toEqual({ puntos: 15, razones: [] });
    expect(parsearActitud("no es json")).toBeNull();
    expect(parsearActitud('{"ejes":{}}')).toBeNull();
  });
});

describe("evaluarActitud", () => {
  const respuestas = { actitud_1: "Me gusta vender", actitud_2: "Insistí con otra propuesta", actitud_3: "Cerrar 6 ventas" };
  it("llama a Claude con las tres respuestas y devuelve los puntos", async () => {
    askClaude.mockResolvedValue('{"ejes":{"motivacion":3,"rechazo":4,"ambicion":4,"claridad":3},"razones":["concreto"]}');
    const r = await evaluarActitud(respuestas, "claude-sonnet-5");
    expect(r).toEqual({ puntos: 14, razones: ["concreto"] });
    const args = askClaude.mock.calls[0][0] as { messages: { content: string }[]; model: string };
    expect(args.model).toBe("claude-sonnet-5");
    expect(args.messages[0].content).toContain("Insistí con otra propuesta");
  });
  it("sin respuestas de actitud no llama a Claude y devuelve null", async () => {
    expect(await evaluarActitud({}, "m")).toBeNull();
    expect(askClaude).not.toHaveBeenCalled();
  });
  it("Claude falla o responde basura → null, nunca lanza", async () => {
    askClaude.mockRejectedValueOnce(new Error("timeout"));
    expect(await evaluarActitud(respuestas, "m")).toBeNull();
    askClaude.mockResolvedValueOnce("sin json");
    expect(await evaluarActitud(respuestas, "m")).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Implementar `actitud.ts`**

```ts
// Rúbrica de actitud (spec §4.3): cuatro ejes de 0 a 5 sobre las tres respuestas
// situacionales. Una llamada aparte a Claude, con timeout; cualquier fallo → null y la
// evaluación sigue sin actitud (evaluar.ts lo marca en el desglose).
import { askClaude } from "@/lib/bot/claude";
import { CLAVES_ACTITUD, type Respuestas } from "./respuestas";

export interface Actitud { puntos: number; razones: string[] }

const EJES = ["motivacion", "rechazo", "ambicion", "claridad"] as const;
const TIMEOUT_MS = 6_000;

const SYSTEM =
  "Eres reclutador de asesores inmobiliarios. Evalúa las respuestas de un candidato a tres preguntas " +
  "situacionales con cuatro ejes, cada uno de 0 a 5: motivacion (razones concretas para vender bienes raíces, " +
  "no genéricas), rechazo (qué hizo ante un no: persistencia con criterio, no terquedad), ambicion (meta a 12 meses " +
  "medible y realista), claridad (se expresa con orden y sin rodeos). Responde SOLO JSON: " +
  '{"ejes":{"motivacion":n,"rechazo":n,"ambicion":n,"claridad":n},"razones":["máximo 3 frases cortas en español"]}';

export function parsearActitud(texto: string): Actitud | null {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const j = JSON.parse(limpio) as { ejes?: Record<string, unknown>; razones?: unknown };
    if (!j || typeof j !== "object" || !j.ejes) return null;
    let puntos = 0;
    let vistos = 0;
    for (const eje of EJES) {
      const v = j.ejes[eje];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      vistos++;
      puntos += Math.max(0, Math.min(5, Math.round(v)));
    }
    if (vistos === 0) return null;
    const razones = Array.isArray(j.razones) ? j.razones.filter((r): r is string => typeof r === "string").slice(0, 3) : [];
    return { puntos, razones };
  } catch {
    return null;
  }
}

export async function evaluarActitud(respuestas: Respuestas, model: string): Promise<Actitud | null> {
  const contestadas = CLAVES_ACTITUD.filter((k) => respuestas[k]);
  if (contestadas.length === 0) return null;
  const cuerpo = [
    `1) ¿Por qué quieres vender bienes raíces y no otra cosa?\n${respuestas.actitud_1 ?? "(sin respuesta)"}`,
    `2) La última vez que te dijeron que no, ¿qué hiciste?\n${respuestas.actitud_2 ?? "(sin respuesta)"}`,
    `3) ¿Qué meta te pondrías a 12 meses?\n${respuestas.actitud_3 ?? "(sin respuesta)"}`,
  ].join("\n\n");
  try {
    const texto = await Promise.race([
      askClaude({ system: SYSTEM, messages: [{ role: "user", content: cuerpo }], maxTokens: 300, model }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    return texto ? parsearActitud(texto) : null;
  } catch (err) {
    console.warn("[reclutamiento] rúbrica de actitud falló:", err);
    return null;
  }
}
```

- [ ] **Step 4: Correr tests** → 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/actitud.ts src/lib/reclutamiento/actitud.test.ts
git commit -m "feat(reclutamiento): rúbrica de actitud con Claude

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Transiciones de etapa

**Files:**
- Create: `src/lib/reclutamiento/etapas.ts`
- Test: `src/lib/reclutamiento/etapas.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from "vitest";
import { transicionValidaBot, etapaDeResultado } from "./etapas";

describe("etapas", () => {
  it("el bot solo avanza por el camino previsto", () => {
    expect(transicionValidaBot("NUEVO", "PERFILANDO")).toBe(true);
    expect(transicionValidaBot("PERFILANDO", "APTO")).toBe(true);
    expect(transicionValidaBot("PERFILANDO", "REVISAR")).toBe(true);
    expect(transicionValidaBot("PERFILANDO", "NO_APTO")).toBe(true);
    expect(transicionValidaBot("NUEVO", "APTO")).toBe(false);
    expect(transicionValidaBot("APTO", "NO_APTO")).toBe(false);
    expect(transicionValidaBot("ENTREVISTA", "APTO")).toBe(false);
  });
  it("una etapa humana nunca la toca el bot", () => {
    for (const h of ["ENTREVISTA", "CONTRATADO", "DESCARTADO"] as const) {
      expect(transicionValidaBot(h, "PERFILANDO")).toBe(false);
    }
  });
  it("mapea resultado a etapa", () => {
    expect(etapaDeResultado("APTO")).toBe("APTO");
    expect(etapaDeResultado("REVISAR")).toBe("REVISAR");
    expect(etapaDeResultado("NO_APTO")).toBe("NO_APTO");
  });
});
```

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Implementar**

```ts
// Transiciones de etapa (spec §5.2). El bot avanza solo por su camino; el humano puede mover
// cualquier etapa a cualquiera desde la UI (F2) y eso no pasa por aquí.
import type { RecruitmentStage, RecruitmentVerdict } from "@prisma/client";

const DEL_BOT: Record<RecruitmentStage, RecruitmentStage[]> = {
  NUEVO: ["PERFILANDO"],
  PERFILANDO: ["CV_PENDIENTE", "APTO", "REVISAR", "NO_APTO"],
  CV_PENDIENTE: ["APTO", "REVISAR", "NO_APTO"],
  APTO: [],
  REVISAR: [],
  NO_APTO: [],
  ENTREVISTA: [],
  CONTRATADO: [],
  DESCARTADO: [],
};

export function transicionValidaBot(de: RecruitmentStage, a: RecruitmentStage): boolean {
  return DEL_BOT[de]?.includes(a) ?? false;
}

export function etapaDeResultado(r: RecruitmentVerdict): RecruitmentStage {
  return r;
}

/** Etapas en las que el bot ya dio un veredicto y no vuelve a evaluar solo. */
export const ETAPAS_EVALUADAS: RecruitmentStage[] = ["APTO", "REVISAR", "NO_APTO", "ENTREVISTA", "CONTRATADO", "DESCARTADO"];
```

- [ ] **Step 4: Correr tests** → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/etapas.ts src/lib/reclutamiento/etapas.test.ts
git commit -m "feat(reclutamiento): transiciones de etapa del candidato

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Playbook nuevo de reclutamiento

**Files:**
- Modify: `src/lib/bot/playbook/segment-playbooks.ts` (bloque `agentName: "Agente Reclutamiento"`, líneas ~270-328)
- Modify: `src/lib/bot/playbook/segment-playbooks.test.ts`

- [ ] **Step 1: Test que falla**

Agregar al final de `segment-playbooks.test.ts`:

```ts
describe("Playbook de reclutamiento (spec 2026-11-02)", () => {
  const pb = SEGMENT_PLAYBOOKS.find((p) => p.agentName === "Agente Reclutamiento")!;
  const claves = pb.tasks.map((t) => t.key);

  it("existe y arranca por nombre y plaza", () => {
    expect(pb).toBeTruthy();
    expect(claves.slice(0, 2)).toEqual(["nombre", "plaza"]);
  });

  it("todo lo específico del candidato va a custom.reclutamiento_<clave>", () => {
    for (const t of pb.tasks) {
      if (["firstName", "phone", "email"].includes(t.targetField)) continue;
      expect(t.targetField, t.key).toBe(`custom.reclutamiento_${t.key}`);
    }
  });

  it("tiene los 6 filtros, los 5 puntuables y las 3 de actitud", () => {
    for (const k of ["mayor_edad", "acepta_comision", "disponibilidad", "colchon_meses", "plaza", "movilidad"]) expect(claves).toContain(k);
    for (const k of ["experiencia_inmobiliaria", "cartera_clientes", "experiencia_ventas", "ingles", "prospeccion_digital"]) expect(claves).toContain(k);
    for (const k of ["actitud_1", "actitud_2", "actitud_3"]) expect(claves).toContain(k);
  });

  it("los filtros van antes que los puntuables y la actitud al final", () => {
    const i = (k: string) => claves.indexOf(k);
    expect(i("movilidad")).toBeLessThan(i("experiencia_inmobiliaria"));
    expect(i("prospeccion_digital")).toBeLessThan(i("actitud_1"));
    expect(claves[claves.length - 1]).toBe("actitud_3");
  });

  it("las opciones ENUM coinciden con las claves del modelo default", async () => {
    const { MODELO_DEFAULT } = await import("@/lib/reclutamiento/modelo");
    for (const [clave, f] of Object.entries(MODELO_DEFAULT.filtros)) {
      const t = pb.tasks.find((x) => x.key === clave)!;
      const valores = t.enumOptions!.map((o) => o.value);
      for (const v of [...f.pasa, ...f.ambiguo]) expect(valores, clave).toContain(v);
    }
    for (const [clave, p] of Object.entries(MODELO_DEFAULT.puntuables)) {
      const t = pb.tasks.find((x) => x.key === clave)!;
      const valores = t.enumOptions!.map((o) => o.value);
      for (const v of Object.keys(p.puntos)) expect(valores, clave).toContain(v);
    }
  });

  it("ya no existen las claves viejas puesto/experiencia/ciudad", () => {
    expect(claves).not.toContain("puesto");
    expect(claves).not.toContain("experiencia");
    expect(claves).not.toContain("ciudad");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/bot/playbook/segment-playbooks.test.ts`
Expected: FAIL en "tiene los 6 filtros..." y "ya no existen las claves viejas".

- [ ] **Step 3: Reemplazar el bloque de reclutamiento**

Sustituir el objeto completo `{ agentName: "Agente Reclutamiento", ... }` por:

```ts
  {
    // Spec 2026-11-02 (bot de reclutamiento F1). Todo lo del candidato va a
    // custom.reclutamiento_<clave>; la evaluación (lib/reclutamiento) lo lee de ahí.
    // Orden = bloques del spec §4: básicos → filtros eliminatorios → puntuables → actitud.
    agentName: "Agente Reclutamiento",
    name: "Reclutamiento — perfil de candidato",
    description:
      "Candidatos a asesor inmobiliario en Playa del Carmen o Mérida: datos básicos, filtros (edad, comisión, " +
      "disponibilidad, colchón, plaza, movilidad), experiencia, cartera, inglés, prospección y tres preguntas de actitud. " +
      "Sin presupuesto ni zona de compra. El agente no promete contratación.",
    tasks: [
      { key: "nombre", targetField: "firstName", captureType: "FULL_NAME", objective: "Pide su nombre completo." },
      {
        key: "plaza", targetField: "custom.reclutamiento_plaza", captureType: "ENUM",
        objective: "Pregunta si quiere trabajar en Playa del Carmen o en Mérida; si vive en otra ciudad, pregunta si se mudaría.",
        enumOptions: [
          { value: "PDC", synonyms: ["playa", "playa del carmen", "riviera maya", "solidaridad"] },
          { value: "MERIDA", synonyms: ["mérida", "merida", "yucatán"] },
          { value: "OTRA_CON_MUDANZA", synonyms: ["me mudaría", "puedo mudarme", "me cambio de ciudad"] },
          { value: "OTRA_SIN_MUDANZA", synonyms: ["no me mudaría", "desde mi ciudad", "remoto", "a distancia"] },
        ],
      },
      { key: "telefono", targetField: "phone", captureType: "PHONE", objective: "Pide un teléfono con WhatsApp para coordinar la entrevista." },
      { key: "correo", targetField: "email", captureType: "EMAIL", required: false, objective: "Pide un correo, por si hay que mandarle información." },
      {
        key: "mayor_edad", targetField: "custom.reclutamiento_mayor_edad", captureType: "ENUM",
        objective: "Confirma con naturalidad que es mayor de edad.",
        enumOptions: [{ value: "SI", synonyms: ["sí", "si", "mayor de edad", "tengo 2", "tengo 3", "tengo 4", "tengo 5"] }, { value: "NO", synonyms: ["no", "menor", "tengo 17", "tengo 16"] }],
      },
      {
        key: "acepta_comision", targetField: "custom.reclutamiento_acepta_comision", captureType: "ENUM",
        objective: "Explica que el esquema es 100 % comisión, sin sueldo base, y pregunta si le funciona.",
        enumOptions: [
          { value: "SI", synonyms: ["sí", "si", "me funciona", "sin problema", "ya trabajo así"] },
          { value: "NO", synonyms: ["no", "necesito sueldo", "necesito base", "no me conviene"] },
          { value: "NO_SE", synonyms: ["no sé", "depende", "lo pensaría"] },
        ],
      },
      {
        key: "disponibilidad", targetField: "custom.reclutamiento_disponibilidad", captureType: "ENUM",
        objective: "Pregunta qué disponibilidad tiene: tiempo completo, medio tiempo o solo fines de semana.",
        enumOptions: [
          { value: "TIEMPO_COMPLETO", synonyms: ["tiempo completo", "todo el día", "completa", "full time"] },
          { value: "MEDIO_TIEMPO", synonyms: ["medio tiempo", "medio día", "por las tardes", "por las mañanas", "part time"] },
          { value: "FINES_DE_SEMANA", synonyms: ["fines de semana", "sábados", "solo fines"] },
          { value: "NO_SE", synonyms: ["no sé", "depende", "lo que se necesite"] },
        ],
      },
      {
        key: "colchon_meses", targetField: "custom.reclutamiento_colchon_meses", captureType: "ENUM",
        objective: "Explica que la primera venta suele tardar unos meses y pregunta cuántos meses de gastos tiene cubiertos mientras tanto.",
        extractionHint: "Convierte meses a rango: menos de 3 → MENOS_DE_TRES; 3 a 6 → TRES_A_SEIS; más de 6 → MAS_DE_SEIS.",
        enumOptions: [
          { value: "MENOS_DE_TRES", synonyms: ["1 mes", "2 meses", "menos de tres", "nada", "ninguno", "vivo al día"] },
          { value: "TRES_A_SEIS", synonyms: ["3 meses", "4 meses", "5 meses", "6 meses", "medio año"] },
          { value: "MAS_DE_SEIS", synonyms: ["más de 6", "un año", "varios meses", "tengo ahorros suficientes"] },
          { value: "NO_SE", synonyms: ["no sé", "no lo he calculado"] },
        ],
      },
      {
        key: "movilidad", targetField: "custom.reclutamiento_movilidad", captureType: "ENUM",
        objective: "Pregunta si tiene vehículo propio y disposición para moverse por la zona a mostrar propiedades.",
        enumOptions: [
          { value: "SI", synonyms: ["sí", "tengo coche", "tengo carro", "tengo auto", "tengo moto y puedo moverme"] },
          { value: "SOLO_DISPOSICION", synonyms: ["no tengo coche pero", "en transporte", "puedo moverme sin auto", "uber"] },
          { value: "NO", synonyms: ["no", "no tengo", "no puedo moverme"] },
        ],
      },
      {
        key: "experiencia_inmobiliaria", targetField: "custom.reclutamiento_experiencia_inmobiliaria", captureType: "ENUM",
        objective: "Pregunta cuánta experiencia tiene en bienes raíces. Sin experiencia es válido: no lo trates como problema.",
        enumOptions: [
          { value: "SIN_EXPERIENCIA", synonyms: ["ninguna", "sin experiencia", "primera vez", "nada"] },
          { value: "MENOS_1_ANO", synonyms: ["menos de un año", "unos meses", "recién empecé"] },
          { value: "DE_1_A_3_ANOS", synonyms: ["1 a 3 años", "dos años", "un par de años"] },
          { value: "MAS_DE_3_ANOS", synonyms: ["más de 3 años", "varios años", "muchos años"] },
        ],
      },
      {
        key: "cartera_clientes", targetField: "custom.reclutamiento_cartera_clientes", captureType: "ENUM",
        objective: "Pregunta si ya tiene cartera de clientes o contactos interesados en comprar, y de qué tamaño.",
        enumOptions: [
          { value: "NO", synonyms: ["no", "ninguna", "empezaría de cero"] },
          { value: "MENOS_10", synonyms: ["pocos", "algunos", "menos de 10", "cinco", "unos cuantos"] },
          { value: "DE_10_A_50", synonyms: ["10 a 50", "veinte", "treinta", "una base mediana"] },
          { value: "MAS_50_O_INVERSIONISTAS", synonyms: ["más de 50", "muchos", "inversionistas", "cartera grande", "base amplia"] },
        ],
      },
      {
        key: "experiencia_ventas", targetField: "custom.reclutamiento_experiencia_ventas", captureType: "ENUM",
        objective: "Pregunta si ha vendido algo antes y qué (autos, seguros, servicios, retail…).",
        enumOptions: [
          { value: "NINGUNA", synonyms: ["no", "nunca he vendido", "ninguna"] },
          { value: "OTRO_GIRO", synonyms: ["retail", "tienda", "mostrador", "telemarketing", "ventas en general"] },
          { value: "CONSULTIVA_ALTO_VALOR", synonyms: ["autos", "seguros", "créditos", "b2b", "servicios financieros", "ventas consultivas", "tiempo compartido"] },
        ],
      },
      {
        key: "ingles", targetField: "custom.reclutamiento_ingles", captureType: "ENUM",
        objective: "Pregunta su nivel de inglés.",
        enumOptions: [
          { value: "NO", synonyms: ["no", "nada", "muy poco"] },
          { value: "BASICO", synonyms: ["básico", "basico", "me defiendo", "intermedio bajo"] },
          { value: "CONVERSACIONAL", synonyms: ["conversacional", "fluido", "avanzado", "bilingüe", "intermedio alto"] },
        ],
      },
      {
        key: "prospeccion_digital", targetField: "custom.reclutamiento_prospeccion_digital", captureType: "ENUM",
        objective: "Pregunta si usa redes sociales para prospectar o publicar contenido.",
        enumOptions: [
          { value: "SI", synonyms: ["sí", "si", "instagram", "tiktok", "facebook", "publico contenido", "tengo seguidores"] },
          { value: "NO", synonyms: ["no", "casi no", "solo personal"] },
        ],
      },
      {
        key: "actitud_1", targetField: "custom.reclutamiento_actitud_1", captureType: "TEXT",
        objective: "Pregunta por qué quiere vender bienes raíces y no otra cosa.",
        extractionHint: "Guarda su respuesta completa tal cual, en una o dos frases.",
      },
      {
        key: "actitud_2", targetField: "custom.reclutamiento_actitud_2", captureType: "TEXT",
        objective: "Pídele que cuente la última vez que le dijeron que no y qué hizo.",
        extractionHint: "Guarda su respuesta completa tal cual.",
      },
      {
        key: "actitud_3", targetField: "custom.reclutamiento_actitud_3", captureType: "TEXT",
        objective: "Pregunta qué meta se pondría a 12 meses dentro del equipo.",
        extractionHint: "Guarda su respuesta completa tal cual.",
      },
    ],
  },
```

- [ ] **Step 4: Correr tests**

Run: `npx vitest run src/lib/bot/playbook/segment-playbooks.test.ts`
Expected: todos pasan, incluidos los que validan `targetField` contra la whitelist (`custom.*` siempre pasa).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/playbook/segment-playbooks.ts src/lib/bot/playbook/segment-playbooks.test.ts
git commit -m "feat(reclutamiento): playbook nuevo con filtros, puntuables y actitud

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Candidato en BD (asegurar, persistir, resumen)

**Files:**
- Create: `src/lib/reclutamiento/candidato.ts`
- Test: `src/lib/reclutamiento/candidato.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn();
const update = vi.fn();
const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { recruitmentCandidate: {
    upsert: (...a: unknown[]) => upsert(...a),
    update: (...a: unknown[]) => update(...a),
    findUnique: (...a: unknown[]) => findUnique(...a),
  } },
}));
const askClaude = vi.fn();
vi.mock("@/lib/bot/claude", () => ({ askClaude: (...a: unknown[]) => askClaude(...a) }));

import { asegurarCandidato, persistirEvaluacion, plazaDeRespuesta } from "./candidato";

beforeEach(() => { upsert.mockReset(); update.mockReset(); findUnique.mockReset(); askClaude.mockReset(); });

describe("asegurarCandidato", () => {
  it("crea la fila en NUEVO si no existe y no toca la existente", async () => {
    upsert.mockResolvedValue({ id: "c1", etapa: "NUEVO" });
    const r = await asegurarCandidato({ contactId: "k1", canal: "INSTAGRAM" });
    expect(r).toEqual({ id: "c1", etapa: "NUEVO" });
    const args = upsert.mock.calls[0][0] as { where: unknown; create: Record<string, unknown>; update: unknown };
    expect(args.where).toEqual({ contactId: "k1" });
    expect(args.create).toMatchObject({ contactId: "k1", canal: "INSTAGRAM", etapa: "NUEVO" });
    expect(args.update).toEqual({});
  });
  it("tabla sin migrar (P2021) → null sin lanzar", async () => {
    upsert.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    expect(await asegurarCandidato({ contactId: "k1", canal: "WHATSAPP" })).toBeNull();
  });
});

describe("plazaDeRespuesta", () => {
  it("PDC y MERIDA se mapean; otra → null", () => {
    expect(plazaDeRespuesta("PDC")).toBe("PDC");
    expect(plazaDeRespuesta("MERIDA")).toBe("MERIDA");
    expect(plazaDeRespuesta("OTRA_CON_MUDANZA")).toBeNull();
    expect(plazaDeRespuesta(undefined)).toBeNull();
  });
});

describe("persistirEvaluacion", () => {
  it("escribe respuestas, filtros, puntaje, resultado, etapa, plaza y resumen", async () => {
    askClaude.mockResolvedValue("Candidata con 4 años en bienes raíces y cartera mediana.");
    update.mockResolvedValue({});
    await persistirEvaluacion({
      candidatoId: "c1",
      respuestas: { plaza: "MERIDA", experiencia_inmobiliaria: "MAS_DE_3_ANOS" },
      evaluacion: { filtros: { plaza: "PASA" } as never, puntaje: 70, desglose: { actitud: 10 }, resultado: "APTO", motivo: null },
      razonesActitud: ["concreta"],
      model: "m",
    });
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ puntaje: 70, resultado: "APTO", etapa: "APTO", plaza: "MERIDA", motivo: null });
    expect(data.respuestas).toEqual({ plaza: "MERIDA", experiencia_inmobiliaria: "MAS_DE_3_ANOS" });
    expect(data.desglose).toEqual({ actitud: 10, actitud_razones: ["concreta"] });
    expect(data.resumenIA).toContain("4 años");
    expect(data.evaluadoAt).toBeInstanceOf(Date);
  });
  it("si el resumen falla, igual persiste con resumen null", async () => {
    askClaude.mockRejectedValue(new Error("x"));
    update.mockResolvedValue({});
    await persistirEvaluacion({ candidatoId: "c1", respuestas: {}, evaluacion: { filtros: {} as never, puntaje: 0, desglose: {}, resultado: "NO_APTO", motivo: "puntaje" }, razonesActitud: [], model: "m" });
    expect((update.mock.calls[0][0] as { data: { resumenIA: unknown } }).data.resumenIA).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Implementar `candidato.ts`**

```ts
// Persistencia del candidato en recruitment_candidates. Best-effort en lectura/alta
// (tabla sin migrar → null); la evaluación sí propaga errores para que el hook los loguee.
import type { ConversationChannel, Plaza, Prisma, RecruitmentCandidate } from "@prisma/client";
import prisma from "@/lib/db";
import { askClaude } from "@/lib/bot/claude";
import type { Evaluacion } from "./evaluar";
import { etapaDeResultado } from "./etapas";
import type { Respuestas } from "./respuestas";

const SIN_TABLA = new Set(["P2021", "P2022"]);

export async function asegurarCandidato(input: { contactId: string; canal: ConversationChannel }): Promise<RecruitmentCandidate | null> {
  try {
    return await prisma.recruitmentCandidate.upsert({
      where: { contactId: input.contactId },
      create: { contactId: input.contactId, canal: input.canal, etapa: "NUEVO" },
      update: {},
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code && SIN_TABLA.has(code)) {
      console.error("[reclutamiento] tabla recruitment_candidates sin migrar; el bot sigue sin evaluar");
      return null;
    }
    console.error("[reclutamiento] asegurarCandidato falló:", err);
    return null;
  }
}

export async function leerCandidato(contactId: string): Promise<RecruitmentCandidate | null> {
  try {
    return await prisma.recruitmentCandidate.findUnique({ where: { contactId } });
  } catch {
    return null;
  }
}

export function plazaDeRespuesta(v: string | undefined): Plaza | null {
  return v === "PDC" || v === "MERIDA" ? v : null;
}

async function resumenIA(respuestas: Respuestas, ev: Evaluacion, model: string): Promise<string | null> {
  try {
    const texto = await askClaude({
      system:
        "Resume en 2 o 3 líneas, en español y para un gerente de ventas, el perfil de este candidato a asesor inmobiliario: " +
        "experiencia, cartera, disponibilidad, plaza y lo que más pesa a favor o en contra. Sin saludos ni viñetas.",
      messages: [{ role: "user", content: `Respuestas: ${JSON.stringify(respuestas)}\nResultado: ${ev.resultado} (${ev.puntaje}/100, motivo ${ev.motivo ?? "ninguno"})` }],
      maxTokens: 200,
      model,
    });
    return texto?.trim() || null;
  } catch {
    return null;
  }
}

export async function persistirEvaluacion(input: {
  candidatoId: string;
  respuestas: Respuestas;
  evaluacion: Evaluacion;
  razonesActitud: string[];
  model: string;
}): Promise<void> {
  const { candidatoId, respuestas, evaluacion: ev } = input;
  const resumen = await resumenIA(respuestas, ev, input.model);
  await prisma.recruitmentCandidate.update({
    where: { id: candidatoId },
    data: {
      respuestas: respuestas as Prisma.InputJsonValue,
      filtros: ev.filtros as Prisma.InputJsonValue,
      puntaje: ev.puntaje,
      desglose: { ...ev.desglose, actitud_razones: input.razonesActitud } as Prisma.InputJsonValue,
      resultado: ev.resultado,
      motivo: ev.motivo,
      etapa: etapaDeResultado(ev.resultado),
      plaza: plazaDeRespuesta(respuestas.plaza),
      resumenIA: resumen,
      evaluadoAt: new Date(),
    },
  });
}

export async function marcarPerfilando(candidatoId: string): Promise<void> {
  try {
    await prisma.recruitmentCandidate.update({ where: { id: candidatoId }, data: { etapa: "PERFILANDO" } });
  } catch (err) {
    console.warn("[reclutamiento] no se pudo marcar PERFILANDO:", err);
  }
}

export async function guardarHorario(candidatoId: string, horario: string): Promise<void> {
  try {
    await prisma.recruitmentCandidate.update({ where: { id: candidatoId }, data: { horarioEntrevista: horario.slice(0, 200) } });
  } catch (err) {
    console.warn("[reclutamiento] no se pudo guardar el horario:", err);
  }
}
```

- [ ] **Step 4: Correr tests** → 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/candidato.ts src/lib/reclutamiento/candidato.test.ts
git commit -m "feat(reclutamiento): persistencia del candidato y resumen IA

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Avisos, tarea y eventos

**Files:**
- Modify: `src/lib/workflows/events.ts` (unión `DomainEventType`)
- Create: `src/lib/reclutamiento/avisos.ts`
- Test: `src/lib/reclutamiento/avisos.test.ts`

- [ ] **Step 1: Agregar tipos de evento**

En `src/lib/workflows/events.ts`, dentro de `DomainEventType`, después de `| "sla.breach"` agregar:

```ts
  // Bot de reclutamiento (spec 2026-11-02 §7): el candidato terminó el perfilado.
  | "recruitment.apto"
  | "recruitment.revisar"
  | "recruitment.no_apto"
```

- [ ] **Step 2: Test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const activityCreate = vi.fn();
const notifCreateMany = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { createMany: (...a: unknown[]) => notifCreateMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));
const emitEvent = vi.fn();
vi.mock("@/lib/workflows/events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));
const gerenciaDeLaPlaza = vi.fn();
vi.mock("@/lib/workflows/gerencia", () => ({ gerenciaDeLaPlaza: (...a: unknown[]) => gerenciaDeLaPlaza(...a) }));
vi.mock("@/lib/workflows/ruteables", () => ({ usuarioRuteableWhere: () => ({ isActive: true }) }));

import { responsablesDe, avisarResultado } from "./avisos";

beforeEach(() => { activityCreate.mockReset(); notifCreateMany.mockReset(); userFindMany.mockReset(); emitEvent.mockReset(); gerenciaDeLaPlaza.mockReset(); });

describe("responsablesDe", () => {
  it("usa la configuración de la plaza si existe", async () => {
    expect(await responsablesDe("PDC", { PDC: ["u1", "u2"] })).toEqual(["u1", "u2"]);
    expect(gerenciaDeLaPlaza).not.toHaveBeenCalled();
  });
  it("sin configuración: gerencia de la plaza", async () => {
    gerenciaDeLaPlaza.mockResolvedValue(["g1"]);
    expect(await responsablesDe("MERIDA", {})).toEqual(["g1"]);
  });
  it("sin gerencia: default configurado; sin default: ADMIN personas", async () => {
    gerenciaDeLaPlaza.mockResolvedValue([]);
    expect(await responsablesDe("MERIDA", { default: ["d1"] })).toEqual(["d1"]);
    userFindMany.mockResolvedValue([{ id: "a1" }]);
    expect(await responsablesDe(null, {})).toEqual(["a1"]);
    expect((userFindMany.mock.calls[0][0] as { where: { role: string } }).where.role).toBe("ADMIN");
  });
});

describe("avisarResultado", () => {
  const base = { candidatoId: "c1", contactId: "k1", conversationId: "v1", nombre: "Ana López", plaza: "PDC" as const, puntaje: 72, responsables: ["u1", "u2"] };
  it("APTO: tarea al primer responsable, aviso a todos, evento", async () => {
    activityCreate.mockResolvedValue({ id: "t1" });
    await avisarResultado({ ...base, resultado: "APTO" });
    const t = (activityCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(t).toMatchObject({ userId: "u1", contactId: "k1", activityType: "TASK", status: "PENDIENTE" });
    expect(t.subject).toBe("Entrevistar candidato Ana López — PDC");
    expect(t.dueDate).toBeInstanceOf(Date);
    const n = (notifCreateMany.mock.calls[0][0] as { data: { userId: string; link: string; type: string }[] }).data;
    expect(n.map((x) => x.userId)).toEqual(["u1", "u2"]);
    expect(n[0].link).toBe("/inbox?c=v1");
    expect(n[0].type).toBe("recruitment_apto");
    expect(emitEvent).toHaveBeenCalledWith("recruitment.apto", "contact", "k1", expect.objectContaining({ candidatoId: "c1", puntaje: 72 }));
  });
  it("REVISAR: aviso sin tarea", async () => {
    await avisarResultado({ ...base, resultado: "REVISAR" });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notifCreateMany).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith("recruitment.revisar", "contact", "k1", expect.anything());
  });
  it("NO_APTO: solo evento", async () => {
    await avisarResultado({ ...base, resultado: "NO_APTO" });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notifCreateMany).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith("recruitment.no_apto", "contact", "k1", expect.anything());
  });
  it("sin responsables no crea tarea ni aviso pero sí evento, y nunca lanza", async () => {
    await avisarResultado({ ...base, resultado: "APTO", responsables: [] });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Correr y ver que falla** → FAIL.

- [ ] **Step 4: Implementar `avisos.ts`**

```ts
// Qué pasa al fijar el resultado (spec §7). Nunca lanza: perder un aviso es malo, romper la
// respuesta del bot es peor.
import type { Plaza, RecruitmentVerdict } from "@prisma/client";
import prisma from "@/lib/db";
import { emitEvent } from "@/lib/workflows/events";
import { gerenciaDeLaPlaza } from "@/lib/workflows/gerencia";
import { usuarioRuteableWhere } from "@/lib/workflows/ruteables";
import type { ResponsablesReclutamiento } from "./modelo";

const DOS_DIAS_HABILES_MS = 2 * 24 * 60 * 60 * 1000;

/** Orden: configuración de la plaza → gerencia de la plaza → default configurado → ADMIN personas. */
export async function responsablesDe(plaza: Plaza | null, cfg: ResponsablesReclutamiento): Promise<string[]> {
  if (plaza && cfg[plaza]?.length) return cfg[plaza]!;
  if (plaza) {
    const gerencia = await gerenciaDeLaPlaza(plaza).catch(() => [] as string[]);
    if (gerencia.length > 0) return gerencia;
  }
  if (cfg.default?.length) return cfg.default;
  try {
    const admins = await prisma.user.findMany({ where: { ...usuarioRuteableWhere(), role: "ADMIN" }, select: { id: true } });
    return admins.map((a) => a.id);
  } catch {
    return [];
  }
}

export async function avisarResultado(input: {
  candidatoId: string;
  contactId: string;
  conversationId: string;
  nombre: string;
  plaza: Plaza | null;
  puntaje: number;
  resultado: RecruitmentVerdict;
  responsables: string[];
}): Promise<void> {
  const { resultado, responsables } = input;
  const link = `/inbox?c=${input.conversationId}`;
  const plazaTxt = input.plaza ?? "sin plaza";
  try {
    if (resultado === "APTO" && responsables.length > 0) {
      await prisma.activity.create({
        data: {
          userId: responsables[0],
          contactId: input.contactId,
          activityType: "TASK",
          subject: `Entrevistar candidato ${input.nombre} — ${plazaTxt}`.slice(0, 200),
          description: `El bot evaluó al candidato como APTO (${input.puntaje}/100). Conversación: ${link}`,
          dueDate: new Date(Date.now() + DOS_DIAS_HABILES_MS),
          status: "PENDIENTE",
        },
      });
    }
    if ((resultado === "APTO" || resultado === "REVISAR") && responsables.length > 0) {
      const titulo = resultado === "APTO" ? "Candidato apto para entrevista" : "Candidato por revisar";
      await prisma.notification.createMany({
        data: responsables.map((userId) => ({
          userId,
          title: titulo,
          message: `${input.nombre} (${plazaTxt}) — ${input.puntaje}/100`,
          type: resultado === "APTO" ? "recruitment_apto" : "recruitment_revisar",
          link,
        })),
      });
    }
  } catch (err) {
    console.error("[reclutamiento] aviso del resultado falló:", err);
  }
  try {
    const tipo = resultado === "APTO" ? "recruitment.apto" : resultado === "REVISAR" ? "recruitment.revisar" : "recruitment.no_apto";
    await emitEvent(tipo, "contact", input.contactId, {
      candidatoId: input.candidatoId,
      puntaje: input.puntaje,
      plaza: input.plaza,
      conversationId: input.conversationId,
    });
  } catch (err) {
    console.error("[reclutamiento] emitEvent del resultado falló:", err);
  }
}
```

- [ ] **Step 5: Correr tests** → 7 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/events.ts src/lib/reclutamiento/avisos.ts src/lib/reclutamiento/avisos.test.ts
git commit -m "feat(reclutamiento): tarea, avisos y eventos según el resultado

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Ligar el CV desde un mensaje con adjunto

**Files:**
- Create: `src/lib/reclutamiento/cv.ts`
- Test: `src/lib/reclutamiento/cv.test.ts`
- Modify: `src/lib/messaging/core.ts` (después del `prisma.message.create` INBOUND, ~línea 557)

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { recruitmentCandidate: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) } },
}));

import { esMimeDeCv, ligarCv } from "./cv";

beforeEach(() => { findUnique.mockReset(); update.mockReset(); });

describe("esMimeDeCv", () => {
  it("acepta PDF, imagen y Word; rechaza audio y video", () => {
    expect(esMimeDeCv("application/pdf")).toBe(true);
    expect(esMimeDeCv("image/jpeg")).toBe(true);
    expect(esMimeDeCv("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(esMimeDeCv("application/msword")).toBe(true);
    expect(esMimeDeCv("audio/ogg")).toBe(false);
    expect(esMimeDeCv("video/mp4")).toBe(false);
    expect(esMimeDeCv(null)).toBe(false);
  });
});

describe("ligarCv", () => {
  const msg = { id: "m1", contactId: "k1", mediaUrl: "chat-media/x.pdf", mediaMimeType: "application/pdf", mediaFilename: "cv.pdf" };
  it("liga el primer adjunto válido al candidato sin CV", async () => {
    findUnique.mockResolvedValue({ id: "c1", cvUrl: null });
    update.mockResolvedValue({});
    expect(await ligarCv(msg)).toBe(true);
    expect((update.mock.calls[0][0] as { data: Record<string, unknown> }).data).toEqual({
      cvUrl: "chat-media/x.pdf", cvMime: "application/pdf", cvFilename: "cv.pdf", cvMessageId: "m1",
    });
  });
  it("no pisa un CV ya ligado", async () => {
    findUnique.mockResolvedValue({ id: "c1", cvUrl: "ya" });
    expect(await ligarCv(msg)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it("sin candidato, sin media o mime no válido → false", async () => {
    findUnique.mockResolvedValue(null);
    expect(await ligarCv(msg)).toBe(false);
    findUnique.mockResolvedValue({ id: "c1", cvUrl: null });
    expect(await ligarCv({ ...msg, mediaUrl: null })).toBe(false);
    expect(await ligarCv({ ...msg, mediaMimeType: "audio/ogg" })).toBe(false);
  });
  it("tabla sin migrar → false sin lanzar", async () => {
    findUnique.mockRejectedValue(Object.assign(new Error(), { code: "P2021" }));
    expect(await ligarCv(msg)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Implementar `cv.ts`**

```ts
// Ligar un adjunto entrante como CV del candidato (spec §6). Se llama desde la ingesta
// (messaging/core.ts) tras guardar el mensaje. Solo el primero; el humano puede cambiarlo en F2.
import prisma from "@/lib/db";

const MIMES_CV = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function esMimeDeCv(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return MIMES_CV.has(mime) || mime.startsWith("image/");
}

export async function ligarCv(msg: {
  id: string;
  contactId: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
}): Promise<boolean> {
  if (!msg.mediaUrl || !esMimeDeCv(msg.mediaMimeType)) return false;
  try {
    const cand = await prisma.recruitmentCandidate.findUnique({ where: { contactId: msg.contactId } });
    if (!cand || cand.cvUrl) return false;
    await prisma.recruitmentCandidate.update({
      where: { id: cand.id },
      data: { cvUrl: msg.mediaUrl, cvMime: msg.mediaMimeType, cvFilename: msg.mediaFilename, cvMessageId: msg.id },
    });
    return true;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2021" && code !== "P2022") console.warn("[reclutamiento] ligarCv falló:", err);
    return false;
  }
}
```

- [ ] **Step 4: Correr tests** → 6 passed.

- [ ] **Step 5: Llamar desde `core.ts`**

En `src/lib/messaging/core.ts`, inmediatamente después del bloque `try { message = await prisma.message.create({...}) } catch ... }` del inbound (termina ~línea 557 con `throw err; }`), agregar:

```ts
  // Bot de reclutamiento (spec 2026-11-02 §6): si el contacto es candidato y mandó un archivo,
  // se liga como su CV. Best-effort: sin candidato o sin tabla no hace nada.
  if (message?.mediaUrl) {
    try {
      const { ligarCv } = await import("@/lib/reclutamiento/cv");
      await ligarCv({
        id: message.id,
        contactId: message.contactId,
        mediaUrl: message.mediaUrl,
        mediaMimeType: message.mediaMimeType,
        mediaFilename: message.mediaFilename,
      });
    } catch (err) {
      console.warn(`[messaging] ligarCv falló (${message.id}):`, err);
    }
  }
```

- [ ] **Step 6: Verificar que los tests de core siguen verdes**

Run: `npx vitest run src/lib/messaging/core.test.ts`
Expected: todos pasan (el import dinámico se resuelve y `recruitmentCandidate` no está en su mock → `findUnique` es undefined → cae al catch → false). Si algún test del mock de `@/lib/db` falla por `recruitmentCandidate` indefinido, agregar al mock de ese test `recruitmentCandidate: { findUnique: vi.fn(async () => null) }`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reclutamiento/cv.ts src/lib/reclutamiento/cv.test.ts src/lib/messaging/core.ts
git commit -m "feat(reclutamiento): ligar adjuntos entrantes como CV del candidato

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Hook del bot (evaluar al terminar, cierre, horario)

**Files:**
- Create: `src/lib/reclutamiento/hook.ts`
- Test: `src/lib/reclutamiento/hook.test.ts`

El hook es lo que `bot-respond.ts` llama cuando el agente resuelto es el de reclutamiento. Recibe el resultado de `runPlaybookStep` y devuelve el objetivo de cierre si corresponde.

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const asegurarCandidato = vi.fn();
const marcarPerfilando = vi.fn();
const persistirEvaluacion = vi.fn();
const guardarHorario = vi.fn();
vi.mock("./candidato", () => ({
  asegurarCandidato: (...a: unknown[]) => asegurarCandidato(...a),
  marcarPerfilando: (...a: unknown[]) => marcarPerfilando(...a),
  persistirEvaluacion: (...a: unknown[]) => persistirEvaluacion(...a),
  guardarHorario: (...a: unknown[]) => guardarHorario(...a),
  plazaDeRespuesta: (v: string | undefined) => (v === "PDC" || v === "MERIDA" ? v : null),
}));
const evaluarActitud = vi.fn();
vi.mock("./actitud", () => ({ evaluarActitud: (...a: unknown[]) => evaluarActitud(...a) }));
const cargarConfigReclutamiento = vi.fn();
vi.mock("./modelo", async (orig) => {
  const actual = await orig<typeof import("./modelo")>();
  return { ...actual, cargarConfigReclutamiento: (...a: unknown[]) => cargarConfigReclutamiento(...a) };
});
const responsablesDe = vi.fn();
const avisarResultado = vi.fn();
vi.mock("./avisos", () => ({ responsablesDe: (...a: unknown[]) => responsablesDe(...a), avisarResultado: (...a: unknown[]) => avisarResultado(...a) }));
const extractFields = vi.fn();
vi.mock("@/lib/bot/playbook/extract", () => ({ extractFields: (...a: unknown[]) => extractFields(...a) }));

import { hookReclutamiento, esAgenteReclutamiento, OBJETIVOS_CIERRE } from "./hook";
import { MODELO_DEFAULT, FICHA_DEFAULT } from "./modelo";

const contactoApto = {
  id: "k1", firstName: "Ana", lastName: "López",
  custom: {
    reclutamiento_plaza: "PDC", reclutamiento_mayor_edad: "SI", reclutamiento_acepta_comision: "SI",
    reclutamiento_disponibilidad: "TIEMPO_COMPLETO", reclutamiento_colchon_meses: "TRES_A_SEIS", reclutamiento_movilidad: "SI",
    reclutamiento_experiencia_inmobiliaria: "MAS_DE_3_ANOS", reclutamiento_cartera_clientes: "DE_10_A_50",
    reclutamiento_experiencia_ventas: "CONSULTIVA_ALTO_VALOR", reclutamiento_ingles: "CONVERSACIONAL",
    reclutamiento_prospeccion_digital: "SI", reclutamiento_actitud_1: "a", reclutamiento_actitud_2: "b", reclutamiento_actitud_3: "c",
  },
};

beforeEach(() => {
  [asegurarCandidato, marcarPerfilando, persistirEvaluacion, guardarHorario, evaluarActitud, cargarConfigReclutamiento, responsablesDe, avisarResultado, extractFields].forEach((f) => f.mockReset());
  cargarConfigReclutamiento.mockResolvedValue({ modelo: MODELO_DEFAULT, ficha: FICHA_DEFAULT, responsables: {} });
  responsablesDe.mockResolvedValue(["u1"]);
});

describe("esAgenteReclutamiento", () => {
  it("por nombre del agente", () => {
    expect(esAgenteReclutamiento({ name: "Agente Reclutamiento" })).toBe(true);
    expect(esAgenteReclutamiento({ name: "Agente Brokers" })).toBe(false);
    expect(esAgenteReclutamiento(null)).toBe(false);
  });
});

describe("hookReclutamiento", () => {
  const base = { conversationId: "v1", channel: "INSTAGRAM" as const, model: "m", messages: [{ role: "user" as const, content: "hola" }] };

  it("sin tabla (candidato null) → no hace nada y devuelve undefined", async () => {
    asegurarCandidato.mockResolvedValue(null);
    expect(await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "IN_PROGRESS" } })).toEqual({});
  });

  it("en curso: marca PERFILANDO la primera vez y añade la ficha de la vacante al contexto", async () => {
    asegurarCandidato.mockResolvedValue({ id: "c1", etapa: "NUEVO", cvUrl: null, horarioEntrevista: null });
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "IN_PROGRESS" } });
    expect(marcarPerfilando).toHaveBeenCalledWith("c1");
    expect(r.contexto).toContain("Esquema 100 % comisión");
    expect(r.objetivo).toBeUndefined();
  });

  it("al completar: evalúa, persiste, avisa y devuelve el cierre APTO pidiendo CV y horario", async () => {
    asegurarCandidato.mockResolvedValue({ id: "c1", etapa: "PERFILANDO", cvUrl: null, horarioEntrevista: null });
    evaluarActitud.mockResolvedValue({ puntos: 16, razones: ["clara"] });
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(persistirEvaluacion).toHaveBeenCalledWith(expect.objectContaining({ candidatoId: "c1", razonesActitud: ["clara"] }));
    const ev = (persistirEvaluacion.mock.calls[0][0] as { evaluacion: { resultado: string; puntaje: number } }).evaluacion;
    expect(ev.resultado).toBe("APTO");
    expect(ev.puntaje).toBe(85); // 25+14+15+10+5 + 16
    expect(avisarResultado).toHaveBeenCalledWith(expect.objectContaining({ resultado: "APTO", plaza: "PDC", nombre: "Ana López", responsables: ["u1"] }));
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_SIN_CV);
  });

  it("al completar con CV ya recibido: suma puntos de CV y no lo pide", async () => {
    asegurarCandidato.mockResolvedValue({ id: "c1", etapa: "PERFILANDO", cvUrl: "x.pdf", horarioEntrevista: null });
    evaluarActitud.mockResolvedValue(null);
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    const ev = (persistirEvaluacion.mock.calls[0][0] as { evaluacion: { puntaje: number } }).evaluacion;
    expect(ev.puntaje).toBe(74); // 69 + 5
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_CON_CV);
  });

  it("NO_APTO: cierre amable sin pedir nada", async () => {
    asegurarCandidato.mockResolvedValue({ id: "c1", etapa: "PERFILANDO", cvUrl: null, horarioEntrevista: null });
    evaluarActitud.mockResolvedValue(null);
    const contacto = { ...contactoApto, custom: { ...contactoApto.custom, reclutamiento_movilidad: "NO" } };
    const r = await hookReclutamiento({ ...base, contact: contacto, playbook: { status: "COMPLETED" } });
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.NO_APTO);
    expect(avisarResultado).toHaveBeenCalledWith(expect.objectContaining({ resultado: "NO_APTO" }));
  });

  it("ya evaluado (APTO) sin horario: extrae el horario del último mensaje y lo guarda", async () => {
    asegurarCandidato.mockResolvedValue({ id: "c1", etapa: "APTO", cvUrl: "x.pdf", horarioEntrevista: null });
    extractFields.mockResolvedValue({ horario_entrevista: "martes por la tarde" });
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" }, messages: [{ role: "user", content: "martes por la tarde" }] });
    expect(persistirEvaluacion).not.toHaveBeenCalled();
    expect(guardarHorario).toHaveBeenCalledWith("c1", "martes por la tarde");
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.APTO_HORARIO_GUARDADO);
  });

  it("ya evaluado y con horario: solo mantiene el cierre, no re-evalúa", async () => {
    asegurarCandidato.mockResolvedValue({ id: "c1", etapa: "REVISAR", cvUrl: null, horarioEntrevista: null });
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(persistirEvaluacion).not.toHaveBeenCalled();
    expect(r.objetivo).toBe(OBJETIVOS_CIERRE.REVISAR_SIN_CV);
  });

  it("si la evaluación revienta, no lanza y devuelve {}", async () => {
    asegurarCandidato.mockResolvedValue({ id: "c1", etapa: "PERFILANDO", cvUrl: null, horarioEntrevista: null });
    evaluarActitud.mockResolvedValue(null);
    persistirEvaluacion.mockRejectedValue(new Error("db"));
    const r = await hookReclutamiento({ ...base, contact: contactoApto, playbook: { status: "COMPLETED" } });
    expect(r).toEqual({});
  });
});
```

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Implementar `hook.ts`**

```ts
// Punto de enganche del bot con el reclutamiento (spec §4.5, §5.2, §7). Lo llama botRespond
// cuando el agente resuelto es «Agente Reclutamiento». Devuelve, opcionalmente, un objetivo
// de cierre que reemplaza al del playbook y un contexto (la ficha de la vacante). Nunca lanza.
import type { ConversationChannel, PlaybookRunStatus, RecruitmentCandidate } from "@prisma/client";
import type { BotMessage } from "@/lib/bot/claude";
import { extractFields } from "@/lib/bot/playbook/extract";
import { evaluarActitud } from "./actitud";
import { asegurarCandidato, guardarHorario, marcarPerfilando, persistirEvaluacion, plazaDeRespuesta } from "./candidato";
import { ETAPAS_EVALUADAS, etapaDeResultado } from "./etapas";
import { evaluar } from "./evaluar";
import { cargarConfigReclutamiento } from "./modelo";
import { leerRespuestas } from "./respuestas";
import { avisarResultado, responsablesDe } from "./avisos";

export const NOMBRE_AGENTE_RECLUTAMIENTO = "Agente Reclutamiento";

export function esAgenteReclutamiento(agente: { name: string } | null | undefined): boolean {
  return agente?.name === NOMBRE_AGENTE_RECLUTAMIENTO;
}

export const OBJETIVOS_CIERRE = {
  APTO_SIN_CV:
    "El candidato quedó APTO. Felicítalo en una línea y dile por qué encaja (sin números ni criterios). " +
    "Pídele su CV (PDF, foto o Word, aquí mismo) y pregúntale qué días y horario le acomodan para una entrevista con el gerente de la plaza. Dile que el gerente lo contacta.",
  APTO_CON_CV:
    "El candidato quedó APTO y ya mandó su CV. Felicítalo en una línea, agradece el CV y pregúntale qué días y horario le acomodan para una entrevista con el gerente de la plaza. Dile que el gerente lo contacta.",
  APTO_HORARIO_GUARDADO:
    "Ya tienes su horario preferido. Confírmalo en una línea, dile que el gerente de la plaza lo contacta para fijar la entrevista y despídete con calidez. Si pregunta algo más, responde breve.",
  REVISAR_SIN_CV:
    "El equipo va a revisar su perfil. Agradécele, pídele su CV (PDF, foto o Word, aquí mismo) y dile que lo contactan en dos días hábiles. No prometas entrevista.",
  REVISAR_CON_CV:
    "El equipo va a revisar su perfil. Agradécele el CV y dile que lo contactan en dos días hábiles. No prometas entrevista.",
  NO_APTO:
    "Hoy el perfil no coincide con lo que busca el equipo. Agradécele con tacto, dilo sin listar criterios ni motivos, deja la puerta abierta para más adelante y despídete. No ofrezcas entrevista ni pidas CV.",
} as const;

function cierreDe(c: RecruitmentCandidate): string | undefined {
  const conCv = !!c.cvUrl;
  switch (c.etapa) {
    case "APTO":
    case "ENTREVISTA":
    case "CONTRATADO":
      if (c.horarioEntrevista) return OBJETIVOS_CIERRE.APTO_HORARIO_GUARDADO;
      return conCv ? OBJETIVOS_CIERRE.APTO_CON_CV : OBJETIVOS_CIERRE.APTO_SIN_CV;
    case "REVISAR":
      return conCv ? OBJETIVOS_CIERRE.REVISAR_CON_CV : OBJETIVOS_CIERRE.REVISAR_SIN_CV;
    case "NO_APTO":
    case "DESCARTADO":
      return OBJETIVOS_CIERRE.NO_APTO;
    default:
      return undefined;
  }
}

export interface ResultadoHook {
  /** Reemplaza el objetivo del playbook cuando hay cierre. */
  objetivo?: string;
  /** Texto que se suma a la capa de objetivo (ficha de la vacante) mientras el guion sigue. */
  contexto?: string;
}

export async function hookReclutamiento(input: {
  contact: { id: string; firstName: string; lastName: string; custom: unknown };
  conversationId: string;
  channel: ConversationChannel;
  model: string;
  messages: BotMessage[];
  playbook: { status: PlaybookRunStatus };
}): Promise<ResultadoHook> {
  try {
    const cand = await asegurarCandidato({ contactId: input.contact.id, canal: input.channel });
    if (!cand) return {};
    const cfg = await cargarConfigReclutamiento();
    if (cfg.errorModelo) console.warn(`[reclutamiento] reclutamiento.modelo inválido, se usa el default: ${cfg.errorModelo}`);

    // Ya evaluado: el bot no vuelve a evaluar solo. Si es APTO y falta horario, lo intenta capturar.
    if (ETAPAS_EVALUADAS.includes(cand.etapa)) {
      if ((cand.etapa === "APTO" || cand.etapa === "ENTREVISTA") && !cand.horarioEntrevista) {
        const ext = await extractFields({
          messages: input.messages,
          model: input.model,
          tasks: [{ key: "horario_entrevista", captureType: "TEXT", objective: "Qué días y horario le acomodan para la entrevista." }],
        });
        const h = ext.horario_entrevista;
        if (typeof h === "string" && h.trim()) {
          await guardarHorario(cand.id, h.trim());
          return { objetivo: OBJETIVOS_CIERRE.APTO_HORARIO_GUARDADO };
        }
      }
      return { objetivo: cierreDe(cand) };
    }

    if (input.playbook.status !== "COMPLETED") {
      if (cand.etapa === "NUEVO") await marcarPerfilando(cand.id);
      return { contexto: `Ficha de la vacante (úsala solo si el candidato pregunta por sueldo, comisiones, horario o la empresa; luego retoma): ${cfg.ficha}` };
    }

    // Playbook completo → evaluar.
    const respuestas = leerRespuestas(input.contact.custom);
    const actitud = await evaluarActitud(respuestas, input.model);
    const ev = evaluar({ respuestas, actitudPuntos: actitud?.puntos ?? null, cvRecibido: !!cand.cvUrl, modelo: cfg.modelo });
    await persistirEvaluacion({ candidatoId: cand.id, respuestas, evaluacion: ev, razonesActitud: actitud?.razones ?? [], model: input.model });

    const plaza = plazaDeRespuesta(respuestas.plaza);
    const responsables = await responsablesDe(plaza, cfg.responsables);
    await avisarResultado({
      candidatoId: cand.id,
      contactId: input.contact.id,
      conversationId: input.conversationId,
      nombre: `${input.contact.firstName} ${input.contact.lastName}`.trim(),
      plaza,
      puntaje: ev.puntaje,
      resultado: ev.resultado,
      responsables,
    });

    return { objetivo: cierreDe({ ...cand, etapa: etapaDeResultado(ev.resultado), cvUrl: cand.cvUrl, horarioEntrevista: null }) };
  } catch (err) {
    console.error("[reclutamiento] hook falló; el bot sigue con el playbook:", err);
    return {};
  }
}
```

Nota: `extractFields` recibe `{ messages, tasks, model }` (ver `src/lib/bot/playbook/extract.ts`). Si su firma exige `enumOptions` o `extractionHint`, agregarlos como `undefined`.

- [ ] **Step 4: Correr tests** → 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reclutamiento/hook.ts src/lib/reclutamiento/hook.test.ts
git commit -m "feat(reclutamiento): hook del bot: evaluar al terminar, cierre y horario

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Cablear el hook y los adjuntos en `bot-respond.ts`

**Files:**
- Modify: `src/lib/bot/bot-respond.ts` (historial ~línea 379; bloque de playbook ~líneas 455-485)
- Test: `src/lib/bot/bot-respond.reclutamiento.test.ts`

- [ ] **Step 1: Test que falla**

Copiar el scaffolding de mocks de `src/lib/bot/bot-respond.agents.test.ts` (líneas 1-70: `sendChannelMessage`, `@/lib/db`, `./claude`, `./config`, `./brand-linter`, `./hub-catalog`, `./classify`, `./agent-profiles`, `./playbook/run`) y agregar:

```ts
const hookReclutamiento = vi.fn();
vi.mock("@/lib/reclutamiento/hook", async (orig) => {
  const actual = await orig<typeof import("@/lib/reclutamiento/hook")>();
  return { ...actual, hookReclutamiento: (...a: unknown[]) => hookReclutamiento(...a) };
});
vi.mock("@/lib/messaging/conversations", () => ({
  ensureConversation: vi.fn(),
  findConversationForChannel: vi.fn(async () => ({ id: "v1", status: "BOT", botEnabled: true, connectorId: null, contactId: "k1" })),
}));
vi.mock("@/lib/brands/resolve", () => ({ resolveBrandForConnector: async () => ({ kind: "default" }), isBrandScoped: () => false }));
vi.mock("@/lib/brands/settings", () => ({ brandEnabledChannels: () => null }));
vi.mock("@/lib/users/actor-sistema", () => ({ resolveActorUserId: async () => "u1" }));
vi.mock("@/lib/whatsapp/coex/advisor-line", () => ({ isAdvisorLine: async () => false }));
vi.mock("@/lib/messaging/send-failure", () => ({ recordBotSendFailure: vi.fn(), recordBotSilence: vi.fn() }));
vi.mock("@/lib/messaging/aviso-sin-dueno", () => ({ avisarHiloSinDueno: vi.fn() }));
vi.mock("./marketing-routing", () => ({ ESCALATE_MARKETING_TOKEN: "[MKT]", getMarketingOwnerId: async () => null }));

import { botRespond } from "./bot-respond";

const agenteReclutamiento = {
  id: "a1", name: "Agente Reclutamiento", identity: "Eres reclutador.", tonePreset: null, priority: 30,
  playbook: { id: "p1", deletedAt: null, tasks: [{ key: "nombre", order: 0, objective: "nombre", targetField: "firstName", captureType: "FULL_NAME", enumOptions: [], required: true, skipIfFilled: true, isActive: true }] },
};

beforeEach(() => {
  [sendChannelMessage, contactFindUnique, msgFindMany, agentCount, askClaude, systemArgs, maybeClassifyContact, selectAgentProfile, runPlaybookStep, hookReclutamiento].forEach((f) => f.mockReset());
  contactFindUnique.mockResolvedValue({ id: "k1", firstName: "Ana", lastName: "López", contactType: "EMPLEO", custom: {}, doNotContact: false, whatsappOptOut: false, assignedToId: "u1", preferredLanguage: "ES" });
  agentCount.mockResolvedValue(1);
  maybeClassifyContact.mockResolvedValue("EMPLEO");
  selectAgentProfile.mockResolvedValue(agenteReclutamiento);
  askClaude.mockResolvedValue("Gracias, Ana.");
});

describe("bot-respond + reclutamiento", () => {
  it("con el agente de reclutamiento llama al hook y usa su objetivo de cierre", async () => {
    msgFindMany.mockResolvedValue([{ direction: "INBOUND", body: "hola", createdAt: new Date(), mediaFilename: null }]);
    runPlaybookStep.mockResolvedValue({ objective: "Ya tienes lo esencial…", status: "COMPLETED" });
    hookReclutamiento.mockResolvedValue({ objetivo: "CIERRE APTO" });
    await botRespond("k1", { channel: "INSTAGRAM" });
    expect(hookReclutamiento).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "v1", channel: "INSTAGRAM", playbook: { status: "COMPLETED" } }));
    const sys = systemArgs.mock.calls[0][0] as { objective: string };
    expect(sys.objective).toContain("CIERRE APTO");
    expect(sys.objective).not.toContain("Ya tienes lo esencial");
    expect(sys.objective).toContain("Eres reclutador.");
  });

  it("mientras el guion sigue, el contexto del hook se suma al objetivo del playbook", async () => {
    msgFindMany.mockResolvedValue([{ direction: "INBOUND", body: "hola", createdAt: new Date(), mediaFilename: null }]);
    runPlaybookStep.mockResolvedValue({ objective: "Tu meta ahora: pide su nombre", status: "IN_PROGRESS" });
    hookReclutamiento.mockResolvedValue({ contexto: "Ficha: 100 % comisión" });
    await botRespond("k1", { channel: "MESSENGER" });
    const sys = systemArgs.mock.calls[0][0] as { objective: string };
    expect(sys.objective).toContain("pide su nombre");
    expect(sys.objective).toContain("Ficha: 100 % comisión");
  });

  it("con otro agente no llama al hook", async () => {
    selectAgentProfile.mockResolvedValue({ ...agenteReclutamiento, name: "Agente Brokers" });
    msgFindMany.mockResolvedValue([{ direction: "INBOUND", body: "hola", createdAt: new Date(), mediaFilename: null }]);
    runPlaybookStep.mockResolvedValue({ objective: "x", status: "IN_PROGRESS" });
    await botRespond("k1", { channel: "INSTAGRAM" });
    expect(hookReclutamiento).not.toHaveBeenCalled();
  });

  it("un mensaje con adjunto y sin texto aparece en el historial como [adjunto: nombre]", async () => {
    msgFindMany.mockResolvedValue([
      { direction: "INBOUND", body: "", mediaFilename: "cv.pdf", createdAt: new Date() },
    ]);
    runPlaybookStep.mockResolvedValue({ objective: "x", status: "IN_PROGRESS" });
    hookReclutamiento.mockResolvedValue({});
    await botRespond("k1", { channel: "INSTAGRAM" });
    const llamada = askClaude.mock.calls[0][0] as { messages: { content: string }[] };
    expect(llamada.messages[0].content).toBe("[adjunto: cv.pdf]");
  });
});
```

Ajustar el mock de `@/lib/db` del scaffolding copiado para que `message.findMany` devuelva lo que ponga `msgFindMany` y para incluir `conversation.findFirst: vi.fn(async () => ({ id: "v1", status: "BOT", botEnabled: true, connectorId: null }))` y `recruitmentCandidate: {}` (no se usa porque el hook está mockeado).

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/bot/bot-respond.reclutamiento.test.ts`
Expected: FAIL en los 4 (el hook no se llama; el adjunto no aparece).

- [ ] **Step 3: Adjuntos en el historial**

En `bot-respond.ts`, cambiar el `.map` del historial (~línea 379):

```ts
    .map((m): BotMessage => ({ role: m.direction === "INBOUND" ? "user" : "assistant", content: m.body }))
```

por:

```ts
    // Adjuntos (spec reclutamiento §6): un mensaje que es solo archivo llegaba con body vacío y
    // el bot no sabía que ya había CV. Se marca el nombre para que no lo vuelva a pedir.
    .map((m): BotMessage => ({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: m.body?.trim() ? m.body : m.mediaFilename ? `[adjunto: ${m.mediaFilename}]` : m.body,
    }))
```

- [ ] **Step 4: Llamar al hook tras el playbook**

En el bloque del playbook (~líneas 455-485), sustituir:

```ts
        if (pr.objective) playbookObjective = pr.objective;
```

por:

```ts
        if (pr.objective) playbookObjective = pr.objective;
        // Reclutamiento (spec 2026-11-02): al terminar el guion se evalúa al candidato y el
        // cierre reemplaza al objetivo genérico; mientras sigue, se suma la ficha de la vacante.
        if (!brand && esAgenteReclutamiento(agentProfile)) {
          const hr = await hookReclutamiento({
            contact,
            conversationId: conv.id,
            channel,
            model: config.model,
            messages: history,
            playbook: { status: pr.status },
          });
          if (hr.objetivo) playbookObjective = hr.objetivo;
          else if (hr.contexto && playbookObjective) playbookObjective = `${playbookObjective}\n\n${hr.contexto}`;
        }
```

Y en los imports del archivo agregar:

```ts
import { esAgenteReclutamiento, hookReclutamiento } from "@/lib/reclutamiento/hook";
```

- [ ] **Step 5: Correr el test nuevo y los del bot**

Run: `npx vitest run src/lib/bot/`
Expected: todos pasan. Si `bot-respond.agents.test.ts` u otro rompe porque `@/lib/reclutamiento/hook` importa `@/lib/db` real: el hook solo se ejecuta cuando el agente se llama "Agente Reclutamiento", así que basta con que el import se resuelva; si aun así falla por el `prisma` real al importar, agregar en esos tests `vi.mock("@/lib/reclutamiento/hook", () => ({ esAgenteReclutamiento: () => false, hookReclutamiento: async () => ({}) }))`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/bot-respond.ts src/lib/bot/bot-respond.reclutamiento.test.ts
git commit -m "feat(reclutamiento): bot-respond llama al hook y ve los adjuntos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Pista de palabras clave en el clasificador

**Files:**
- Modify: `src/lib/bot/classify.ts` (`CLASSIFY_SYSTEM_PROMPT`, ~línea 36)
- Modify: `src/lib/bot/classify.test.ts`

- [ ] **Step 1: Test que falla**

Agregar en `classify.test.ts`:

```ts
import { CLASSIFY_SYSTEM_PROMPT } from "./classify";

describe("pista de EMPLEO (reclutamiento 2026-11-02)", () => {
  it("el prompt menciona las palabras clave de candidatos", () => {
    for (const k of ["vacante", "reclutamiento", "quiero ser asesor", "unirme al equipo"]) {
      expect(CLASSIFY_SYSTEM_PROMPT.toLowerCase()).toContain(k);
    }
  });
});
```

Si `CLASSIFY_SYSTEM_PROMPT` no está exportado, exportarlo (`export const CLASSIFY_SYSTEM_PROMPT`).

- [ ] **Step 2: Correr y ver que falla** → FAIL.

- [ ] **Step 3: Cambiar la línea de EMPLEO del prompt**

```ts
- EMPLEO: busca trabajo, vacantes o unirse al equipo (dice vacante, trabajo, empleo, reclutamiento, "quiero ser asesor", "unirme al equipo", o manda su CV).
```

- [ ] **Step 4: Correr tests** → `npx vitest run src/lib/bot/classify.test.ts` todos pasan.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/classify.ts src/lib/bot/classify.test.ts
git commit -m "feat(reclutamiento): pista de palabras clave de EMPLEO en el clasificador

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Prueba de humo documentada y verificación final

**Files:**
- Create: `docs/qa/reclutamiento-smoke.md`

- [ ] **Step 1: Escribir la prueba de humo**

```markdown
# Prueba de humo — bot de reclutamiento F1

Precondiciones (una vez, en prod, por quien tenga acceso a la BD):
1. Aplicar `prisma/migrations-manual/2026-11-02-recruitment-candidates.sql`.
2. Sembrar el playbook: `npx tsx scripts/seed-bot-playbooks-segmento.ts` (reemplaza las tareas del
   playbook "Reclutamiento — perfil de candidato").
3. Confirmar en Ajustes → Agentes del bot que "Agente Reclutamiento" está **activo**.
4. Confirmar `bot_config.enabledChannels` incluye INSTAGRAM y MESSENGER (lo hace el SQL).

Orden de canales: Instagram, luego Messenger. WhatsApp cuando su conexión con Meta sea estable.

## Caso 1 — APTO (Instagram)
Desde una cuenta de prueba, escribir "Hola, vi la vacante de asesor". Esperado: el bot pregunta nombre
y plaza. Contestar: Playa del Carmen · teléfono · correo · mayor de edad sí · comisión sí · tiempo
completo · 4 meses de colchón · tengo auto · 2 años en bienes raíces · 20 contactos · vendí seguros ·
inglés conversacional · uso Instagram · tres respuestas de actitud con sustancia.
Esperado al final: el bot felicita, pide CV y horario. En BD: fila en `recruitment_candidates` con
`etapa=APTO`, `puntaje ≥ 65`, `plaza=PDC`. Tarea "Entrevistar candidato …" para el gerente de PDC y
notificación en su campana. Mandar un PDF → `cvUrl` lleno. Contestar "martes por la tarde" →
`horarioEntrevista` lleno y el bot confirma.

## Caso 2 — REVISAR (Messenger)
Igual, pero colchón "no sé" y perfil fuerte. Esperado: etapa REVISAR, motivo `ambiguo:colchon_meses`,
el bot pide CV y dice "en dos días hábiles". Notificación, sin tarea.

## Caso 3 — NO APTO (Instagram)
Igual, pero "no tengo coche ni puedo moverme". Esperado: el bot termina el bloque de filtros (no corta
de golpe), al completar cierra con tacto, sin pedir CV. Etapa NO_APTO, motivo `filtro:movilidad`. Sin
notificación. Evento `recruitment.no_apto` en `workflow_events`.

## Caso 4 — pregunta fuera de guion
A mitad del guion preguntar "¿cuánto pagan?". Esperado: el bot contesta con la ficha (100 % comisión…)
y retoma la pregunta pendiente.

## Caso 5 — reclasificación
A mitad decir "en realidad quiero comprar un depa en Tulum". Esperado: el clasificador cambia a
LEAD_COMPRADOR y el siguiente mensaje lo atiende el Agente Lead Comprador.

Registrar fecha, canal, conversationId y resultado de cada caso al pie de este archivo.
```

- [ ] **Step 2: Suite completa y tipos en archivos tocados**

Run: `npm test`
Expected: todo verde (la suite base tenía ~1900 tests).

Run: `npx tsc --noEmit 2>&1 | grep -E "src/lib/reclutamiento|segment-playbooks|bot-respond\.ts|messaging/core\.ts|classify\.ts|workflows/events\.ts" || echo "sin errores en archivos tocados"`
Expected: `sin errores en archivos tocados`.

- [ ] **Step 3: Commit**

```bash
git add docs/qa/reclutamiento-smoke.md
git commit -m "docs(reclutamiento): prueba de humo F1 por canal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push y PR (solo si Luis lo pide)**

```bash
git push -u origin feat/bot-reclutamiento
```

Cuerpo del PR: enlace al spec y a este plan, lista de pasos de despliegue (SQL antes del merge, seed del playbook después del deploy, activar el agente), y la nota de la desviación `custom.reclutamiento_*`. Terminar con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Fuera de F1 (queda para F2)

- Spec §4.6: marcar DESCARTADO con motivo `reclasificado_a_ventas` al candidato que el clasificador
  pasa a LEAD_COMPRADOR a mitad del guion. En F1 el candidato se queda en su etapa y el agente de
  ventas toma la charla; la UI de F2 permite descartarlo a mano y ahí se automatiza.

## Checklist de despliegue (fuera del código)

1. Aplicar el SQL en prod **antes** de mergear.
2. Mergear → Hostinger compila.
3. Correr `npx tsx scripts/seed-bot-playbooks-segmento.ts` contra prod (o aplicar su equivalente SQL).
4. Verificar que "Agente Reclutamiento" está activo en Ajustes → Agentes del bot.
5. Correr la prueba de humo por Instagram y Messenger.
6. Cuando Luis nombre al responsable de Mérida: `SystemConfig` `reclutamiento.responsables` = `{"MERIDA":["<userId>"]}`.
