# Motor de Bot configurable + tono elegible — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el bot "Sage" en un motor configurable cuyo system prompt se ensambla en 4 capas (marca fija · tono elegible · objetivo dinámico · catálogo), con tono seleccionable por preset curado desde una UI admin, resolviendo el "suena robótico".

**Architecture:** Un modelo `BotConfig` singleton (editable desde la app) alimenta un `getBotConfig()` cacheado con defaults seguros. Presets de tono curados viven en código (`tone-presets.ts`). `buildSystemPrompt()` (función pura) ensambla las 4 capas; `askClaude()` usa `config.model` con `thinking:disabled`. El runtime (`bot-respond.ts`) respeta el master switch/canales y arranca de forma natural. El hook `objective` deja enchufar el playbook (Sub-proyecto B) sin refactor.

**Tech Stack:** Next.js 14, Prisma 6 (Postgres/Supabase, schema `propyte_crm`), TypeScript, Vitest, Zod, Radix UI. Modelo Claude vía fetch directo (sin SDK).

**Referencia:** spec en `docs/superpowers/specs/2026-07-10-bot-configurable-tono-elegible-design.md`.

> ⚠️ **Worktree compartido:** antes de cada commit, verificar rama con `git rev-parse --abbrev-ref HEAD` (esta checkout es compartida con otras sesiones — ver `feedback_propyte_hub_shared_worktree`). Trabajar en la rama actual; NO cambiar a `main`.
> ⚠️ **Migración:** el paso de aplicar SQL en Supabase lo hace **Luis** (DB compartida). El agente deja el SQL listo y corre `prisma generate` (que NO toca la DB).

---

## File Structure

**Nuevos:**
- `src/lib/bot/tone-presets.ts` — data pura: los 4 presets (guía de voz + ejemplos few-shot). Fuente para el prompt y el preview de la UI.
- `src/lib/bot/config.ts` — `BotConfigResolved`, `DEFAULT_BOT_CONFIG`, `resolveBotConfig()`, `getBotConfig()` (cache), `invalidateBotConfigCache()`.
- `src/server/bot-config.ts` — server actions admin: zod + `getBotConfigForAdmin()` + `updateBotConfig()` (auditoría + invalidación de cache).
- `src/components/admin/bot-config-tab.tsx` — UI (selector de tono con preview + toggles).
- `scripts/eval-bot-voice.ts` — harness de evaluación de tono (gates + LLM-judge).
- `prisma/migrations-manual/2026-07-10-botconfig.sql` — DDL aditivo + seed (lo aplica Luis).
- Tests: `src/lib/bot/{tone-presets,config,claude,bot-respond.guards}.test.ts`, `src/server/bot-config.schema.test.ts`.

**Editados:**
- `prisma/schema.prisma` — `+enum BotTonePreset`, `+model BotConfig`, relación en `User`.
- `src/lib/bot/claude.ts` — `BRAND_RULES`/`buildBrandRules`, `buildSystemPrompt`, `buildClaudeRequestBody`, `thinkingFieldFor`; `askClaude` acepta `model`.
- `src/lib/bot/bot-respond.ts` — `shouldBotRespondForChannel`, `buildOpener`, wiring de config.
- `src/components/admin/admin-content.tsx` — nueva pestaña "Bot".
- `src/app/(dashboard)/admin/page.tsx` — fetch de config y paso al tab.

**No se tocan:** `brand-linter.ts`, `hub-catalog.ts`, `ai-actions.ts`, motor de workflows.

---

## Task 1: Esquema Prisma — `BotConfig` + enum + migración manual

**Files:**
- Modify: `prisma/schema.prisma` (añadir enum, model, relación en `User`)
- Create: `prisma/migrations-manual/2026-07-10-botconfig.sql`

- [ ] **Step 1: Añadir el enum y el modelo al schema**

En `prisma/schema.prisma`, agregar el enum junto a los demás enums del schema `propyte_crm`:

```prisma
enum BotTonePreset {
  PROFESIONAL_CALIDO
  CALIDO_CERCANO_MX
  EJECUTIVO_SOBRIO
  NEUTRO_DIRECTO

  @@schema("propyte_crm")
}
```

Y el modelo (cerca de los modelos de bot/conversación):

```prisma
// Configuración global del bot (singleton). Editable desde Admin → Bot.
model BotConfig {
  id                 String        @id @default(uuid())
  singleton          Boolean       @unique @default(true) // fuerza una sola fila
  botEnabled         Boolean       @default(true)         // kill-switch global (≠ Conversation.botEnabled)
  tonePreset         BotTonePreset @default(PROFESIONAL_CALIDO)
  autonomyLevel      AutonomyLevel @default(L2)
  model              String        @default("claude-sonnet-5")
  openerStyle        String        @default("WARM_NAME") // WARM_NAME | DIRECT
  maxLines           Int           @default(4)
  dataGateStrict     Boolean       @default(true)
  escalationTriggers Json          @default("[\"apartar\",\"queja\",\"legal_fiscal\",\"negociacion\"]")
  enabledChannels    Json          @default("[\"WHATSAPP\"]")
  updatedByUserId    String?
  updatedBy          User?         @relation("BotConfigUpdatedBy", fields: [updatedByUserId], references: [id])
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  @@map("bot_config")
  @@schema("propyte_crm")
}
```

En el modelo `User`, añadir la relación inversa (junto a las demás relaciones del usuario):

```prisma
  botConfigUpdates BotConfig[] @relation("BotConfigUpdatedBy")
```

- [ ] **Step 2: Validar y generar el cliente Prisma**

Run:
```bash
npx prisma format
npx prisma validate
npx prisma generate
```
Expected: `validate` → "The schema at prisma/schema.prisma is valid"; `generate` → "Generated Prisma Client".

- [ ] **Step 3: Escribir la migración manual (la aplica Luis)**

Crear `prisma/migrations-manual/2026-07-10-botconfig.sql`:

```sql
-- Aditiva. Aplicar en Supabase (DB compartida). Verificar el nombre real de la tabla
-- de usuarios (@@map de User; en este repo es "users").
CREATE TYPE "propyte_crm"."BotTonePreset" AS ENUM (
  'PROFESIONAL_CALIDO', 'CALIDO_CERCANO_MX', 'EJECUTIVO_SOBRIO', 'NEUTRO_DIRECTO'
);

CREATE TABLE "propyte_crm"."bot_config" (
  "id"                 TEXT PRIMARY KEY,
  "singleton"          BOOLEAN NOT NULL DEFAULT true,
  "botEnabled"         BOOLEAN NOT NULL DEFAULT true,
  "tonePreset"         "propyte_crm"."BotTonePreset" NOT NULL DEFAULT 'PROFESIONAL_CALIDO',
  "autonomyLevel"      "propyte_crm"."AutonomyLevel" NOT NULL DEFAULT 'L2',
  "model"              TEXT NOT NULL DEFAULT 'claude-sonnet-5',
  "openerStyle"        TEXT NOT NULL DEFAULT 'WARM_NAME',
  "maxLines"           INTEGER NOT NULL DEFAULT 4,
  "dataGateStrict"     BOOLEAN NOT NULL DEFAULT true,
  "escalationTriggers" JSONB NOT NULL DEFAULT '["apartar","queja","legal_fiscal","negociacion"]',
  "enabledChannels"    JSONB NOT NULL DEFAULT '["WHATSAPP"]',
  "updatedByUserId"    TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "bot_config_singleton_key" ON "propyte_crm"."bot_config"("singleton");

ALTER TABLE "propyte_crm"."bot_config"
  ADD CONSTRAINT "bot_config_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "propyte_crm"."users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Fila default (seed)
INSERT INTO "propyte_crm"."bot_config" ("id", "updatedAt")
VALUES (gen_random_uuid()::text, CURRENT_TIMESTAMP);
```

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # confirmar rama actual (no main)
git add prisma/schema.prisma prisma/migrations-manual/2026-07-10-botconfig.sql
git commit -m "feat(bot): schema BotConfig singleton + enum BotTonePreset + migración manual"
```

---

## Task 2: Presets de tono (`tone-presets.ts`)

**Files:**
- Create: `src/lib/bot/tone-presets.ts`
- Test: `src/lib/bot/tone-presets.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`src/lib/bot/tone-presets.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { TONE_PRESETS, getTonePreset } from "./tone-presets";

const KEYS = ["PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"] as const;

describe("tone-presets", () => {
  it("define los 4 presets con la forma esperada", () => {
    for (const k of KEYS) {
      const p = TONE_PRESETS[k];
      expect(p.key).toBe(k);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.voiceGuidance.length).toBeGreaterThan(40);
      expect(p.fewShot.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("PROFESIONAL_CALIDO trae al menos 3 ejemplos few-shot bien formados", () => {
    const p = TONE_PRESETS.PROFESIONAL_CALIDO;
    expect(p.fewShot.length).toBeGreaterThanOrEqual(3);
    for (const ex of p.fewShot) {
      expect(["user", "assistant"]).toContain(ex.role);
      expect(ex.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("los presets sobrios no usan emoji", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const k of ["PROFESIONAL_CALIDO", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"] as const) {
      const p = TONE_PRESETS[k];
      const text = p.voiceGuidance + p.fewShot.map((e) => e.content).join(" ");
      expect(emoji.test(text)).toBe(false);
    }
  });

  it("getTonePreset devuelve el preset y cae al default si la clave es inválida", () => {
    expect(getTonePreset("EJECUTIVO_SOBRIO").key).toBe("EJECUTIVO_SOBRIO");
    // @ts-expect-error clave inválida a propósito
    expect(getTonePreset("NO_EXISTE").key).toBe("PROFESIONAL_CALIDO");
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx vitest run src/lib/bot/tone-presets.test.ts`
Expected: FAIL — "Cannot find module './tone-presets'".

- [ ] **Step 3: Implementar los presets**

`src/lib/bot/tone-presets.ts`:
```ts
// Presets de tono curados para el bot Sage. Data pura.
// La capa "marca" (anti-hype, data-gate, escalamiento) NO vive aquí; ver claude.ts.
import type { BotTonePreset } from "@prisma/client";

export interface ToneExample {
  role: "user" | "assistant";
  content: string;
}

export interface TonePreset {
  key: BotTonePreset;
  label: string;
  description: string;
  voiceGuidance: string;
  fewShot: ToneExample[];
}

export const TONE_PRESETS: Record<BotTonePreset, TonePreset> = {
  PROFESIONAL_CALIDO: {
    key: "PROFESIONAL_CALIDO",
    label: "Profesional-cálido",
    description:
      "Cordial y humano pero sobrio, tono ejecutivo suave, sin emoji. Encaja con una boutique premium.",
    voiceGuidance: [
      "Escribes como un asesor senior real por WhatsApp: cordial y humano, pero sobrio y premium.",
      "Sin emoji. Sin signos de exclamación de más. Cero hype.",
      "Saludas por su nombre y reconoces lo que dijo antes de responder.",
      "Una idea por mensaje; frases naturales con contracciones normales del español; sin viñetas ni encabezados.",
      "Cuando falta un dato, lo ofreces con naturalidad (confirmar el número exacto y enlazar al asesor) en vez de cortar seco.",
      "Haces una sola pregunta a la vez para perfilar.",
    ].join(" "),
    fewShot: [
      { role: "user", content: "Hola, vi un depa en Tulum" },
      {
        role: "assistant",
        content:
          "Hola, buenas. Qué bueno que te interesó Tulum. Para orientarte bien, ¿lo estás viendo para vivir, rentar o como inversión? Con eso te muestro lo que más te conviene.",
      },
      { role: "user", content: "¿Cuánto cuesta?" },
      {
        role: "assistant",
        content:
          "Buena pregunta. Para darte el precio exacto y no un aproximado, ¿me confirmas cuál desarrollo o el rango que traes en mente? Así te aterrizo números reales.",
      },
      { role: "user", content: "Quiero apartarlo hoy" },
      {
        role: "assistant",
        content:
          "Me da gusto que estés decidido. Eso lo ve directo tu asesor para dejarte todo en orden hoy mismo; te contacta enseguida.",
      },
    ],
  },

  CALIDO_CERCANO_MX: {
    key: "CALIDO_CERCANO_MX",
    label: "Cálido-cercano (MX)",
    description:
      "Español mexicano cercano y amable, tuteo, un emoji ocasional. Mantiene el anti-hype.",
    voiceGuidance: [
      "Hablas como un buen asesor mexicano por WhatsApp: cercano, amable y natural, de tú.",
      "Puedes usar un emoji ocasional (máximo uno por mensaje), nunca para vender ni exagerar.",
      "Saludas por su nombre; frases cortas y coloquiales pero claras.",
      "Cuando falta un dato lo confirmas con gusto en vez de esquivar; una sola pregunta a la vez.",
    ].join(" "),
    fewShot: [
      { role: "user", content: "Hola, me interesa Tulum" },
      {
        role: "assistant",
        content:
          "¡Hola! Con gusto te ayudo con Tulum 🙂 Para recomendarte bien, ¿lo buscas para vivir, rentar o invertir?",
      },
      { role: "user", content: "¿Qué precio manejan?" },
      {
        role: "assistant",
        content:
          "Va, para pasarte el precio exacto (y no un estimado), ¿te late si me dices qué desarrollo viste o tu rango de presupuesto?",
      },
    ],
  },

  EJECUTIVO_SOBRIO: {
    key: "EJECUTIVO_SOBRIO",
    label: "Ejecutivo-sobrio",
    description: "Cordial pero más formal y breve, tono corporativo suave, sin emoji.",
    voiceGuidance: [
      "Tono cordial pero formal y breve, corporativo suave. Trato de usted.",
      "Sin emoji. Frases claras y contenidas; nada de coloquialismos ni exclamaciones.",
      "Reconoces la consulta, respondes al punto y haces una sola pregunta de calificación.",
    ].join(" "),
    fewShot: [
      { role: "user", content: "Buen día, información de Tulum" },
      {
        role: "assistant",
        content:
          "Buen día. Con gusto le comparto opciones en Tulum. Para orientarle con precisión, ¿su interés es para uso propio, renta o inversión?",
      },
      { role: "user", content: "¿Cuál es el precio?" },
      {
        role: "assistant",
        content:
          "Para darle la cifra exacta, ¿me confirma el desarrollo de su interés o el rango de presupuesto que maneja? Así le comparto números reales.",
      },
    ],
  },

  NEUTRO_DIRECTO: {
    key: "NEUTRO_DIRECTO",
    label: "Neutro-directo",
    description: "Humano y fluido, va al grano con amabilidad, sin adornos.",
    voiceGuidance: [
      "Humano y fluido, pero directo: vas al grano con amabilidad, sin adornos ni relleno.",
      "Sin emoji. Respuestas breves; una sola pregunta cuando necesitas calificar.",
      "Si falta un dato, lo dices claro y ofreces confirmarlo, sin rodeos.",
    ].join(" "),
    fewShot: [
      { role: "user", content: "Info de Tulum" },
      {
        role: "assistant",
        content:
          "Claro. ¿Lo buscas para vivir, rentar o invertir? Con eso te paso lo que aplica.",
      },
      { role: "user", content: "¿Precio?" },
      {
        role: "assistant",
        content:
          "Para darte el exacto necesito el desarrollo o tu rango de presupuesto. ¿Cuál me confirmas?",
      },
    ],
  },
};

export function getTonePreset(key: string): TonePreset {
  return (TONE_PRESETS as Record<string, TonePreset>)[key] ?? TONE_PRESETS.PROFESIONAL_CALIDO;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npx vitest run src/lib/bot/tone-presets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/tone-presets.ts src/lib/bot/tone-presets.test.ts
git commit -m "feat(bot): presets de tono curados (profesional-cálido default)"
```

---

## Task 3: Loader de configuración (`config.ts`)

**Files:**
- Create: `src/lib/bot/config.ts`
- Test: `src/lib/bot/config.test.ts`

- [ ] **Step 1: Escribir el test que falla (sólo la función pura `resolveBotConfig`)**

`src/lib/bot/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveBotConfig, DEFAULT_BOT_CONFIG } from "./config";

describe("resolveBotConfig", () => {
  it("devuelve defaults cuando no hay fila", () => {
    const r = resolveBotConfig(null);
    expect(r.tonePreset).toBe(DEFAULT_BOT_CONFIG.tonePreset);
    expect(r.enabledChannels).toEqual(["WHATSAPP"]);
    expect(r.escalationTriggers.length).toBeGreaterThan(0);
    expect(r.model.length).toBeGreaterThan(0);
  });

  it("mapea una fila y parsea los Json a arrays de string", () => {
    const r = resolveBotConfig({
      botEnabled: false,
      tonePreset: "EJECUTIVO_SOBRIO",
      autonomyLevel: "L1",
      model: "claude-sonnet-4-6",
      openerStyle: "DIRECT",
      maxLines: 3,
      dataGateStrict: false,
      escalationTriggers: ["queja"],
      enabledChannels: ["WHATSAPP", "INSTAGRAM"],
    } as any);
    expect(r.botEnabled).toBe(false);
    expect(r.tonePreset).toBe("EJECUTIVO_SOBRIO");
    expect(r.openerStyle).toBe("DIRECT");
    expect(r.enabledChannels).toEqual(["WHATSAPP", "INSTAGRAM"]);
    expect(r.escalationTriggers).toEqual(["queja"]);
  });

  it("tolera Json corrupto cayendo al default de esa lista", () => {
    const r = resolveBotConfig({ escalationTriggers: "no-es-array", enabledChannels: null } as any);
    expect(r.escalationTriggers).toEqual(DEFAULT_BOT_CONFIG.escalationTriggers);
    expect(r.enabledChannels).toEqual(DEFAULT_BOT_CONFIG.enabledChannels);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx vitest run src/lib/bot/config.test.ts`
Expected: FAIL — "Cannot find module './config'".

- [ ] **Step 3: Implementar `config.ts`**

`src/lib/bot/config.ts`:
```ts
import prisma from "@/lib/db";
import type { BotTonePreset, AutonomyLevel } from "@prisma/client";

export type OpenerStyle = "WARM_NAME" | "DIRECT";

export interface BotConfigResolved {
  botEnabled: boolean;
  tonePreset: BotTonePreset;
  autonomyLevel: AutonomyLevel;
  model: string;
  openerStyle: OpenerStyle;
  maxLines: number;
  dataGateStrict: boolean;
  escalationTriggers: string[];
  enabledChannels: string[];
}

export const DEFAULT_BOT_CONFIG: BotConfigResolved = {
  botEnabled: true,
  tonePreset: "PROFESIONAL_CALIDO",
  autonomyLevel: "L2",
  model: process.env.BOT_MODEL?.trim() || "claude-sonnet-5",
  openerStyle: "WARM_NAME",
  maxLines: 4,
  dataGateStrict: true,
  escalationTriggers: ["apartar", "queja", "legal_fiscal", "negociacion"],
  enabledChannels: ["WHATSAPP"],
};

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : fallback;
}

// Fila cruda de Prisma (o null). Función pura: fácil de testear sin DB.
export function resolveBotConfig(row: Record<string, unknown> | null): BotConfigResolved {
  if (!row) return { ...DEFAULT_BOT_CONFIG };
  const d = DEFAULT_BOT_CONFIG;
  return {
    botEnabled: (row.botEnabled as boolean) ?? d.botEnabled,
    tonePreset: (row.tonePreset as BotTonePreset) ?? d.tonePreset,
    autonomyLevel: (row.autonomyLevel as AutonomyLevel) ?? d.autonomyLevel,
    model: (row.model as string) || d.model,
    openerStyle: (row.openerStyle as OpenerStyle) ?? d.openerStyle,
    maxLines: (row.maxLines as number) ?? d.maxLines,
    dataGateStrict: (row.dataGateStrict as boolean) ?? d.dataGateStrict,
    escalationTriggers: asStringArray(row.escalationTriggers, d.escalationTriggers),
    enabledChannels: asStringArray(row.enabledChannels, d.enabledChannels),
  };
}

let _cache: { value: BotConfigResolved; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function getBotConfig(): Promise<BotConfigResolved> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
  let row: Record<string, unknown> | null = null;
  try {
    row = (await prisma.botConfig.findFirst()) as Record<string, unknown> | null;
  } catch {
    // Antes de aplicar la migración, la tabla no existe: usar defaults seguros.
    row = null;
  }
  const value = resolveBotConfig(row);
  _cache = { value, at: Date.now() };
  return value;
}

export function invalidateBotConfigCache(): void {
  _cache = null;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npx vitest run src/lib/bot/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/config.ts src/lib/bot/config.test.ts
git commit -m "feat(bot): loader getBotConfig con defaults seguros pre-migración"
```

---

## Task 4: Ensamblado del prompt en 4 capas (`buildSystemPrompt`)

**Files:**
- Modify: `src/lib/bot/claude.ts`
- Test: `src/lib/bot/claude.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`src/lib/bot/claude.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./claude";
import { DEFAULT_BOT_CONFIG } from "./config";
import { TONE_PRESETS } from "./tone-presets";

const contact = { firstName: "Juan", preferredLanguage: "ES" };

describe("buildSystemPrompt (4 capas)", () => {
  it("incluye reglas de marca (anti-hype + data-gate + escalamiento)", () => {
    const s = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, contact, catalog: [] });
    expect(s).toContain("Propyte");
    expect(s.toLowerCase()).toContain("no inventes");
    expect(s).toContain("[ESCALAR]");
  });

  it("incluye la guía de voz del preset activo", () => {
    const s = buildSystemPrompt({
      config: { ...DEFAULT_BOT_CONFIG, tonePreset: "EJECUTIVO_SOBRIO" },
      contact,
      catalog: [],
    });
    expect(s).toContain(TONE_PRESETS.EJECUTIVO_SOBRIO.voiceGuidance.slice(0, 30));
  });

  it("refleja maxLines", () => {
    const s = buildSystemPrompt({ config: { ...DEFAULT_BOT_CONFIG, maxLines: 2 }, contact, catalog: [] });
    expect(s).toContain("2 líneas");
  });

  it("dataGateStrict=false suaviza la regla de cifras", () => {
    const strict = buildSystemPrompt({ config: { ...DEFAULT_BOT_CONFIG, dataGateStrict: true }, contact, catalog: [] });
    const loose = buildSystemPrompt({ config: { ...DEFAULT_BOT_CONFIG, dataGateStrict: false }, contact, catalog: [] });
    expect(strict).not.toBe(loose);
  });

  it("usa el objetivo dado (gancho del playbook) y si no, el default", () => {
    const withObj = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, contact, catalog: [], objective: "OBJETIVO_X" });
    expect(withObj).toContain("OBJETIVO_X");
    const def = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, contact, catalog: [] });
    expect(def.toLowerCase()).toContain("califica");
  });

  it("sin catálogo instruye a no citar precios", () => {
    const s = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, contact, catalog: [] });
    expect(s.toLowerCase()).toContain("no cites precios");
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx vitest run src/lib/bot/claude.test.ts`
Expected: FAIL — "buildSystemPrompt is not a function" / no export.

- [ ] **Step 3: Refactor de `claude.ts` — añadir builders (conservar `askClaude`)**

En `src/lib/bot/claude.ts`, reemplazar la constante `SAGE_SYSTEM_PROMPT` por builders. Añadir arriba los imports y las funciones; **conservar** `BotMessage`, `API_URL` y `askClaude` (este último se ajusta en la Task 5).

```ts
import type { BotConfigResolved } from "./config";
import { getTonePreset } from "./tone-presets";
import { catalogBrief } from "./hub-catalog";

export const ESCALATE_TOKEN = "[ESCALAR]";

export function buildBrandRules(config: BotConfigResolved): string {
  const gate = config.dataGateStrict
    ? "NO inventes cifras. Precios, ROI o % de avance SOLO si te los dan en el contexto, citando la fuente. Si no tienes el dato: ofrécele confirmarlo con su asesor; jamás aproximes."
    : "Prioriza cifras del contexto. Si no las tienes, dilo con naturalidad y ofrece confirmarlo con su asesor.";
  const triggers = config.escalationTriggers.join(", ");
  return [
    "Eres el asistente comercial de Propyte, inmobiliaria boutique de la Riviera Maya.",
    "NUNCA usas hype, urgencia artificial ni prometes retornos.",
    gate,
    `Tu objetivo: perfilar (presupuesto, zona, recámaras, plazo), responder FAQ del catálogo que te den en contexto, y agendar una llamada/visita con el asesor.`,
    `Si detectas intención fuerte o alguno de estos temas (${triggers}), responde un mensaje breve de transición y termina con el token ${ESCALATE_TOKEN}. No sigas tú.`,
    "Responde en el idioma del cliente (ES/EN).",
    `Mensajes cortos, estilo WhatsApp (máx ~${config.maxLines} líneas).`,
    "Nunca digas que eres una IA salvo pregunta directa; entonces sé honesto.",
  ].join("\n");
}

const DEFAULT_OBJECTIVE =
  "Saluda y avanza en calificar (zona, presupuesto, plazo) con una sola pregunta a la vez.";

export function buildSystemPrompt(args: {
  config: BotConfigResolved;
  contact: { firstName: string; preferredLanguage: string };
  catalog: Parameters<typeof catalogBrief>[0];
  objective?: string;
}): string {
  const { config, contact, catalog } = args;
  const preset = getTonePreset(config.tonePreset);

  // Capa 2: tono (guía + ejemplos ilustrativos)
  const examples = preset.fewShot
    .map((e) => `${e.role === "user" ? "Cliente" : "Tú"}: ${e.content}`)
    .join("\n");

  // Capa 4: catálogo
  const catalogBlock =
    catalog && catalog.length > 0
      ? catalogBrief(catalog)
      : "(No tienes catálogo en contexto: NO cites precios.)";

  return [
    // Capa 1 — marca (fija)
    buildBrandRules(config),
    // Capa 2 — tono (elegible)
    `\nTono y estilo:\n${preset.voiceGuidance}`,
    `\nEjemplos de tu estilo (imítalos en registro, no los copies literal):\n${examples}`,
    // Capa 3 — objetivo (dinámico; el playbook lo inyecta en el Sub-proyecto B)
    `\nObjetivo ahora: ${args.objective ?? DEFAULT_OBJECTIVE}`,
    // Contexto del cliente
    `\nCliente: ${contact.firstName} · Idioma: ${contact.preferredLanguage}`,
    // Capa 4 — catálogo
    `\n${catalogBlock}`,
  ].join("\n");
}
```

> Nota: el `DEFAULT_OBJECTIVE` contiene "calificar" → el test que busca "califica" pasa por substring case-insensitive.

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npx vitest run src/lib/bot/claude.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/claude.ts src/lib/bot/claude.test.ts
git commit -m "feat(bot): buildSystemPrompt ensambla marca+tono+objetivo+catálogo"
```

---

## Task 5: `askClaude` usa `config.model` + `thinking:disabled`

**Files:**
- Modify: `src/lib/bot/claude.ts`
- Test: `src/lib/bot/claude.test.ts` (añadir bloque)

- [ ] **Step 1: Añadir tests para el body builder**

Añadir al final de `src/lib/bot/claude.test.ts`:
```ts
import { buildClaudeRequestBody, thinkingFieldFor } from "./claude";

describe("buildClaudeRequestBody", () => {
  it("Sonnet 5 lleva thinking:disabled y el modelo dado", () => {
    const body = buildClaudeRequestBody({
      model: "claude-sonnet-5",
      system: "S",
      messages: [{ role: "user", content: "hola" }],
      maxTokens: 300,
    }) as any;
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBe(300);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("Haiku 4.5 NO manda thinking (no pertenece a la familia 4.6+)", () => {
    expect(thinkingFieldFor("claude-haiku-4-5")).toEqual({});
    const body = buildClaudeRequestBody({
      model: "claude-haiku-4-5",
      system: "S",
      messages: [{ role: "user", content: "hola" }],
      maxTokens: 300,
    }) as any;
    expect(body.thinking).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/lib/bot/claude.test.ts`
Expected: FAIL — no export `buildClaudeRequestBody` / `thinkingFieldFor`.

- [ ] **Step 3: Implementar el body builder y cablear `askClaude`**

En `src/lib/bot/claude.ts` añadir:
```ts
// Familia 4.6+ acepta thinking:{type:"disabled"}. Modelos previos (Haiku 4.5)
// no lo usan: se omite (su default es sin thinking).
export function thinkingFieldFor(model: string): { thinking?: { type: "disabled" } } {
  const adaptiveFamily = /sonnet-5|sonnet-4-6|opus-4-(6|7|8)|fable-5/.test(model);
  return adaptiveFamily ? { thinking: { type: "disabled" } } : {};
}

export function buildClaudeRequestBody(opts: {
  model: string;
  system: string;
  messages: BotMessage[];
  maxTokens: number;
}) {
  return {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    ...thinkingFieldFor(opts.model),
    messages: opts.messages,
  };
}
```

Modificar `askClaude` para aceptar `model` y usar el body builder:
```ts
export async function askClaude(opts: {
  system?: string;
  messages: BotMessage[];
  maxTokens?: number;
  model?: string;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const model = opts.model?.trim() || process.env.BOT_MODEL?.trim() || "claude-sonnet-5";
  const body = buildClaudeRequestBody({
    model,
    system: opts.system ?? buildBrandRules({} as any), // fallback improbable; los llamadores pasan system
    messages: opts.messages,
    maxTokens: opts.maxTokens ?? 400,
  });

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((b) => b.type === "text")?.text;
  return text?.trim() || null;
}
```

> El `system` siempre lo pasan los llamadores (`bot-respond.ts` y el resumen de escalamiento), así que el fallback no se usa en la práctica; se deja defensivo.

- [ ] **Step 4: Correr y ver pasar (todo el archivo)**

Run: `npx vitest run src/lib/bot/claude.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/claude.ts src/lib/bot/claude.test.ts
git commit -m "feat(bot): askClaude usa config.model + thinking:disabled (fix truncado Sonnet 5)"
```

---

## Task 6: Guards + arranque natural en `bot-respond.ts`

**Files:**
- Modify: `src/lib/bot/bot-respond.ts`
- Test: `src/lib/bot/bot-respond.guards.test.ts`

- [ ] **Step 1: Escribir el test que falla (funciones puras)**

`src/lib/bot/bot-respond.guards.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { shouldBotRespondForChannel, buildOpener } from "./bot-respond";
import { DEFAULT_BOT_CONFIG } from "./config";

describe("shouldBotRespondForChannel", () => {
  it("respeta el master switch", () => {
    expect(shouldBotRespondForChannel({ ...DEFAULT_BOT_CONFIG, botEnabled: false }, "WHATSAPP")).toBe(false);
  });
  it("respeta los canales habilitados", () => {
    expect(shouldBotRespondForChannel(DEFAULT_BOT_CONFIG, "WHATSAPP")).toBe(true);
    expect(shouldBotRespondForChannel(DEFAULT_BOT_CONFIG, "INSTAGRAM")).toBe(false);
  });
});

describe("buildOpener", () => {
  it("WARM_NAME usa el nombre del contacto", () => {
    const o = buildOpener({ ...DEFAULT_BOT_CONFIG, openerStyle: "WARM_NAME" }, { firstName: "Ana", preferredZone: "Tulum" });
    expect(o).toContain("Ana");
    expect(o).toContain("Tulum");
  });
  it("DIRECT es más escueto y no exige nombre", () => {
    const o = buildOpener({ ...DEFAULT_BOT_CONFIG, openerStyle: "DIRECT" }, { firstName: "Ana", preferredZone: null });
    expect(o.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/lib/bot/bot-respond.guards.test.ts`
Expected: FAIL — no exports.

- [ ] **Step 3: Implementar guards + arranque y cablear config**

En `src/lib/bot/bot-respond.ts`:

(a) Añadir imports arriba:
```ts
import { getBotConfig, type BotConfigResolved } from "./config";
import { buildSystemPrompt } from "./claude";
```
y usar `askClaude` ya existente. Mantener `ESCALATE_MARKER = "[ESCALAR]"` (coincide con `ESCALATE_TOKEN`).

(b) Añadir funciones puras exportadas (cerca del top del módulo):
```ts
export function shouldBotRespondForChannel(config: BotConfigResolved, channel: string): boolean {
  return config.botEnabled && config.enabledChannels.includes(channel);
}

export function buildOpener(
  config: BotConfigResolved,
  contact: { firstName: string; preferredZone?: string | null },
): string {
  const interes = contact.preferredZone ? contact.preferredZone : "lo que busca";
  if (config.openerStyle === "DIRECT") {
    return `Este es el primer mensaje. Preséntate breve y haz UNA pregunta para empezar a calificar (${interes}). No suenes a script.`;
  }
  return `Este es el primer mensaje. Saluda a ${contact.firstName} por su nombre de forma cálida y natural, menciona brevemente su interés (${interes}) si lo conoces, y haz UNA pregunta para empezar a calificar. No suenes a script.`;
}
```

(c) Dentro de `botRespond`, tras resolver `channel`, cargar config y aplicar el master switch/canales:
```ts
const config = await getBotConfig();
if (!shouldBotRespondForChannel(config, channel)) return false;
```
Colocarlo **antes** de buscar el contacto (o justo después), y mantener las guardas existentes (`doNotContact`, `whatsappOptOut`, `conv.status`, `botEnabled`).

(d) Reemplazar el seed mecánico de historial vacío:
```ts
if (history.length === 0) {
  history.push({ role: "user", content: opts.goal ?? "(nuevo lead entrante)" });
}
```

(e) Reemplazar la construcción del `system` (el bloque `const system = SAGE_SYSTEM_PROMPT + ...`) por:
```ts
const objective =
  history.length === 1 && history[0].role === "user" && !opts.goal
    ? buildOpener(config, { firstName: contact.firstName, preferredZone: contact.preferredZone })
    : undefined;

const system = buildSystemPrompt({
  config,
  contact: { firstName: contact.firstName, preferredLanguage: contact.preferredLanguage },
  catalog,
  objective,
});
```

(f) En la llamada a `askClaude` del reply, pasar el modelo de config:
```ts
const reply = await askClaude({ system, messages: history, maxTokens: 300, model: config.model });
```

> Eliminar el `import { ..., SAGE_SYSTEM_PROMPT } from "./claude"` (ya no existe). El resto del pipeline (linter, envío/escala, resumen) queda igual.

- [ ] **Step 4: Correr los tests de bot (guards + los existentes de canal)**

Run: `npx vitest run src/lib/bot/`
Expected: PASS — guards (4 tests) + `brand-linter.test.ts` + `bot-respond.channel.test.ts` siguen verdes. Si `bot-respond.channel.test.ts` mockea `askClaude`/`getBotConfig`, ajustar el mock para devolver `DEFAULT_BOT_CONFIG` (importar y devolverlo desde el mock).

- [ ] **Step 5: Typecheck/build parcial**

Run: `npx tsc --noEmit`
Expected: sin errores (o sólo los preexistentes ajenos a estos archivos).

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/bot-respond.ts src/lib/bot/bot-respond.guards.test.ts
git commit -m "feat(bot): bot-respond usa config (master switch, canales, arranque natural)"
```

---

## Task 7: Server actions `bot-config.ts` (zod + auditoría)

**Files:**
- Create: `src/server/bot-config.ts`
- Test: `src/server/bot-config.schema.test.ts`

- [ ] **Step 1: Escribir el test del schema zod (parte pura)**

`src/server/bot-config.schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { botConfigUpdateSchema } from "./bot-config";

describe("botConfigUpdateSchema", () => {
  it("acepta una config válida", () => {
    const r = botConfigUpdateSchema.safeParse({
      botEnabled: true,
      tonePreset: "PROFESIONAL_CALIDO",
      autonomyLevel: "L2",
      model: "claude-sonnet-5",
      openerStyle: "WARM_NAME",
      maxLines: 4,
      dataGateStrict: true,
      escalationTriggers: ["queja", "apartar"],
      enabledChannels: ["WHATSAPP"],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza preset inválido", () => {
    expect(botConfigUpdateSchema.safeParse({ tonePreset: "NOPE" }).success).toBe(false);
  });

  it("rechaza modelo fuera de la allowlist", () => {
    expect(botConfigUpdateSchema.safeParse({ model: "gpt-4" }).success).toBe(false);
  });

  it("rechaza maxLines fuera de rango", () => {
    expect(botConfigUpdateSchema.safeParse({ maxLines: 99 }).success).toBe(false);
    expect(botConfigUpdateSchema.safeParse({ maxLines: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/server/bot-config.schema.test.ts`
Expected: FAIL — "Cannot find module './bot-config'".

- [ ] **Step 3: Implementar `bot-config.ts`**

`src/server/bot-config.ts`:
```ts
"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { z } from "zod";
import { invalidateBotConfigCache, resolveBotConfig, type BotConfigResolved } from "@/lib/bot/config";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

async function requireAdminRole() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Acceso denegado: se requiere rol de administración");
  }
  return session;
}

const ALLOWED_MODELS = ["claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"] as const;

export const botConfigUpdateSchema = z.object({
  botEnabled: z.boolean().optional(),
  tonePreset: z.enum(["PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"]).optional(),
  autonomyLevel: z.enum(["L0", "L1", "L2"]).optional(),
  model: z.enum(ALLOWED_MODELS).optional(),
  openerStyle: z.enum(["WARM_NAME", "DIRECT"]).optional(),
  maxLines: z.number().int().min(1).max(8).optional(),
  dataGateStrict: z.boolean().optional(),
  escalationTriggers: z.array(z.string().min(1)).max(20).optional(),
  enabledChannels: z.array(z.enum(["WHATSAPP", "INSTAGRAM", "MESSENGER", "SMS"])).optional(),
});

export type BotConfigUpdateInput = z.infer<typeof botConfigUpdateSchema>;

export async function getBotConfigForAdmin(): Promise<BotConfigResolved> {
  await requireAdminRole();
  const row = (await prisma.botConfig.findFirst()) as Record<string, unknown> | null;
  return resolveBotConfig(row);
}

export async function updateBotConfig(input: BotConfigUpdateInput): Promise<BotConfigResolved> {
  const session = await requireAdminRole();
  const data = botConfigUpdateSchema.parse(input);

  const existing = await prisma.botConfig.findFirst({ select: { id: true } });
  const row = existing
    ? await prisma.botConfig.update({
        where: { id: existing.id },
        data: { ...data, updatedByUserId: session.user.id },
      })
    : await prisma.botConfig.create({
        data: { ...data, singleton: true, updatedByUserId: session.user.id },
      });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "BotConfig",
      entityId: row.id,
      changes: data as Record<string, unknown>,
    },
  });

  invalidateBotConfigCache();
  return resolveBotConfig(row as unknown as Record<string, unknown>);
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/server/bot-config.schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/bot-config.ts src/server/bot-config.schema.test.ts
git commit -m "feat(bot): server actions bot-config (zod, auditoría, invalidación de cache)"
```

---

## Task 8: UI admin — pestaña "Bot"

**Files:**
- Create: `src/components/admin/bot-config-tab.tsx`
- Modify: `src/components/admin/admin-content.tsx` (añadir pestaña)
- Modify: `src/app/(dashboard)/admin/page.tsx` (fetch config, pasar al tab)

- [ ] **Step 1: Crear el componente de la pestaña**

`src/components/admin/bot-config-tab.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { TONE_PRESETS } from "@/lib/bot/tone-presets";
import { updateBotConfig } from "@/server/bot-config";
import type { BotTonePreset } from "@prisma/client";

interface BotConfigData {
  botEnabled: boolean;
  tonePreset: BotTonePreset;
  autonomyLevel: "L0" | "L1" | "L2";
  model: string;
  openerStyle: "WARM_NAME" | "DIRECT";
  maxLines: number;
  dataGateStrict: boolean;
  escalationTriggers: string[];
  enabledChannels: string[];
}

const TONE_KEYS = Object.keys(TONE_PRESETS) as BotTonePreset[];

export function BotConfigTab({ initial }: { initial: BotConfigData }) {
  const [cfg, setCfg] = useState<BotConfigData>(initial);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const preset = TONE_PRESETS[cfg.tonePreset];

  function save() {
    startTransition(async () => {
      try {
        await updateBotConfig({
          botEnabled: cfg.botEnabled,
          tonePreset: cfg.tonePreset,
          autonomyLevel: cfg.autonomyLevel,
          model: cfg.model as any,
          openerStyle: cfg.openerStyle,
          maxLines: cfg.maxLines,
          dataGateStrict: cfg.dataGateStrict,
          escalationTriggers: cfg.escalationTriggers,
          enabledChannels: cfg.enabledChannels as any,
        });
        toast({ title: "Configuración del bot guardada" });
      } catch (e) {
        toast({ title: "Error al guardar", description: String(e), variant: "destructive" });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Estado</CardTitle>
          <CardDescription>Enciende o apaga el bot globalmente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfg.botEnabled}
              onChange={(e) => setCfg({ ...cfg, botEnabled: e.target.checked })}
            />
            <span>Bot activo</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tono</CardTitle>
          <CardDescription>Elige el registro de voz. Las reglas de marca no cambian.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Preset</Label>
            <Select value={cfg.tonePreset} onValueChange={(v) => setCfg({ ...cfg, tonePreset: v as BotTonePreset })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TONE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>{TONE_PRESETS[k].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border p-3 text-sm space-y-2 bg-muted/30">
            <p className="text-muted-foreground">{preset.description}</p>
            <div className="space-y-1">
              {preset.fewShot.slice(0, 4).map((ex, i) => (
                <p key={i}>
                  <span className="font-medium">{ex.role === "user" ? "Cliente" : "Sage"}:</span> {ex.content}
                </p>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Comportamiento</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Autonomía</Label>
            <Select value={cfg.autonomyLevel} onValueChange={(v) => setCfg({ ...cfg, autonomyLevel: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="L0">L0 — sólo sugiere</SelectItem>
                <SelectItem value="L1">L1 — envío con aprobación</SelectItem>
                <SelectItem value="L2">L2 — autónomo con red</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Arranque</Label>
            <Select value={cfg.openerStyle} onValueChange={(v) => setCfg({ ...cfg, openerStyle: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WARM_NAME">Cálido con nombre</SelectItem>
                <SelectItem value="DIRECT">Directo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Longitud máxima (líneas)</Label>
            <Input
              type="number" min={1} max={8} value={cfg.maxLines}
              onChange={(e) => setCfg({ ...cfg, maxLines: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox" checked={cfg.dataGateStrict}
              onChange={(e) => setCfg({ ...cfg, dataGateStrict: e.target.checked })}
            />
            <span>Data-gate estricto (no inventar cifras)</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Modelo</CardTitle></CardHeader>
        <CardContent>
          <Select value={cfg.model} onValueChange={(v) => setCfg({ ...cfg, model: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-sonnet-5">Claude Sonnet 5 (recomendado)</SelectItem>
              <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
              <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (más barato)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar configuración"}
      </Button>
    </div>
  );
}
```

> Escalamiento (chips editables) queda como mejora incremental posterior; por ahora los disparadores se muestran sólo vía el data-gate/toggle. `escalationTriggers`/`enabledChannels` se envían tal cual llegan en `initial` (no se pierden). No usar `window.location.reload()` (ver bug 2026-04-13).

- [ ] **Step 2: Añadir la pestaña "Bot" en `admin-content.tsx`**

En `src/components/admin/admin-content.tsx`:
- Importar: `import { BotConfigTab } from "./bot-config-tab";` y el icono `Bot` de lucide (`import { ..., Bot } from "lucide-react";`).
- Ampliar el tipo de props de `AdminContent` para recibir `botConfig` (misma forma que `BotConfigData`).
- Añadir un `<TabsTrigger value="bot">` en el `<TabsList>` y un `<TabsContent value="bot"><BotConfigTab initial={botConfig} /></TabsContent>`.

Ejemplo del bloque a insertar dentro del `<Tabs>`:
```tsx
<TabsTrigger value="bot"><Bot className="mr-2 h-4 w-4" />Bot</TabsTrigger>
...
<TabsContent value="bot">
  <BotConfigTab initial={botConfig} />
</TabsContent>
```

- [ ] **Step 3: Cargar la config en la página admin y pasarla al contenido**

En `src/app/(dashboard)/admin/page.tsx`:
- Importar `getBotConfigForAdmin` de `@/server/bot-config`.
- En el fetch server-side (donde ya se cargan usuarios/comisiones), añadir `const botConfig = await getBotConfigForAdmin();`.
- Pasar `botConfig={botConfig}` al `<AdminContent .../>`.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: "Compiled successfully" (sin errores de tipos en los archivos nuevos/editados).

- [ ] **Step 5: Verificación manual**

Run: `npm run dev` → abrir `/admin`, pestaña **Bot**. Verificar: cambiar el preset actualiza el preview con sus ejemplos; "Guardar" muestra toast sin recargar; recargar la página conserva el valor guardado.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/bot-config-tab.tsx src/components/admin/admin-content.tsx "src/app/(dashboard)/admin/page.tsx"
git commit -m "feat(bot): UI admin 'Configuración del Bot' con selector de tono + preview"
```

---

## Task 9: Eval de tono (`scripts/eval-bot-voice.ts`)

**Files:**
- Create: `scripts/eval-bot-voice.ts`

- [ ] **Step 1: Escribir el script completo**

`scripts/eval-bot-voice.ts`:
```ts
/**
 * Eval manual de tono del bot. Requiere ANTHROPIC_API_KEY. Cuesta unos centavos.
 * Uso: npx tsx scripts/eval-bot-voice.ts [--preset=PROFESIONAL_CALIDO]
 * Sin --preset corre los 4.
 */
import { buildSystemPrompt } from "../src/lib/bot/claude";
import { lintBrandVoice } from "../src/lib/bot/brand-linter";
import { DEFAULT_BOT_CONFIG } from "../src/lib/bot/config";
import { TONE_PRESETS } from "../src/lib/bot/tone-presets";
import type { BotTonePreset } from "@prisma/client";

const API_URL = "https://api.anthropic.com/v1/messages";
const contact = { firstName: "Juan", preferredLanguage: "ES" };

interface Scenario {
  name: string;
  messages: { role: "user" | "assistant"; content: string }[];
  catalog: any[];
  expectEscalate?: boolean;
  expectLang?: "ES" | "EN";
}

const SCENARIOS: Scenario[] = [
  { name: "apertura fría", messages: [{ role: "user", content: "Hola" }], catalog: [] },
  { name: "precio sin catálogo", messages: [{ role: "user", content: "¿Cuánto cuesta un depa en Tulum?" }], catalog: [] },
  { name: "calificar zona", messages: [{ role: "user", content: "Busco algo para invertir" }], catalog: [] },
  { name: "apartar (escala)", messages: [{ role: "user", content: "Quiero apartar hoy mismo" }], catalog: [], expectEscalate: true },
  { name: "queja (escala)", messages: [{ role: "user", content: "Tengo una queja del trato que recibí" }], catalog: [], expectEscalate: true },
  { name: "legal/fiscal (escala)", messages: [{ role: "user", content: "¿Qué impuestos pago como extranjero?" }], catalog: [], expectEscalate: true },
  { name: "inglés", messages: [{ role: "user", content: "Hi, do you have condos in Tulum?" }], catalog: [], expectLang: "EN" },
];

async function callClaude(system: string, messages: Scenario["messages"], model: string): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 300, system, thinking: { type: "disabled" }, messages }),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return (data.content?.find((b: any) => b.type === "text")?.text ?? "").trim();
}

async function judge(reply: string, model: string): Promise<{ score: number; reason: string }> {
  const rubric =
    "Evalúa esta respuesta de un asesor inmobiliario por WhatsApp. Puntúa 1-5 qué tan PROFESIONAL-CÁLIDA, humana, natural (no robótica) y libre de hype es. Devuelve SOLO JSON: {\"score\":n,\"reason\":\"...\"}.";
  const out = await callClaude(rubric, [{ role: "user", content: reply }], model);
  try {
    const j = JSON.parse(out.replace(/```json|```/g, "").trim());
    return { score: Number(j.score), reason: String(j.reason) };
  } catch {
    return { score: 0, reason: `no-parse: ${out.slice(0, 80)}` };
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY");
    process.exit(1);
  }
  const arg = process.argv.find((a) => a.startsWith("--preset="));
  const presets: BotTonePreset[] = arg
    ? [arg.split("=")[1] as BotTonePreset]
    : (Object.keys(TONE_PRESETS) as BotTonePreset[]);
  const model = process.env.BOT_MODEL?.trim() || "claude-sonnet-5";

  for (const preset of presets) {
    console.log(`\n===== PRESET: ${preset} =====`);
    for (const sc of SCENARIOS) {
      const system = buildSystemPrompt({ config: { ...DEFAULT_BOT_CONFIG, tonePreset: preset }, contact, catalog: sc.catalog });
      const reply = await callClaude(system, sc.messages, model);

      const lint = lintBrandVoice(reply);
      const hasEscalate = reply.includes("[ESCALAR]");
      const clean = reply.replace(/\[ESCALAR\]/g, "").trim();
      const invented = sc.catalog.length === 0 && /\$|MXN|USD/.test(clean);
      const gates: string[] = [];
      if (!lint.ok) gates.push(`linter:${lint.violations.join("|")}`);
      if (sc.expectEscalate && !hasEscalate) gates.push("falta[ESCALAR]");
      if (!sc.expectEscalate && hasEscalate) gates.push("escaló de más");
      if (invented) gates.push("cifra inventada sin catálogo");

      const j = await judge(clean, model);
      const verdict = gates.length === 0 ? "PASS" : `FAIL(${gates.join(", ")})`;
      console.log(`\n[${sc.name}] tono=${j.score}/5 ${verdict}`);
      console.log(`  → ${clean.replace(/\n/g, " ")}`);
      console.log(`  judge: ${j.reason}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Verificación estructural (sin API)**

Run: `npx tsc --noEmit`
Expected: sin errores en `scripts/eval-bot-voice.ts`.

- [ ] **Step 3: Ejecución real (opcional, requiere API key)**

Run: `npx tsx scripts/eval-bot-voice.ts --preset=PROFESIONAL_CALIDO`
Expected: reporte con score ≥ 4/5 en la mayoría de escenarios y `PASS` en los gates (escalamiento en apartar/queja/legal, EN en inglés, sin cifras inventadas).

- [ ] **Step 4: Commit**

```bash
git add scripts/eval-bot-voice.ts
git commit -m "feat(bot): eval de tono (gates + LLM-judge) por preset"
```

---

## Task 10: Handoff a Luis + smoke

**Files:** ninguno (pasos manuales)

- [ ] **Step 1: Correr toda la suite**

Run: `npm test`
Expected: verde (incluye los nuevos tests + los existentes de bot).

- [ ] **Step 2: Instrucciones para Luis (aplicar migración)**

Entregar a Luis:
1. Aplicar `prisma/migrations-manual/2026-07-10-botconfig.sql` en el SQL Editor de Supabase (verificar antes el `@@map` real de `User`).
2. Confirmar `ANTHROPIC_API_KEY` presente en Hostinger (si no, el bot cae al fallback sin API y no responde).
3. `BOT_MODEL` opcional en env (default `claude-sonnet-5`).

- [ ] **Step 3: Smoke post-migración**

- En `/admin` → pestaña **Bot**: cambiar tono a "Ejecutivo-sobrio", guardar, recargar → persiste.
- Correr `npx tsx scripts/eval-bot-voice.ts` y revisar scores/gates.
- Volver el tono a "Profesional-cálido".

- [ ] **Step 4: Actualizar memoria (al cierre, según CLAUDE.md global)**

Registrar en `project_propyte_crm.md` (Changelog): motor de bot configurable + tono elegible (Sub-proyecto A) implementado; pendiente Sub-proyecto B (playbook de calificación). Archivos y decisiones clave.

---

## Self-Review (cobertura del spec)

- §3 4 capas → Task 4 (`buildSystemPrompt`). ✅
- §5 modelo `BotConfig` singleton → Task 1. ✅
- §6 presets curados → Task 2. ✅
- §7 builder + model/thinking → Tasks 4, 5. ✅
- §8 runtime (master switch, canales, arranque, maxLines) → Task 6. ✅
- §9 server fns + auditoría → Task 7. ✅
- §10 UI admin con preview → Task 8. ✅
- §11 eval (gates + LLM-judge) → Task 9. ✅
- §12 migración aditiva aplicada por Luis → Tasks 1, 10. ✅
- §13 criterios de aceptación → cubiertos por Tasks 4–9 + smoke Task 10. ✅
- §14 gancho `objective` para B → Task 4 (parámetro `objective`), verificado en test. ✅

Consistencia de nombres verificada: `BotConfigResolved`, `getBotConfig`/`invalidateBotConfigCache`, `resolveBotConfig`, `buildSystemPrompt`, `buildClaudeRequestBody`/`thinkingFieldFor`, `shouldBotRespondForChannel`/`buildOpener`, `botConfigUpdateSchema`/`updateBotConfig`, `TONE_PRESETS`/`getTonePreset` — usados igual en todas las tasks.
```
