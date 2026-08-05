# Reglas de comentarios sociales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un comentario en Instagram o Facebook con una palabra clave configurable dispare una respuesta pública y un DM privado, y que ese DM continúe con el bot Sage en el Inbox del CRM.

**Architecture:** Modelo propio (`CommentRule` + `CommentRuleLog`) y motor aislado en `src/lib/comments/`. El webhook `/api/webhooks/meta-dm` que ya existe se bifurca por forma del payload: `entry[].messaging` sigue al camino DM intacto, `entry[].changes` (campos `feed` y `comments`) va al motor nuevo. Los tokens salen de `LeadConnector` cifrado. UI nueva en Admin → Comentarios.

**Tech Stack:** Next.js 14 (App Router), Prisma + Postgres/Supabase (schema `propyte_crm`), Zod, Vitest, Meta Graph API v24.0, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-04-reglas-comentarios-sociales-design.md`
**Rama:** `feat/comment-rules-social` (ya creada)

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` | +2 modelos, +2 enums, +2 relaciones inversas |
| `prisma/migrations-manual/2026-08-04-comment-rules.sql` | Migración additiva idempotente (**la aplica Luis**) |
| `src/lib/comments/template.ts` | `renderTemplate` y `pickVariant` — paridad runtime/probador |
| `src/lib/comments/match.ts` | Normalización y selección de regla (pura) |
| `src/lib/comments/parse.ts` | Payload de Meta → `IncomingComment` (pura) |
| `src/lib/comments/graph.ts` | Respuesta pública y private reply |
| `src/lib/comments/handle-comment.ts` | Orquestación: descartes, idempotencia, cuota, acciones, log |
| `src/lib/comments/link-comment-origin.ts` | Puente comentario → contacto y opener en el hilo |
| `src/app/api/webhooks/meta-dm/route.ts` | Bifurcación (modificar) |
| `src/lib/messaging/core.ts` | Hook a `linkCommentOrigin` (modificar) |
| `src/server/comment-rules.schema.ts` | Zod de alta y edición |
| `src/app/api/admin/comment-rules/route.ts` | GET, POST |
| `src/app/api/admin/comment-rules/[id]/route.ts` | PATCH, DELETE |
| `src/app/api/admin/comment-rules/logs/route.ts` | GET del log |
| `src/app/api/admin/comment-rules/logs/[id]/retry/route.ts` | POST reintento |
| `src/app/api/admin/comment-rules/test/route.ts` | POST dry-run |
| `src/components/admin/comments/comment-rules-tab.tsx` | Orquestador de la pestaña |
| `src/components/admin/comments/comment-rule-dialog.tsx` | Alta y edición |
| `src/components/admin/comments/comment-rule-tester.tsx` | Probador en seco |
| `src/components/admin/comments/comment-rule-logs.tsx` | Log con filtros y reintento |
| `src/components/admin/admin-content.tsx` | Registrar la pestaña (modificar) |
| `src/components/config/config-center.tsx` | Tarjeta de acceso (modificar) |
| `docs/qa/comment-rules-smoke.md` | Checklist E2E + gate de infra |

Los cuatro componentes de UI viven en `src/components/admin/comments/` en vez de un solo archivo grande: la pestaña orquesta, el diálogo edita, el probador prueba y el log lista. Cada uno se entiende sin leer los otros.

---

## Task 1: Esquema Prisma y migración manual

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations-manual/2026-08-04-comment-rules.sql`

- [ ] **Step 1: Agregar los enums y modelos al final de `prisma/schema.prisma`**

```prisma
enum CommentPlatform {
  INSTAGRAM
  FACEBOOK

  @@schema("propyte_crm")
}

enum CommentActionStatus {
  PENDING
  SENT
  FAILED
  SKIPPED

  @@schema("propyte_crm")
}

model CommentRule {
  id            String   @id @default(uuid())
  name          String
  connectorId   String
  isActive      Boolean  @default(false)
  priority      Int      @default(100)
  phrases       String[]
  publicReplies String[]
  dmTemplate    String   @db.Text
  postFilter    String[] @default([])

  connector LeadConnector    @relation(fields: [connectorId], references: [id])
  logs      CommentRuleLog[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@unique([connectorId, name])
  @@index([connectorId, isActive, priority])
  @@map("comment_rules")
  @@schema("propyte_crm")
}

model CommentRuleLog {
  id                  String              @id @default(uuid())
  ruleId              String?
  connectorId         String
  platform            CommentPlatform
  externalCommentId   String              @unique
  postId              String
  authorId            String
  authorHandle        String?
  commentText         String              @db.Text
  matchedPhrase       String
  publicReplyStatus   CommentActionStatus @default(PENDING)
  publicReplyError    String?
  publicReplyId       String?
  publicText          String?             @db.Text
  dmStatus            CommentActionStatus @default(PENDING)
  dmError             String?
  dmText              String?             @db.Text
  dmRecipientId       String?
  dmExternalMessageId String?
  contactId           String?

  rule    CommentRule? @relation(fields: [ruleId], references: [id], onDelete: SetNull)
  contact Contact?     @relation(fields: [contactId], references: [id])

  createdAt DateTime @default(now())

  @@index([connectorId, postId, authorId])
  @@index([dmRecipientId])
  @@index([ruleId, createdAt])
  @@index([ruleId, publicReplyStatus])
  @@index([createdAt])
  @@map("comment_rule_logs")
  @@schema("propyte_crm")
}
```

`(ruleId, publicReplyStatus)` cubre el `count({ where: { ruleId, publicReplyStatus: "SENT" } })` del camino caliente de rotación de variante pública (Task 6 y Task 10). `(createdAt)` solo cubre el sort de `GET /api/admin/comment-rules/logs` cuando `ruleId` no viene en el filtro (primera vista del admin).

- [ ] **Step 2: Agregar las relaciones inversas (Prisma exige los dos lados)**

En `model LeadConnector`, junto a `conversations Conversation[]`:

```prisma
  commentRules CommentRule[]
```

En `model Contact`, junto a `messages Message[]`:

```prisma
  commentLogs CommentRuleLog[]
```

- [ ] **Step 3: Validar el esquema**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 4: Regenerar el cliente**

Run: `npx prisma generate --no-engine`
Expected: `Generated Prisma Client`. Sin el `--no-engine` el postinstall descarga engines innecesarios.

- [ ] **Step 5: Escribir la migración manual**

Crear `prisma/migrations-manual/2026-08-04-comment-rules.sql`:

```sql
-- Reglas de comentarios sociales (Instagram + Facebook)
-- Spec: docs/superpowers/specs/2026-08-04-reglas-comentarios-sociales-design.md
-- Aditiva e idempotente. Aplicar vía execute_sql a oaijxdpevakashxshhvm (schema propyte_crm).
--
-- Rollback:
--   DROP TABLE IF EXISTS "propyte_crm"."comment_rule_logs";
--   DROP TABLE IF EXISTS "propyte_crm"."comment_rules";
--   DROP TYPE  IF EXISTS "propyte_crm"."CommentActionStatus";
--   DROP TYPE  IF EXISTS "propyte_crm"."CommentPlatform";

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."CommentPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "propyte_crm"."CommentActionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "propyte_crm"."comment_rules" (
  "id"            TEXT PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "connectorId"   TEXT NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT false,
  "priority"      INTEGER NOT NULL DEFAULT 100,
  "phrases"       TEXT[] NOT NULL,
  "publicReplies" TEXT[] NOT NULL,
  "dmTemplate"    TEXT NOT NULL,
  "postFilter"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"     TIMESTAMP(3)
);

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."comment_rules"
    ADD CONSTRAINT "comment_rules_connectorId_fkey"
    FOREIGN KEY ("connectorId") REFERENCES "propyte_crm"."lead_connectors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "comment_rules_connectorId_name_key"
  ON "propyte_crm"."comment_rules"("connectorId", "name");
CREATE INDEX IF NOT EXISTS "comment_rules_connectorId_isActive_priority_idx"
  ON "propyte_crm"."comment_rules"("connectorId", "isActive", "priority");

CREATE TABLE IF NOT EXISTS "propyte_crm"."comment_rule_logs" (
  "id"                  TEXT PRIMARY KEY,
  "ruleId"              TEXT,
  "connectorId"         TEXT NOT NULL,
  "platform"            "propyte_crm"."CommentPlatform" NOT NULL,
  "externalCommentId"   TEXT NOT NULL,
  "postId"              TEXT NOT NULL,
  "authorId"            TEXT NOT NULL,
  "authorHandle"        TEXT,
  "commentText"         TEXT NOT NULL,
  "matchedPhrase"       TEXT NOT NULL,
  "publicReplyStatus"   "propyte_crm"."CommentActionStatus" NOT NULL DEFAULT 'PENDING',
  "publicReplyError"    TEXT,
  "publicReplyId"       TEXT,
  "publicText"          TEXT,
  "dmStatus"            "propyte_crm"."CommentActionStatus" NOT NULL DEFAULT 'PENDING',
  "dmError"             TEXT,
  "dmText"              TEXT,
  "dmRecipientId"       TEXT,
  "dmExternalMessageId" TEXT,
  "contactId"           TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."comment_rule_logs"
    ADD CONSTRAINT "comment_rule_logs_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "propyte_crm"."comment_rules"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "propyte_crm"."comment_rule_logs"
    ADD CONSTRAINT "comment_rule_logs_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "propyte_crm"."contacts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "comment_rule_logs_externalCommentId_key"
  ON "propyte_crm"."comment_rule_logs"("externalCommentId");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_connectorId_postId_authorId_idx"
  ON "propyte_crm"."comment_rule_logs"("connectorId", "postId", "authorId");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_dmRecipientId_idx"
  ON "propyte_crm"."comment_rule_logs"("dmRecipientId");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_ruleId_createdAt_idx"
  ON "propyte_crm"."comment_rule_logs"("ruleId", "createdAt");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_ruleId_publicReplyStatus_idx"
  ON "propyte_crm"."comment_rule_logs"("ruleId", "publicReplyStatus");
CREATE INDEX IF NOT EXISTS "comment_rule_logs_createdAt_idx"
  ON "propyte_crm"."comment_rule_logs"("createdAt");
```

`phrases` y `publicReplies` no llevan `DEFAULT` a propósito: en Prisma no tienen `@default([])`, así que siguen siendo obligatorios en el tipo generado y no se puede crear una regla sin frases ni sin respuesta pública. `postFilter` sí conserva `DEFAULT ARRAY[]::TEXT[]` porque en Prisma tiene `@default([])`.

**NO ejecutar esta migración.** La Supabase `oaijxdpevakashxshhvm` es compartida con el Hub y la aplica Luis. El código de las tareas siguientes tolera que las tablas no existan todavía (ver Task 9, Step 5).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-08-04-comment-rules.sql
git commit -m "feat(comments): modelos CommentRule/CommentRuleLog + migracion manual"
```

---

## Task 2: `template.ts` — render de plantillas y rotación de variantes

Vive aparte porque lo usan dos consumidores que **deben coincidir**: el motor en producción y el probador en seco de la UI. Si la rotación se calculara en dos lados, el probador mentiría.

**Files:**
- Create: `src/lib/comments/template.ts`
- Test: `src/lib/comments/template.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { renderTemplate, pickVariant } from "./template";

describe("renderTemplate", () => {
  it("sustituye {{usuario}}", () => {
    expect(renderTemplate("Hola {{usuario}}, te mando info", { usuario: "luisf" }))
      .toBe("Hola luisf, te mando info");
  });

  it("tolera espacios dentro de las llaves y repeticiones", () => {
    expect(renderTemplate("{{ usuario }} y {{usuario}}", { usuario: "ana" })).toBe("ana y ana");
  });

  it("sin usuario deja la frase legible, no la palabra 'undefined'", () => {
    expect(renderTemplate("Hola {{usuario}}, gracias", { usuario: null })).toBe("Hola, gracias");
  });

  it("deja intactas las variables que no conoce", () => {
    expect(renderTemplate("Hola {{otra}}", { usuario: "x" })).toBe("Hola {{otra}}");
  });

  it("no interpreta patrones de reemplazo especiales en el usuario ($&)", () => {
    expect(renderTemplate("Hola {{usuario}}, gracias", { usuario: "$&" })).toBe("Hola $&, gracias");
  });

  it("no interpreta patrones de reemplazo especiales en el usuario ($`)", () => {
    expect(renderTemplate("{{usuario}} y {{usuario}}", { usuario: "$`" })).toBe("$` y $`");
  });

  it("sin usuario y placeholder al inicio no deja coma colgante", () => {
    expect(renderTemplate("{{usuario}}, bienvenido a Propyte!", { usuario: null }))
      .toBe("bienvenido a Propyte!");
  });

  it("sin usuario, multilinea: conserva la sangria intencional de otros parrafos", () => {
    expect(renderTemplate("Hola {{usuario}},\n\n  Gracias por tu comentario.", { usuario: null }))
      .toBe("Hola,\n\n  Gracias por tu comentario.");
  });

  it("sin usuario, placeholder solo en la primera linea: no deja lineas en blanco al inicio", () => {
    expect(renderTemplate("{{usuario}}\n\nSegunda linea", { usuario: null }))
      .toBe("Segunda linea");
  });

  it("con usuario, multilinea: solo sustituye el nombre, conserva el espaciado intencional", () => {
    expect(renderTemplate("Hola {{usuario}},\n\n  Gracias por tu comentario.", { usuario: "ana" }))
      .toBe("Hola ana,\n\n  Gracias por tu comentario.");
  });
});

describe("pickVariant", () => {
  it("rota en orden según los disparos previos", () => {
    const v = ["a", "b", "c"];
    expect(pickVariant(v, 0)).toBe("a");
    expect(pickVariant(v, 1)).toBe("b");
    expect(pickVariant(v, 3)).toBe("a");
  });

  it("con una sola variante siempre devuelve esa", () => {
    expect(pickVariant(["solo"], 7)).toBe("solo");
  });

  it("lista vacía devuelve null", () => {
    expect(pickVariant([], 0)).toBeNull();
  });

  it("firedCount no entero (NaN) devuelve null, no undefined", () => {
    expect(pickVariant(["a", "b"], NaN)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/comments/template.test.ts`
Expected: FAIL — `Failed to resolve import "./template"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/comments/template.ts
// Render de plantillas y rotación de variantes. Compartido por el motor
// (handle-comment) y el probador en seco de la UI, para que lo que el probador
// muestra sea literalmente lo que saldría.

export interface TemplateVars {
  usuario: string | null;
}

/**
 * Sustituye {{usuario}} (con o sin espacios). `usuario` viene de `from.name`
 * de Facebook/Instagram, un display name sin restricción de caracteres: usar
 * función de reemplazo, no string, para que `$&`, `` $` ``, `$'`, `$$`, `$N`
 * no se interpreten como patrones especiales de `String.replace`.
 *
 * Si no hay usuario, quita el placeholder y limpia SOLO su vecindad inmediata
 * (coma/espacio antes, o puntuación al inicio de la línea): "Hola , gracias"
 * o ", bienvenido!" se ven mal y se publican en un post real. La limpieza no
 * toca el resto del template porque el DM es un textarea multilínea: otros
 * párrafos pueden traer sangría o espaciado intencional que no hay que tocar.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const usuario = vars.usuario?.trim();
  if (usuario) {
    return template.replace(/\{\{\s*usuario\s*\}\}/g, () => usuario);
  }
  // Sin usuario: se limpia SOLO alrededor del placeholder, no el resto del texto
  // (un DM puede traer sangría o espaciado intencional en otros párrafos).
  return template
    // Al inicio del texto o de una línea: se lleva la puntuación y el espacio que le siguen,
    // para no dejar ", bienvenido" colgando.
    .replace(/(^|\n)[ \t]*\{\{\s*usuario\s*\}\}[ \t]*[,;:]?[ \t]*/g, "$1")
    // En medio de una frase: se lleva el espacio que lo precede y conserva lo que sigue,
    // para que "Hola {{usuario}}, gracias" quede "Hola, gracias".
    .replace(/[ \t]*\{\{\s*usuario\s*\}\}/g, "")
    // Saludo vacío al principio: no dejar el texto arrancando con líneas en blanco.
    .replace(/^\n+/, "");
}

/** Variante que corresponde según cuántas veces ya disparó la regla. */
export function pickVariant(variants: string[], firedCount: number): string | null {
  if (!Number.isInteger(firedCount)) return null;
  if (variants.length === 0) return null;
  const index = ((firedCount % variants.length) + variants.length) % variants.length;
  return variants[index];
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/comments/template.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/comments/template.ts src/lib/comments/template.test.ts
git commit -m "feat(comments): render de plantillas y rotacion de variantes"
```

---

## Task 3: `match.ts` — normalización y selección de regla

**Files:**
- Create: `src/lib/comments/match.ts`
- Test: `src/lib/comments/match.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { normalize, containsPhrase, matchRule, type CommentRuleLike } from "./match";

function rule(over: Partial<CommentRuleLike> = {}): CommentRuleLike {
  return {
    id: "r1",
    priority: 100,
    phrases: ["info"],
    postFilter: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("normalize", () => {
  it("baja a minúsculas, quita acentos y colapsa espacios", () => {
    expect(normalize("  QUIERO   Información ÁÉÍ  ")).toBe("quiero informacion aei");
  });
});

describe("containsPhrase", () => {
  it("acepta la palabra con puntuación, emoji o mayúsculas alrededor", () => {
    for (const text of ["info", "Info!!", "¿info?", "info 🙏", "mas info por favor", "info,"]) {
      expect(containsPhrase(normalize(text), "info"), text).toBe(true);
    }
  });

  it("NO dispara cuando la palabra está dentro de otra", () => {
    for (const text of ["informal", "información", "reinfo", "infowars"]) {
      expect(containsPhrase(normalize(text), "info"), text).toBe(false);
    }
  });

  it("frase de varias palabras funciona con límites en los extremos", () => {
    expect(containsPhrase(normalize("Hola, QUIERO INFO ya"), "quiero info")).toBe(true);
    expect(containsPhrase(normalize("quiero informacion"), "quiero info")).toBe(false);
  });

  it("frase vacía nunca dispara", () => {
    expect(containsPhrase("info", "")).toBe(false);
  });

  it("no interpreta la frase como regex", () => {
    expect(containsPhrase(normalize("precio (2 recamaras)"), "(2 recamaras)")).toBe(true);
  });
});

describe("matchRule", () => {
  it("devuelve la regla y la frase que coincidió", () => {
    const out = matchRule([rule({ phrases: ["precios", "info"] })], "mándame INFO", "POST-1");
    expect(out).toEqual({ rule: expect.objectContaining({ id: "r1" }), phrase: "info" });
  });

  it("sin coincidencia devuelve null", () => {
    expect(matchRule([rule()], "qué bonito", "POST-1")).toBeNull();
  });

  it("gana la de menor priority", () => {
    const out = matchRule(
      [rule({ id: "baja", priority: 100 }), rule({ id: "alta", priority: 10 })],
      "info",
      "POST-1"
    );
    expect(out?.rule.id).toBe("alta");
  });

  it("con igual priority gana la más antigua", () => {
    const out = matchRule(
      [
        rule({ id: "nueva", createdAt: new Date("2026-06-01T00:00:00Z") }),
        rule({ id: "vieja", createdAt: new Date("2026-01-01T00:00:00Z") }),
      ],
      "info",
      "POST-1"
    );
    expect(out?.rule.id).toBe("vieja");
  });

  it("postFilter vacío aplica a toda la cuenta", () => {
    expect(matchRule([rule({ postFilter: [] })], "info", "CUALQUIERA")).not.toBeNull();
  });

  it("postFilter con IDs solo aplica a esas publicaciones", () => {
    const rules = [rule({ postFilter: ["POST-A"] })];
    expect(matchRule(rules, "info", "POST-A")).not.toBeNull();
    expect(matchRule(rules, "info", "POST-B")).toBeNull();
  });

  it("no muta el arreglo de reglas que recibe", () => {
    const rules = [rule({ id: "b", priority: 200 }), rule({ id: "a", priority: 1 })];
    matchRule(rules, "info", "POST-1");
    expect(rules.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("empate total en priority y createdAt: gana el id menor, sin importar el orden de entrada", () => {
    const a = rule({ id: "a" });
    const b = rule({ id: "b" });
    expect(matchRule([b, a], "info", "POST-1")?.rule.id).toBe("a");
    expect(matchRule([a, b], "info", "POST-1")?.rule.id).toBe("a");
  });

  it("genérico: preserva el tipo completo de la regla recibida, sin castear", () => {
    const withExtra = [{ ...rule(), dmTemplate: "x" }];
    const out = matchRule(withExtra, "info", "POST-1");
    expect(out?.rule.dmTemplate).toBe("x");
  });
});
```

Además, dentro de `describe("containsPhrase", ...)`, dos casos que fijan que `_` cuenta como carácter de palabra (menciones y hashtags compuestos no deben disparar, hashtag simple y mención con espacio sí):

```ts
  it("el guion bajo cuenta como carácter de palabra: NO dispara en mención ni hashtag compuesto", () => {
    expect(containsPhrase(normalize("@promo_info"), "info")).toBe(false);
    expect(containsPhrase(normalize("#info_venta"), "info")).toBe(false);
    expect(containsPhrase(normalize("mi_info_x"), "info")).toBe(false);
  });

  it("sigue disparando con hashtag simple y mención seguida de espacio", () => {
    expect(containsPhrase(normalize("#info"), "info")).toBe(true);
    expect(containsPhrase(normalize("@juan info?"), "info")).toBe(true);
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/comments/match.test.ts`
Expected: FAIL — `Failed to resolve import "./match"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/comments/match.ts
// Matcher de reglas de comentarios. Función pura: sin Prisma, sin fetch, sin
// Date.now(). Todo lo que decide "esta regla gana" vive aquí y se prueba solo.

export interface CommentRuleLike {
  id: string;
  priority: number;
  phrases: string[];
  postFilter: string[];
  createdAt: Date;
}

export interface MatchResult<T extends CommentRuleLike = CommentRuleLike> {
  rule: T;
  phrase: string;
}

/** Minúsculas, sin diacríticos, espacios colapsados. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Palabra completa: el carácter pegado a cada extremo no puede ser letra ni
 * dígito ni guion bajo (`_` cuenta como carácter de palabra, igual que en
 * `\w`). Así "info" dispara con "¿info?" y "info 🙏" pero NO con "informal",
 * "información", "@promo_info" (mención de otra cuenta) ni "#info_venta"
 * (hashtag compuesto) — el falso positivo que publicaría una respuesta a
 * quien no pidió información. Espera `text` ya normalizado; normaliza
 * `phrase` por su cuenta.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const needle = normalize(phrase);
  if (!needle) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])`, "u");
  return re.test(text);
}

/**
 * Primera regla que coincide gana: orden por priority asc, luego antigüedad,
 * y por último `id` — desempate determinista cuando `priority` y `createdAt`
 * coinciden y el orden de llegada de Prisma no está garantizado sin `orderBy`.
 * Las demás no se evalúan (una respuesta por comentario, nunca dos).
 * Genérico en `T`: el consumidor recibe de vuelta el objeto completo que pasó
 * (p. ej. el `CommentRule` de Prisma con todos sus campos), sin tener que
 * volver a buscarlo por id.
 */
export function matchRule<T extends CommentRuleLike>(
  rules: T[],
  commentText: string,
  postId: string
): MatchResult<T> | null {
  const text = normalize(commentText);
  if (!text) return null;

  const ordered = [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );

  for (const rule of ordered) {
    if (rule.postFilter.length > 0 && !rule.postFilter.includes(postId)) continue;
    for (const phrase of rule.phrases) {
      if (containsPhrase(text, phrase)) return { rule, phrase };
    }
  }
  return null;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/comments/match.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/comments/match.ts src/lib/comments/match.test.ts
git commit -m "feat(comments): matcher de palabra completa sin acentos"
```

---

## Task 4: `parse.ts` — payload de Meta a `IncomingComment`

Dos formas distintas de payload que Meta manda al **mismo** endpoint. El detalle que se presta a error: en Facebook, un comentario de primer nivel trae `parent_id` **igual al `post_id`**; solo es respuesta anidada si difieren. En Instagram, `parent_id` solo aparece en respuestas.

`parseCommentWebhook` devuelve `{ comments, discarded }` en vez de solo el arreglo: sin esto, un payload que SÍ era un comentario pero le faltaba un campo obligatorio se perdía exactamente igual que un payload que nunca fue un comentario (DM, `field` desconocido, `verb: "edited"`). El caso real de producción es Facebook sin `from` — Meta lo omite cuando el comentarista bloqueó la Página, cuando falta el permiso `pages_read_engagement`, o cuando la cuenta fue borrada — y ese comentario de un cliente real se caía sin dejar rastro, sin nunca llegar a crear un `CommentRuleLog`. `discarded` no rompe la pureza de la función (sigue sin loguear ni escribir); es la Task 8 la que emite el `console.warn` por cada elemento.

**Files:**
- Create: `src/lib/comments/parse.ts`
- Test: `src/lib/comments/parse.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { parseCommentWebhook } from "./parse";

const igComment = {
  object: "instagram",
  entry: [
    {
      id: "17841453458089530",
      time: 1754300000,
      changes: [
        {
          field: "comments",
          value: {
            id: "IGCOMMENT-1",
            text: "info porfa",
            from: { id: "IGSID-1", username: "luisf" },
            media: { id: "MEDIA-1", media_product_type: "FEED" },
          },
        },
      ],
    },
  ],
};

const fbComment = {
  object: "page",
  entry: [
    {
      id: "PAGE-1",
      time: 1754300000,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "PAGE-1_COMMENT-1",
            post_id: "PAGE-1_POST-1",
            parent_id: "PAGE-1_POST-1",
            from: { id: "ASID-1", name: "Luis Flores" },
            message: "info",
            created_time: 1754300000,
          },
        },
      ],
    },
  ],
};

describe("parseCommentWebhook", () => {
  it("extrae el comentario de Instagram", () => {
    expect(parseCommentWebhook(igComment).comments).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: "IGCOMMENT-1",
        postId: "MEDIA-1",
        authorId: "IGSID-1",
        authorHandle: "luisf",
        text: "info porfa",
        isNested: false,
      },
    ]);
  });

  it("extrae el comentario de Facebook y usa from.name como handle", () => {
    expect(parseCommentWebhook(fbComment).comments).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: "PAGE-1_COMMENT-1",
        postId: "PAGE-1_POST-1",
        authorId: "ASID-1",
        authorHandle: "Luis Flores",
        text: "info",
        isNested: false,
      },
    ]);
  });

  it("Facebook: parent_id == post_id es primer nivel, distinto es anidado", () => {
    const nested = structuredClone(fbComment);
    nested.entry[0].changes[0].value.parent_id = "PAGE-1_COMMENT-OTRO";
    expect(parseCommentWebhook(nested).comments[0].isNested).toBe(true);
  });

  it("Instagram: parent_id presente es anidado", () => {
    const nested = structuredClone(igComment) as typeof igComment & {
      entry: Array<{ changes: Array<{ value: Record<string, unknown> }> }>;
    };
    nested.entry[0].changes[0].value.parent_id = "IGCOMMENT-PADRE";
    expect(parseCommentWebhook(nested).comments[0].isNested).toBe(true);
  });

  it("ignora verbos que no son 'add' (ediciones y borrados): cero comentarios y cero descartes", () => {
    for (const verb of ["edited", "remove", "hide"]) {
      const other = structuredClone(fbComment);
      other.entry[0].changes[0].value.verb = verb;
      const result = parseCommentWebhook(other);
      expect(result.comments, verb).toEqual([]);
      expect(result.discarded, verb).toEqual([]);
    }
  });

  it("ignora items de feed que no son comentarios (item !== 'comment'): cero y cero", () => {
    const post = structuredClone(fbComment);
    post.entry[0].changes[0].value.item = "reaction";
    const result = parseCommentWebhook(post);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([]);
  });

  it("field desconocido (reactions) no es un comentario: cero y cero", () => {
    const other = structuredClone(fbComment);
    other.entry[0].changes[0].field = "reactions";
    const result = parseCommentWebhook(other);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([]);
  });

  it("ignora el payload de mensajes (entry[].messaging) sin lanzar y sin descartes", () => {
    const dm = {
      object: "instagram",
      entry: [{ id: "1", messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "hola" } }] }],
    };
    const result = parseCommentWebhook(dm);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([]);
  });

  it("comentario de Facebook sin texto (solo sticker) se descarta con reason 'sin-texto'", () => {
    const sinTexto = structuredClone(fbComment);
    delete (sinTexto.entry[0].changes[0].value as Record<string, unknown>).message;
    const result = parseCommentWebhook(sinTexto);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: "PAGE-1_COMMENT-1",
        reason: "sin-texto",
      },
    ]);
  });

  it("objetos desconocidos y basura devuelven vacío sin descartes", () => {
    expect(parseCommentWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual({
      comments: [],
      discarded: [],
    });
    expect(parseCommentWebhook(null)).toEqual({ comments: [], discarded: [] });
    expect(parseCommentWebhook({})).toEqual({ comments: [], discarded: [] });
  });

  it("procesa varios cambios en un solo entry", () => {
    const dos = structuredClone(igComment);
    dos.entry[0].changes.push({
      field: "comments",
      value: {
        id: "IGCOMMENT-2",
        text: "precio?",
        from: { id: "IGSID-2", username: "ana" },
        media: { id: "MEDIA-1", media_product_type: "FEED" },
      },
    });
    expect(parseCommentWebhook(dos).comments.map((c) => c.externalCommentId)).toEqual([
      "IGCOMMENT-1",
      "IGCOMMENT-2",
    ]);
  });

  // --- Descartes: era un comentario y le faltó un campo obligatorio ---
  // Caso real de producción: Meta omite `from` cuando el comentarista bloqueó
  // la Página, cuando falta `pages_read_engagement`, o cuando la cuenta fue
  // borrada. Sin `discarded` ese comentario se perdía sin dejar rastro.

  it("Facebook sin 'from' se descarta con reason 'sin-autor'", () => {
    const sinAutor = structuredClone(fbComment);
    delete (sinAutor.entry[0].changes[0].value as Record<string, unknown>).from;
    const result = parseCommentWebhook(sinAutor);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: "PAGE-1_COMMENT-1",
        reason: "sin-autor",
      },
    ]);
  });

  it("Instagram sin 'from' se descarta con reason 'sin-autor'", () => {
    const sinAutor = structuredClone(igComment);
    delete (sinAutor.entry[0].changes[0].value as Record<string, unknown>).from;
    const result = parseCommentWebhook(sinAutor);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: "IGCOMMENT-1",
        reason: "sin-autor",
      },
    ]);
  });

  it("Instagram sin 'media' se descarta con reason 'sin-publicacion'", () => {
    const sinMedia = structuredClone(igComment);
    delete (sinMedia.entry[0].changes[0].value as Record<string, unknown>).media;
    const result = parseCommentWebhook(sinMedia);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: "IGCOMMENT-1",
        reason: "sin-publicacion",
      },
    ]);
  });

  it("Facebook sin 'comment_id' se descarta con reason 'sin-id' y externalCommentId null", () => {
    const sinId = structuredClone(fbComment);
    delete (sinId.entry[0].changes[0].value as Record<string, unknown>).comment_id;
    const result = parseCommentWebhook(sinId);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: null,
        reason: "sin-id",
      },
    ]);
  });

  it("Instagram sin 'id' se descarta con reason 'sin-id' y externalCommentId null", () => {
    const sinId = structuredClone(igComment);
    delete (sinId.entry[0].changes[0].value as Record<string, unknown>).id;
    const result = parseCommentWebhook(sinId);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: null,
        reason: "sin-id",
      },
    ]);
  });

  it("precedencia: falta 'from' y 'message' reporta 'sin-autor', no 'sin-texto'", () => {
    const sinAmbos = structuredClone(fbComment);
    const value = sinAmbos.entry[0].changes[0].value as Record<string, unknown>;
    delete value.from;
    delete value.message;
    const result = parseCommentWebhook(sinAmbos);
    expect(result.discarded).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: "PAGE-1_COMMENT-1",
        reason: "sin-autor",
      },
    ]);
  });

  it("un batch con un comentario válido y otro sin 'from' devuelve uno en comments y uno en discarded", () => {
    const batch = structuredClone(igComment);
    batch.entry[0].changes.push({
      field: "comments",
      value: {
        id: "IGCOMMENT-2",
        text: "precio?",
        from: { id: "IGSID-2", username: "ana" },
        media: { id: "MEDIA-1", media_product_type: "FEED" },
      },
    });
    delete (batch.entry[0].changes[1].value as Record<string, unknown>).from;

    const result = parseCommentWebhook(batch);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].externalCommentId).toBe("IGCOMMENT-1");
    expect(result.discarded).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: "IGCOMMENT-2",
        reason: "sin-autor",
      },
    ]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/comments/parse.test.ts`
Expected: FAIL — `Failed to resolve import "./parse"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/comments/parse.ts
// Payload de comentarios de Meta → forma normalizada. Función pura.
//
// Instagram (object "instagram", field "comments"):
//   value = { id, text, from:{id, username}, media:{id}, parent_id? }
// Facebook (object "page", field "feed"):
//   value = { item, verb, comment_id, post_id, parent_id, from:{id, name}, message }
//
// OJO Facebook: en un comentario de primer nivel `parent_id` viene IGUAL al
// `post_id`. Solo es respuesta anidada cuando difieren.
//
// Este mismo endpoint recibe también el payload de DMs (entry[].messaging),
// porque Meta solo permite una callback URL por objeto. Por eso todo aquí es
// defensivo: nunca lanza, y cualquier forma que no reconozca se ignora en
// silencio (no es un descarte: nunca fue un comentario).
//
// `discarded`: cuando SÍ era un comentario (pasó el gate de object/field, y en
// Facebook además item==="comment" && verb==="add") pero le faltó un campo
// obligatorio. Caso real de producción: Meta omite `from` cuando el
// comentarista bloqueó la Página, cuando falta el permiso
// `pages_read_engagement`, o cuando la cuenta fue borrada. Sin esto, ese
// comentario se perdía sin dejar rastro — nunca llegaba a crear un
// CommentRuleLog, así que no había forma de saber cuántos comentarios de
// clientes reales se estaban cayendo. La función sigue siendo pura (no
// loguea ni escribe); es responsabilidad del webhook (Task 8) emitir el
// console.warn por cada descarte.

export type DiscardReason = "sin-id" | "sin-autor" | "sin-publicacion" | "sin-texto";

export interface DiscardedComment {
  platform: "INSTAGRAM" | "FACEBOOK";
  accountId: string; // entry.id → igBusinessId (IG) o pageId (FB)
  externalCommentId: string | null;
  reason: DiscardReason;
}

export interface IncomingComment {
  platform: "INSTAGRAM" | "FACEBOOK";
  accountId: string; // entry.id → igBusinessId (IG) o pageId (FB)
  externalCommentId: string;
  postId: string;
  authorId: string;
  authorHandle: string | null;
  text: string;
  isNested: boolean;
}

export interface ParsedCommentWebhook {
  comments: IncomingComment[];
  discarded: DiscardedComment[];
}

interface RawEntry {
  id?: string;
  changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
}

// Resultado interno de intentar parsear un `value` que ya se sabe es un
// comentario (pasó el gate de object/field/item/verb):
//   - "ok": se armó el IncomingComment completo.
//   - "discarded": faltó un campo obligatorio; trae la razón determinista.
//   - null: NO se llega a intentar (ni siquiera es un comentario), p. ej.
//     Facebook con verb distinto de "add" — el llamador lo ignora sin más.
type ParseAttempt =
  | { kind: "ok"; comment: IncomingComment }
  | { kind: "discarded"; reason: DiscardReason; externalCommentId: string | null }
  | null;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Precedencia determinista de la razón de descarte: primero la identidad
// (id, autor, publicación) y al final el contenido (texto).
function parseIg(entryId: string, value: Record<string, unknown>): ParseAttempt {
  const from = (value.from ?? {}) as Record<string, unknown>;
  const media = (value.media ?? {}) as Record<string, unknown>;
  const id = str(value.id);
  const authorId = str(from.id);
  const postId = str(media.id);
  const text = str(value.text);

  if (!id) return { kind: "discarded", reason: "sin-id", externalCommentId: null };
  if (!authorId) return { kind: "discarded", reason: "sin-autor", externalCommentId: id };
  if (!postId) return { kind: "discarded", reason: "sin-publicacion", externalCommentId: id };
  if (!text) return { kind: "discarded", reason: "sin-texto", externalCommentId: id };

  return {
    kind: "ok",
    comment: {
      platform: "INSTAGRAM",
      accountId: entryId,
      externalCommentId: id,
      postId,
      authorId,
      authorHandle: str(from.username),
      text,
      isNested: !!str(value.parent_id),
    },
  };
}

function parseFb(entryId: string, value: Record<string, unknown>): ParseAttempt {
  if (value.item !== "comment" || value.verb !== "add") return null;

  const from = (value.from ?? {}) as Record<string, unknown>;
  const id = str(value.comment_id);
  const authorId = str(from.id);
  const postId = str(value.post_id);
  const text = str(value.message);

  if (!id) return { kind: "discarded", reason: "sin-id", externalCommentId: null };
  if (!authorId) return { kind: "discarded", reason: "sin-autor", externalCommentId: id };
  if (!postId) return { kind: "discarded", reason: "sin-publicacion", externalCommentId: id };
  if (!text) return { kind: "discarded", reason: "sin-texto", externalCommentId: id };

  const parentId = str(value.parent_id);
  return {
    kind: "ok",
    comment: {
      platform: "FACEBOOK",
      accountId: entryId,
      externalCommentId: id,
      postId,
      authorId,
      authorHandle: str(from.name),
      text,
      isNested: !!parentId && parentId !== postId,
    },
  };
}

export function parseCommentWebhook(body: unknown): ParsedCommentWebhook {
  const comments: IncomingComment[] = [];
  const discarded: DiscardedComment[] = [];

  if (!body || typeof body !== "object") return { comments, discarded };
  const { object, entry } = body as { object?: string; entry?: unknown };
  if (object !== "instagram" && object !== "page") return { comments, discarded };
  if (!Array.isArray(entry)) return { comments, discarded };

  const platform: "INSTAGRAM" | "FACEBOOK" = object === "instagram" ? "INSTAGRAM" : "FACEBOOK";

  for (const raw of entry as RawEntry[]) {
    const entryId = str(raw?.id);
    if (!entryId || !Array.isArray(raw.changes)) continue;

    for (const change of raw.changes) {
      const value = change?.value;
      if (!value || typeof value !== "object") continue;

      const attempt: ParseAttempt =
        object === "instagram" && change.field === "comments"
          ? parseIg(entryId, value)
          : object === "page" && change.field === "feed"
            ? parseFb(entryId, value)
            : null;

      if (!attempt) continue;
      if (attempt.kind === "ok") {
        comments.push(attempt.comment);
      } else {
        discarded.push({
          platform,
          accountId: entryId,
          externalCommentId: attempt.externalCommentId,
          reason: attempt.reason,
        });
      }
    }
  }
  return { comments, discarded };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/comments/parse.test.ts`
Expected: PASS — 18 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/comments/parse.ts src/lib/comments/parse.test.ts
git commit -m "feat(comments): parser de webhooks feed/comments de Meta"
```

---

## Task 5: `graph.ts` — respuesta pública y private reply

**Files:**
- Create: `src/lib/comments/graph.ts`
- Test: `src/lib/comments/graph.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { replyToComment, sendPrivateReply } from "./graph";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function fail(body: unknown, status = 400) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
}

describe("replyToComment", () => {
  it("Instagram usa la arista /replies", async () => {
    fetchMock.mockReturnValue(ok({ id: "IGREPLY-1" }));
    const out = await replyToComment("INSTAGRAM", "TOKEN", "IGCOMMENT-1", "te escribo al DM");
    expect(out).toEqual({ id: "IGREPLY-1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v24.0/IGCOMMENT-1/replies");
  });

  it("Facebook usa la arista /comments", async () => {
    fetchMock.mockReturnValue(ok({ id: "FBREPLY-1" }));
    await replyToComment("FACEBOOK", "TOKEN", "PAGE-1_COMMENT-1", "vamos al privado");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://graph.facebook.com/v24.0/PAGE-1_COMMENT-1/comments"
    );
  });

  it("manda el token en el body, nunca en la URL", async () => {
    fetchMock.mockReturnValue(ok({ id: "x" }));
    await replyToComment("INSTAGRAM", "TOKEN-SECRETO", "C1", "hola");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("TOKEN-SECRETO");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      message: "hola",
      access_token: "TOKEN-SECRETO",
    });
  });

  it("propaga el mensaje textual de Meta, no un genérico", async () => {
    fetchMock.mockReturnValue(fail({ error: { code: 190, message: "Invalid OAuth access token" } }));
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment reply 190: Invalid OAuth access token"
    );
  });

  it("respuesta sin id se considera error", async () => {
    fetchMock.mockReturnValue(ok({}));
    await expect(replyToComment("FACEBOOK", "T", "C1", "hola")).rejects.toThrow(/sin id/);
  });
});

describe("sendPrivateReply", () => {
  it("manda recipient.comment_id y devuelve message_id y recipient_id", async () => {
    fetchMock.mockReturnValue(ok({ message_id: "mid-1", recipient_id: "PSID-1" }));
    const out = await sendPrivateReply("TOKEN", "PAGE-1_COMMENT-1", "Hola, te paso info");
    expect(out).toEqual({ messageId: "mid-1", recipientId: "PSID-1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v24.0/me/messages");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      recipient: { comment_id: "PAGE-1_COMMENT-1" },
      message: { text: "Hola, te paso info" },
      access_token: "TOKEN",
    });
  });

  it("recipient_id ausente no rompe (queda null)", async () => {
    fetchMock.mockReturnValue(ok({ message_id: "mid-2" }));
    expect(await sendPrivateReply("T", "C1", "hola")).toEqual({
      messageId: "mid-2",
      recipientId: null,
    });
  });

  it("ventana vencida: propaga el error de Meta tal cual", async () => {
    fetchMock.mockReturnValue(
      fail({ error: { code: 10903, message: "This comment is too old to reply privately" } })
    );
    await expect(sendPrivateReply("T", "C1", "hola")).rejects.toThrow(
      "Private reply 10903: This comment is too old to reply privately"
    );
  });
});

describe("postJson — robustez (code review)", () => {
  it("res.ok=true con error en el body (Graph miente con 200): debe lanzar, no resolver", async () => {
    fetchMock.mockReturnValue(
      ok({ error: { code: 200, message: "algo salió mal aunque status sea 200" } })
    );
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment reply 200: algo salió mal aunque status sea 200"
    );
  });

  it("error como string: se conserva el mensaje textual de Meta", async () => {
    fetchMock.mockReturnValue(fail({ error: "algo salió mal" }, 400));
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment reply 400: algo salió mal"
    );
  });

  it("respuesta que no es JSON con ok=false: lanza usando el status, sin reventar por el JSON", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("Unexpected end of JSON input")),
      })
    );
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment reply 503"
    );
  });

  it("Fix 1 (regresión): __ok:true en el body con res.ok=false no disfraza un fallo como éxito", async () => {
    fetchMock.mockReturnValue(fail({ __ok: true, id: "FAKE-SUCCESS-ID" }, 400));
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow();
  });

  it("fallo de red: el error se propaga y su mensaje no contiene el token", async () => {
    fetchMock.mockReturnValue(Promise.reject(new Error("network error")));
    let caught: unknown;
    try {
      await replyToComment("INSTAGRAM", "TOKEN-SECRETO", "C1", "hola");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).not.toContain("TOKEN-SECRETO");
  });

  it("el fetch recibe un signal (AbortSignal) para que nadie borre el timeout en silencio", async () => {
    fetchMock.mockReturnValue(ok({ id: "x" }));
    await replyToComment("INSTAGRAM", "T", "C1", "hola");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
```

> Nota (code review post-Task 5): los 6 tests de `postJson — robustez` se agregaron
> en una segunda pasada TDD tras detectar 3 fallas reales en la primera implementación
> (mezcla de namespace `__ok`/`__status` con el body de Graph, `error` como string
> descartado, y ausencia de timeout). Ver Fix 1-3 abajo.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/comments/graph.test.ts`
Expected: FAIL — `Failed to resolve import "./graph"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/comments/graph.ts
// Llamadas a Graph para comentarios. El token va en el body y no en el query
// string: los errores de fetch acaban en logs y una URL con token es una fuga.

const GRAPH = "https://graph.facebook.com/v24.0";

// Dos llamadas secuenciales (respuesta pública + private reply) más escrituras
// de log caben en el maxDuration de 30s del webhook; 8s por llamada deja margen
// para ambas sin arriesgar que un cuelgue de Graph deje el registro en PENDING.
const TIMEOUT_MS = 8000;

async function postJson(
  url: string,
  payload: unknown
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function graphError(prefix: string, status: number, data: Record<string, unknown>): Error {
  if (typeof data.error === "string") return new Error(`${prefix} ${status}: ${data.error}`);
  const err = (data.error ?? {}) as { code?: number; message?: string };
  return new Error(`${prefix} ${err.code ?? status}: ${err.message ?? "error"}`);
}

/**
 * Respuesta pública al comentario.
 * Instagram: POST /{ig-comment-id}/replies · Facebook: POST /{comment-id}/comments
 */
export async function replyToComment(
  platform: "INSTAGRAM" | "FACEBOOK",
  pageToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  const edge = platform === "INSTAGRAM" ? "replies" : "comments";
  const { ok, status, data } = await postJson(`${GRAPH}/${commentId}/${edge}`, {
    message,
    access_token: pageToken,
  });
  if (!ok || data.error) throw graphError("Comment reply", status, data);
  const id = typeof data.id === "string" ? data.id : null;
  if (!id) throw new Error("Comment reply sin id en la respuesta de Graph");
  return { id };
}

/**
 * Private reply: único camino que Meta ofrece para escribirle a alguien que
 * solo comentó. Una vez por comentario y dentro de la ventana de 7 días.
 * El `recipient_id` que regresa es el PSID (Facebook) o IGSID (Instagram).
 */
export async function sendPrivateReply(
  pageToken: string,
  commentId: string,
  text: string
): Promise<{ messageId: string; recipientId: string | null }> {
  const { ok, status, data } = await postJson(`${GRAPH}/me/messages`, {
    recipient: { comment_id: commentId },
    message: { text },
    access_token: pageToken,
  });
  if (!ok || data.error) throw graphError("Private reply", status, data);
  const messageId = typeof data.message_id === "string" ? data.message_id : null;
  if (!messageId) throw new Error("Private reply sin message_id en la respuesta de Graph");
  return {
    messageId,
    recipientId: typeof data.recipient_id === "string" ? data.recipient_id : null,
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/comments/graph.test.ts`
Expected: PASS — 14 tests (8 originales + 6 de robustez agregados en code review)

- [ ] **Step 5: Commit**

```bash
git add src/lib/comments/graph.ts src/lib/comments/graph.test.ts
git commit -m "feat(comments): cliente Graph de respuesta publica y private reply"
```

---

## Task 6: `handle-comment.ts` — orquestación

**Files:**
- Create: `src/lib/comments/handle-comment.ts`
- Test: `src/lib/comments/handle-comment.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingComment } from "./parse";

const ruleFindMany = vi.fn();
const logFindUnique = vi.fn();
const logFindFirst = vi.fn();
const logCreate = vi.fn();
const logUpdate = vi.fn();
const logCount = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commentRule: { findMany: (...a: unknown[]) => ruleFindMany(...a) },
    commentRuleLog: {
      findUnique: (...a: unknown[]) => logFindUnique(...a),
      findFirst: (...a: unknown[]) => logFindFirst(...a),
      create: (...a: unknown[]) => logCreate(...a),
      update: (...a: unknown[]) => logUpdate(...a),
      count: (...a: unknown[]) => logCount(...a),
    },
  },
}));

const resolveByIg = vi.fn();
const resolveByPage = vi.fn();
const getToken = vi.fn();
vi.mock("@/lib/messaging/social-accounts", () => ({
  resolveConnectorByIgBusinessId: (...a: unknown[]) => resolveByIg(...a),
  resolveConnectorByPageId: (...a: unknown[]) => resolveByPage(...a),
  getSocialPageToken: (...a: unknown[]) => getToken(...a),
}));

const replyToComment = vi.fn();
const sendPrivateReply = vi.fn();
vi.mock("./graph", () => ({
  replyToComment: (...a: unknown[]) => replyToComment(...a),
  sendPrivateReply: (...a: unknown[]) => sendPrivateReply(...a),
}));

const persistOpener = vi.fn();
vi.mock("./link-comment-origin", () => ({
  persistOpenerForKnownContact: (...a: unknown[]) => persistOpener(...a),
}));

import { handleComment } from "./handle-comment";

const IG_CONNECTOR = {
  id: "conn-ig",
  provider: "INSTAGRAM",
  config: { igBusinessId: "17841", pageId: "PAGE-1" },
};

const RULE = {
  id: "rule-1",
  connectorId: "conn-ig",
  priority: 100,
  phrases: ["info"],
  postFilter: [],
  publicReplies: ["Te escribo al DM 📩", "Ya te mandé privado 📩"],
  dmTemplate: "Hola {{usuario}}, aquí va la info.",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function comment(over: Partial<IncomingComment> = {}): IncomingComment {
  return {
    platform: "INSTAGRAM",
    accountId: "17841",
    externalCommentId: "IGCOMMENT-1",
    postId: "MEDIA-1",
    authorId: "IGSID-1",
    authorHandle: "luisf",
    text: "info porfa",
    isNested: false,
    ...over,
  };
}

beforeEach(() => {
  for (const m of [
    ruleFindMany, logFindUnique, logFindFirst, logCreate, logUpdate, logCount,
    resolveByIg, resolveByPage, getToken, replyToComment, sendPrivateReply, persistOpener,
  ]) m.mockReset();

  resolveByIg.mockResolvedValue(IG_CONNECTOR);
  resolveByPage.mockResolvedValue(null);
  getToken.mockReturnValue("TOKEN");
  ruleFindMany.mockResolvedValue([RULE]);
  logFindUnique.mockResolvedValue(null);
  logFindFirst.mockResolvedValue(null);
  logCount.mockResolvedValue(0);
  logCreate.mockResolvedValue({ id: "log-1" });
  logUpdate.mockResolvedValue({ id: "log-1" });
  replyToComment.mockResolvedValue({ id: "IGREPLY-1" });
  sendPrivateReply.mockResolvedValue({ messageId: "mid-1", recipientId: "IGSID-1" });
});

describe("handleComment — descartes", () => {
  it("sin conector activo no escribe nada", async () => {
    resolveByIg.mockResolvedValue(null);
    expect(await handleComment(comment())).toEqual({ status: "sin-conector" });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("comentario de la propia cuenta se ignora (anti-loop)", async () => {
    expect(await handleComment(comment({ authorId: "17841" }))).toEqual({ status: "propio" });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("comentario de la propia página de Facebook se ignora", async () => {
    resolveByIg.mockResolvedValue(null);
    resolveByPage.mockResolvedValue(IG_CONNECTOR);
    const out = await handleComment(
      comment({ platform: "FACEBOOK", accountId: "PAGE-1", authorId: "PAGE-1" })
    );
    expect(out).toEqual({ status: "propio" });
  });

  it("respuesta anidada se ignora (Instagram no acepta responder a una respuesta)", async () => {
    expect(await handleComment(comment({ isNested: true }))).toEqual({ status: "anidado" });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("comentario ya registrado no se procesa dos veces", async () => {
    logFindUnique.mockResolvedValue({ id: "log-viejo" });
    expect(await handleComment(comment())).toEqual({ status: "duplicado", logId: "log-viejo" });
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("sin match no escribe log ni llama a Graph", async () => {
    expect(await handleComment(comment({ text: "qué bonito" }))).toEqual({ status: "sin-match" });
    expect(logCreate).not.toHaveBeenCalled();
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("solo consulta reglas activas del conector", async () => {
    await handleComment(comment());
    expect(ruleFindMany.mock.calls[0][0].where).toEqual({
      connectorId: "conn-ig",
      isActive: true,
      deletedAt: null,
    });
  });
});

describe("handleComment — cuota", () => {
  it("misma persona en la misma publicación queda SKIPPED sin llamar a Graph", async () => {
    logFindFirst.mockResolvedValue({ id: "log-previo" });
    const out = await handleComment(comment({ externalCommentId: "IGCOMMENT-2" }));
    expect(out.status).toBe("cuota");
    expect(replyToComment).not.toHaveBeenCalled();
    expect(sendPrivateReply).not.toHaveBeenCalled();
    expect(logCreate.mock.calls[0][0].data).toMatchObject({
      publicReplyStatus: "SKIPPED",
      dmStatus: "SKIPPED",
    });
  });

  it("la cuota se consulta por conector, publicación y autor", async () => {
    await handleComment(comment());
    expect(logFindFirst.mock.calls[0][0].where).toEqual({
      connectorId: "conn-ig",
      postId: "MEDIA-1",
      authorId: "IGSID-1",
    });
  });
});

describe("handleComment — envíos", () => {
  it("crea el log en PENDING antes de llamar a Graph", async () => {
    await handleComment(comment());
    expect(logCreate.mock.calls[0][0].data).toMatchObject({
      ruleId: "rule-1",
      connectorId: "conn-ig",
      platform: "INSTAGRAM",
      externalCommentId: "IGCOMMENT-1",
      matchedPhrase: "info",
      publicReplyStatus: "PENDING",
      dmStatus: "PENDING",
      publicText: "Te escribo al DM 📩",
      dmText: "Hola luisf, aquí va la info.",
    });
  });

  it("manda la variante pública que toca según disparos previos", async () => {
    logCount.mockResolvedValue(1);
    await handleComment(comment());
    expect(replyToComment).toHaveBeenCalledWith(
      "INSTAGRAM", "TOKEN", "IGCOMMENT-1", "Ya te mandé privado 📩"
    );
  });

  it("marca ambas acciones SENT y guarda recipient y mid del DM", async () => {
    await handleComment(comment());
    const updates = logUpdate.mock.calls.map((c) => c[0].data);
    expect(updates).toContainEqual(
      expect.objectContaining({ publicReplyStatus: "SENT", publicReplyId: "IGREPLY-1" })
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        dmStatus: "SENT",
        dmRecipientId: "IGSID-1",
        dmExternalMessageId: "mid-1",
      })
    );
  });

  it("si falla la pública, el DM sale igual y el error queda textual", async () => {
    replyToComment.mockRejectedValue(new Error("Comment reply 368: temporarily blocked"));
    const out = await handleComment(comment());
    expect(out.status).toBe("procesado");
    expect(sendPrivateReply).toHaveBeenCalled();
    expect(logUpdate.mock.calls[0][0].data).toMatchObject({
      publicReplyStatus: "FAILED",
      publicReplyError: "Comment reply 368: temporarily blocked",
    });
  });

  it("si falla el DM, la pública ya salió y el motivo se guarda", async () => {
    sendPrivateReply.mockRejectedValue(
      new Error("Private reply 10903: This comment is too old to reply privately")
    );
    const out = await handleComment(comment());
    expect(out.status).toBe("procesado");
    expect(logUpdate.mock.calls[1][0].data).toMatchObject({
      dmStatus: "FAILED",
      dmError: "Private reply 10903: This comment is too old to reply privately",
    });
  });

  it("conector sin pageAccessToken: log FAILED en ambas, sin llamar a Graph", async () => {
    getToken.mockReturnValue(null);
    const out = await handleComment(comment());
    expect(out.status).toBe("sin-token");
    expect(replyToComment).not.toHaveBeenCalled();
    expect(logCreate.mock.calls[0][0].data).toMatchObject({
      publicReplyStatus: "FAILED",
      dmStatus: "FAILED",
      dmError: "Conector sin pageAccessToken",
    });
  });

  it("intenta enganchar el opener al hilo si la persona ya es contacto", async () => {
    await handleComment(comment());
    expect(persistOpener).toHaveBeenCalledWith({
      platform: "INSTAGRAM",
      connectorId: "conn-ig",
      recipientId: "IGSID-1",
      text: "Hola luisf, aquí va la info.",
      externalMessageId: "mid-1",
    });
  });

  it("si persistOpener falla, el resultado sigue siendo procesado", async () => {
    persistOpener.mockRejectedValue(new Error("boom"));
    expect((await handleComment(comment())).status).toBe("procesado");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/comments/handle-comment.test.ts`
Expected: FAIL — `Failed to resolve import "./handle-comment"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/comments/handle-comment.ts
// Orquestación de un comentario entrante: descartes → idempotencia → match →
// cuota → log → respuesta pública y DM privado (independientes entre sí).
import prisma from "@/lib/db";
import type { IncomingComment } from "./parse";
import { matchRule } from "./match";
import { renderTemplate, pickVariant } from "./template";
import { replyToComment, sendPrivateReply } from "./graph";
import {
  resolveConnectorByIgBusinessId,
  resolveConnectorByPageId,
  getSocialPageToken,
} from "@/lib/messaging/social-accounts";

export type CommentOutcome =
  | "sin-conector"
  | "propio"
  | "anidado"
  | "duplicado"
  | "sin-match"
  | "cuota"
  | "sin-token"
  | "procesado";

export interface HandleCommentResult {
  status: CommentOutcome;
  logId?: string;
}

const ERROR_MAX = 500;

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);
}

export async function handleComment(comment: IncomingComment): Promise<HandleCommentResult> {
  const connector =
    comment.platform === "INSTAGRAM"
      ? await resolveConnectorByIgBusinessId(comment.accountId)
      : await resolveConnectorByPageId(comment.accountId);

  if (!connector) {
    console.warn(
      `[comments] sin conector activo para ${comment.platform} accountId=${comment.accountId}`
    );
    return { status: "sin-conector" };
  }

  // Anti-loop: nuestra propia respuesta pública vuelve como comentario nuevo.
  const config = (connector.config ?? {}) as { pageId?: string; igBusinessId?: string };
  if (comment.authorId === config.igBusinessId || comment.authorId === config.pageId) {
    return { status: "propio" };
  }

  // Instagram no acepta responder a una respuesta: solo primer nivel.
  if (comment.isNested) return { status: "anidado" };

  const existing = await prisma.commentRuleLog.findUnique({
    where: { externalCommentId: comment.externalCommentId },
  });
  if (existing) return { status: "duplicado", logId: existing.id };

  const rules = await prisma.commentRule.findMany({
    where: { connectorId: connector.id, isActive: true, deletedAt: null },
  });
  const match = matchRule(rules, comment.text, comment.postId);
  if (!match) return { status: "sin-match" };

  const vars = { usuario: comment.authorHandle };
  const dmText = renderTemplate(match.rule.dmTemplate, vars);

  const base = {
    ruleId: match.rule.id,
    connectorId: connector.id,
    platform: comment.platform,
    externalCommentId: comment.externalCommentId,
    postId: comment.postId,
    authorId: comment.authorId,
    authorHandle: comment.authorHandle,
    commentText: comment.text.slice(0, 2000),
    matchedPhrase: match.phrase,
  };

  // Cuota: una respuesta por persona por publicación.
  const previous = await prisma.commentRuleLog.findFirst({
    where: { connectorId: connector.id, postId: comment.postId, authorId: comment.authorId },
  });
  if (previous) {
    const log = await prisma.commentRuleLog.create({
      data: { ...base, publicReplyStatus: "SKIPPED", dmStatus: "SKIPPED" },
    });
    return { status: "cuota", logId: log.id };
  }

  const token = getSocialPageToken(connector);
  if (!token) {
    const log = await prisma.commentRuleLog.create({
      data: {
        ...base,
        publicReplyStatus: "FAILED",
        publicReplyError: "Conector sin pageAccessToken",
        dmStatus: "FAILED",
        dmError: "Conector sin pageAccessToken",
        dmText,
      },
    });
    return { status: "sin-token", logId: log.id };
  }

  // Rotación: cuántas veces ya salió esta regla en público.
  const fired = await prisma.commentRuleLog.count({
    where: { ruleId: match.rule.id, publicReplyStatus: "SENT" },
  });
  const publicText = renderTemplate(pickVariant(match.rule.publicReplies, fired) ?? "", vars);

  // El log se crea ANTES de Graph: el índice único de externalCommentId es el
  // candado contra los reintentos concurrentes del webhook de Meta.
  const log = await prisma.commentRuleLog.create({
    data: { ...base, publicText, dmText },
  });

  if (publicText) {
    try {
      const reply = await replyToComment(
        comment.platform,
        token,
        comment.externalCommentId,
        publicText
      );
      await prisma.commentRuleLog.update({
        where: { id: log.id },
        data: { publicReplyStatus: "SENT", publicReplyId: reply.id },
      });
    } catch (err) {
      console.error("[comments] respuesta pública falló:", err);
      await prisma.commentRuleLog.update({
        where: { id: log.id },
        data: { publicReplyStatus: "FAILED", publicReplyError: errorText(err) },
      });
    }
  }

  try {
    const dm = await sendPrivateReply(token, comment.externalCommentId, dmText);
    await prisma.commentRuleLog.update({
      where: { id: log.id },
      data: {
        dmStatus: "SENT",
        dmRecipientId: dm.recipientId,
        dmExternalMessageId: dm.messageId,
      },
    });

    // Si ya es contacto, el opener se persiste en su hilo AHORA. Si no se hace,
    // el eco del propio DM entra como ADVISOR y dispara el takeover que
    // enmudece al bot (lib/messaging/core.ts, handleEchoMessage).
    if (dm.recipientId) {
      try {
        const { persistOpenerForKnownContact } = await import("./link-comment-origin");
        await persistOpenerForKnownContact({
          platform: comment.platform,
          connectorId: connector.id,
          recipientId: dm.recipientId,
          text: dmText,
          externalMessageId: dm.messageId,
        });
      } catch (err) {
        console.error("[comments] persistOpenerForKnownContact falló:", err);
      }
    }
  } catch (err) {
    console.error("[comments] private reply falló:", err);
    await prisma.commentRuleLog.update({
      where: { id: log.id },
      data: { dmStatus: "FAILED", dmError: errorText(err) },
    });
  }

  return { status: "procesado", logId: log.id };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/comments/handle-comment.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/comments/handle-comment.ts src/lib/comments/handle-comment.test.ts
git commit -m "feat(comments): motor de reglas con cuota, idempotencia y log"
```

> **Nota (code review post-Task 6 — Fix 5):** si `publicReplies` estuviera vacío,
> `pickVariant` devuelve `null`, `publicText` queda `""` y el `if (publicText)`
> saltaba la respuesta pública — pero el log se quedaba con
> `publicReplyStatus: "PENDING"` **sin ninguna ruta que lo actualizara**:
> invisible en la UI, ni enviado ni fallido. La validación de reglas exige al
> menos una variante, así que no debería pasar, pero un estado terminal
> imposible de alcanzar es una trampa. Se agregó un `else` al `if (publicText)`
> que deja el log en `publicReplyStatus: "SKIPPED"` con un `publicReplyError`
> explicando la causa ("La regla no tenía respuesta pública configurada
> (publicReplies vacío)"). Test agregado: `handle-comment.test.ts` — "Fix 5:
> publicReplies vacío deja el log en SKIPPED (no PENDING eterno)...", con una
> regla `{ ...RULE, publicReplies: [] }`. 18 tests en total (17 originales + 1).

> **Nota (code review posterior, Fix 1 y Fix 2 — 2026-08-05):**
>
> **Fix 1 (el importante):** la llamada a Graph y el `update` de Prisma que la
> registra vivían en el **mismo** `try`. Si `replyToComment` o
> `sendPrivateReply` tenían éxito pero el `update` inmediatamente posterior
> lanzaba (blip de la base), el `catch` escribía `FAILED` con el mensaje de
> Prisma — mintiendo: el comentario ya estaba respondido en público, o el DM ya
> estaba en el chat del cliente. Para el DM era peor: sin
> `dmExternalMessageId` persistido, el guard que `handleEchoMessage` usa para
> no aplicar el takeover (`lib/messaging/core.ts`, busca el log por
> `dmExternalMessageId`) no encontraba nada, caía al camino viejo, registraba
> el eco como `ADVISOR` y enmudecía al bot — la misma carrera que ya se había
> cerrado.
>
> Se separó cada bloque en dos `try` independientes: uno para la llamada a
> Graph (si falla, `FAILED` con el mensaje textual de Meta — sin cambios) y
> otro para el `update` posterior (si Graph tuvo éxito pero el `update` falla,
> **no** se escribe `FAILED`; se emite un `console.error` con el prefijo
> `"ALERTA reconciliación manual"` con el `logId`, el id que devolvió Graph
> (`publicReplyId` / `dmExternalMessageId`+`dmRecipientId`) y el error de
> Prisma, para reconciliar a mano; el resultado sigue siendo `procesado`). En
> el DM, `persistOpenerForKnownContact` se intenta igual aunque el `update` del
> `dmStatus` haya fallado — son defensas independientes. Tests agregados: "Fix
> 1: replyToComment tiene éxito pero el update posterior falla..." y "Fix 1:
> sendPrivateReply tiene éxito pero el update posterior falla...".
>
> **Fix 2:** de los tests con `platform: "FACEBOOK"` solo existía el descarte
> "propio"; nunca se ejercitaba el camino feliz completo de Facebook (conector
> resuelto por `resolveConnectorByPageId`, match → cuota → log →
> `replyToComment("FACEBOOK", ...)` → `sendPrivateReply` → `procesado`). Se
> agregó el describe `"handleComment — Facebook camino feliz"` con ese
> end-to-end. No requirió cambios de código, solo cobertura.
>
> 21 tests en total (18 + 2 de Fix 1 + 1 de Fix 2). Ver
> `src/lib/comments/handle-comment.ts` y `.test.ts` para el detalle.

---

## Task 7: `link-comment-origin.ts` — puente al contacto

Dos funciones en el mismo archivo porque resuelven la misma pregunta desde los dos lados del tiempo: `persistOpenerForKnownContact` cuando el contacto ya existe al momento del DM, y `linkCommentOrigin` cuando aparece después.

**Files:**
- Create: `src/lib/comments/link-comment-origin.ts`
- Test: `src/lib/comments/link-comment-origin.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const logFindFirst = vi.fn();
const logUpdate = vi.fn();
const messageCreate = vi.fn();
const conversationUpdate = vi.fn();
const activityCreate = vi.fn();
const userFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a) },
    commentRuleLog: {
      findFirst: (...a: unknown[]) => logFindFirst(...a),
      update: (...a: unknown[]) => logUpdate(...a),
    },
    message: { create: (...a: unknown[]) => messageCreate(...a) },
    conversation: { update: (...a: unknown[]) => conversationUpdate(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
  },
}));

const ensureConversation = vi.fn();
vi.mock("@/lib/messaging/conversations", () => ({
  ensureConversation: (...a: unknown[]) => ensureConversation(...a),
}));

import { persistOpenerForKnownContact, linkCommentOrigin } from "./link-comment-origin";

beforeEach(() => {
  for (const m of [
    contactFindFirst, logFindFirst, logUpdate, messageCreate,
    conversationUpdate, activityCreate, userFindFirst, ensureConversation,
  ]) m.mockReset();
  ensureConversation.mockResolvedValue({ id: "conv-1", status: "BOT" });
  messageCreate.mockResolvedValue({ id: "msg-1" });
  userFindFirst.mockResolvedValue({ id: "admin-1" });
});

describe("persistOpenerForKnownContact", () => {
  const args = {
    platform: "INSTAGRAM" as const,
    connectorId: "conn-ig",
    recipientId: "IGSID-1",
    text: "Hola, aquí va la info",
    externalMessageId: "mid-1",
  };

  it("desconocido: no crea nada (el contacto nace cuando responde)", async () => {
    contactFindFirst.mockResolvedValue(null);
    expect(await persistOpenerForKnownContact(args)).toBeNull();
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("conocido: guarda el opener como BOT y NO toca el status de la conversación", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: "u-1" });
    await persistOpenerForKnownContact(args);
    expect(messageCreate.mock.calls[0][0].data).toMatchObject({
      contactId: "c-1",
      channel: "INSTAGRAM",
      direction: "OUTBOUND",
      sender: "BOT",
      aiGenerated: false,
      body: "Hola, aquí va la info",
      externalMessageId: "mid-1",
      conversationId: "conv-1",
      status: "SENT",
    });
    const convData = conversationUpdate.mock.calls[0][0].data;
    expect(convData).not.toHaveProperty("status");
    expect(convData).not.toHaveProperty("unreadCount");
  });

  it("busca por instagramId en IG y por messengerPsid en Facebook", async () => {
    contactFindFirst.mockResolvedValue(null);
    await persistOpenerForKnownContact(args);
    expect(contactFindFirst.mock.calls[0][0].where).toMatchObject({ instagramId: "IGSID-1" });

    contactFindFirst.mockClear();
    await persistOpenerForKnownContact({ ...args, platform: "FACEBOOK" });
    expect(contactFindFirst.mock.calls[0][0].where).toMatchObject({ messengerPsid: "IGSID-1" });
  });

  it("mid repetido (P2002) no revienta: el eco ya lo había guardado", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: null });
    messageCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(persistOpenerForKnownContact(args)).resolves.toBeNull();
  });
});

describe("linkCommentOrigin", () => {
  it("sin log pendiente para ese remitente no hace nada", async () => {
    logFindFirst.mockResolvedValue(null);
    expect(await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1")).toBeNull();
    expect(logUpdate).not.toHaveBeenCalled();
  });

  it("estampa contactId en el log del comentario", async () => {
    logFindFirst.mockResolvedValue({
      id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1",
      dmText: "Hola, info", dmExternalMessageId: "mid-1", dmStatus: "SENT", createdAt: new Date("2026-08-04T10:00:00Z"),
    });
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(logUpdate).toHaveBeenCalledWith({ where: { id: "log-1" }, data: { contactId: "c-1" } });
  });

  it("rellena el opener con el createdAt del log para que quede ANTES de la respuesta", async () => {
    const logCreatedAt = new Date("2026-08-04T10:00:00Z");
    logFindFirst.mockResolvedValue({
      id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1",
      dmText: "Hola, info", dmExternalMessageId: "mid-1", dmStatus: "SENT", createdAt: logCreatedAt,
    });
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(messageCreate.mock.calls[0][0].data).toMatchObject({
      sender: "BOT",
      direction: "OUTBOUND",
      body: "Hola, info",
      externalMessageId: "mid-1",
      createdAt: logCreatedAt,
    });
  });

  it("registra la actividad del origen", async () => {
    logFindFirst.mockResolvedValue({
      id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1",
      dmText: "Hola", dmExternalMessageId: "mid-1", dmStatus: "SENT", createdAt: new Date(),
    });
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(activityCreate.mock.calls[0][0].data).toMatchObject({
      contactId: "c-1",
      activityType: "NOTE",
      status: "COMPLETADA",
    });
    expect(activityCreate.mock.calls[0][0].data.subject).toContain("MEDIA-1");
  });

  it("es idempotente: segunda pasada no vuelve a crear el opener", async () => {
    logFindFirst.mockResolvedValue(null); // ya tiene contactId, el filtro no lo trae
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("un fallo al rellenar el opener no impide estampar el contactId", async () => {
    logFindFirst.mockResolvedValue({
      id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1",
      dmText: "Hola", dmExternalMessageId: "mid-1", dmStatus: "SENT", createdAt: new Date(),
    });
    ensureConversation.mockRejectedValue(new Error("boom"));
    await expect(linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1")).resolves.not.toThrow();
    expect(logUpdate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/comments/link-comment-origin.test.ts`
Expected: FAIL — `Failed to resolve import "./link-comment-origin"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/comments/link-comment-origin.ts
// Puente entre el comentario y el contacto del CRM, en sus dos momentos:
//
//  a) persistOpenerForKnownContact — el DM salió y la persona YA era contacto.
//     Guardar el opener nosotros, como BOT, es lo que evita que el eco del
//     propio mensaje entre como ADVISOR y dispare el takeover que enmudece al
//     bot (ver handleEchoMessage en lib/messaging/core.ts).
//
//  b) linkCommentOrigin — la persona responde el DM y el intake acaba de crear
//     el contacto: se estampa el origen y se rellena el opener en el hilo.
import prisma from "@/lib/db";

type Platform = "INSTAGRAM" | "FACEBOOK";
type Channel = "INSTAGRAM" | "MESSENGER";

const CHANNEL: Record<Platform, Channel> = {
  INSTAGRAM: "INSTAGRAM",
  FACEBOOK: "MESSENGER",
};

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

async function findContactByRecipient(platform: Platform, recipientId: string) {
  const where =
    platform === "INSTAGRAM" ? { instagramId: recipientId } : { messengerPsid: recipientId };
  return prisma.contact.findFirst({
    where: { ...where, deletedAt: null, mergedIntoId: null },
    select: { id: true, assignedToId: true },
  });
}

/** Escribe el opener en el hilo del contacto, sin alterar el control del hilo. */
async function writeOpener(args: {
  contactId: string;
  assignedToId: string | null;
  channel: Channel;
  connectorId: string;
  text: string;
  externalMessageId: string;
  createdAt?: Date;
}) {
  const { ensureConversation } = await import("@/lib/messaging/conversations");
  const conversation = await ensureConversation({
    contactId: args.contactId,
    channel: args.channel,
    connectorId: args.connectorId,
  });

  try {
    await prisma.message.create({
      data: {
        contactId: args.contactId,
        userId: args.assignedToId,
        channel: args.channel,
        direction: "OUTBOUND",
        body: args.text,
        externalMessageId: args.externalMessageId,
        status: "SENT",
        conversationId: conversation.id,
        sender: "BOT",
        aiGenerated: false,
        ...(args.createdAt ? { createdAt: args.createdAt } : {}),
      },
    });
  } catch (err) {
    // El eco de Meta pudo haberlo guardado antes: mismo mid, índice único.
    if (isUniqueViolation(err)) return null;
    throw err;
  }

  // Solo lastMessageAt: tocar status o unreadCount rompería el control del hilo.
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  return conversation.id;
}

export async function persistOpenerForKnownContact(args: {
  platform: Platform;
  connectorId: string;
  recipientId: string;
  text: string;
  externalMessageId: string;
}): Promise<string | null> {
  const contact = await findContactByRecipient(args.platform, args.recipientId);
  if (!contact) return null;

  return writeOpener({
    contactId: contact.id,
    assignedToId: contact.assignedToId,
    channel: CHANNEL[args.platform],
    connectorId: args.connectorId,
    text: args.text,
    externalMessageId: args.externalMessageId,
  });
}

/**
 * Llamado desde el intake cuando llega un inbound de IG/Messenger: si ese
 * remitente venía de un comentario, se cierra el círculo.
 */
export async function linkCommentOrigin(
  contactId: string,
  channel: Channel,
  senderId: string
): Promise<string | null> {
  const log = await prisma.commentRuleLog.findFirst({
    where: { dmRecipientId: senderId, contactId: null },
    orderBy: { createdAt: "desc" },
  });
  if (!log) return null;

  await prisma.commentRuleLog.update({ where: { id: log.id }, data: { contactId } });

  // Los dos pasos de abajo son cosméticos frente al estampado: si fallan, el
  // vínculo ya quedó hecho y no se pierde la trazabilidad.
  if (log.dmStatus === "SENT" && log.dmText && log.dmExternalMessageId) {
    try {
      const contact = await prisma.contact.findFirst({
        where: { id: contactId },
        select: { id: true, assignedToId: true },
      });
      await writeOpener({
        contactId,
        assignedToId: contact?.assignedToId ?? null,
        channel,
        connectorId: log.connectorId,
        text: log.dmText,
        externalMessageId: log.dmExternalMessageId,
        createdAt: log.createdAt, // el opener precede a la respuesta en el hilo
      });
    } catch (err) {
      console.error("[comments] backfill del opener falló:", err);
    }
  }

  try {
    // Activity.userId es NOT NULL: sin asesor asignado se atribuye a un ADMIN.
    const contact = await prisma.contact.findFirst({
      where: { id: contactId },
      select: { assignedToId: true },
    });
    const userId =
      contact?.assignedToId ??
      (await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } }))
        ?.id;
    if (userId) {
      await prisma.activity.create({
        data: {
          contactId,
          userId,
          activityType: "NOTE",
          subject: `Origen: comentario en la publicación ${log.postId}`,
          description: `Comentó "${log.matchedPhrase}" y se le respondió en público + DM automático.`,
          status: "COMPLETADA",
          completedAt: new Date(),
        },
      });
    }
  } catch (err) {
    console.error("[comments] actividad de origen falló:", err);
  }

  return log.id;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/comments/link-comment-origin.test.ts`
Expected: PASS — 13 tests (10 originales + 3 de code review: Fix 2 y Fix 4, ver nota abajo)

- [ ] **Step 5: Enganchar en el intake**

En `src/lib/messaging/core.ts`, dentro de `handleInboundMessage`, **después** del bloque `try` de la actividad (el que termina con `console.error(\`[messaging] activity inbound...\`)`) y **antes** del bloque de `meetSlaTimers`, insertar:

```ts
  // Origen por comentario: si este remitente recibió un DM disparado por una
  // regla de comentarios, se cierra el vínculo. Side-effect: jamás mata la ingesta.
  if (msg.channel !== "WHATSAPP") {
    try {
      const { linkCommentOrigin } = await import("@/lib/comments/link-comment-origin");
      await linkCommentOrigin(contact.id, msg.channel, msg.senderId);
    } catch (err) {
      console.error(`[messaging] linkCommentOrigin falló:`, err);
    }
  }
```

- [ ] **Step 6: Verificar que el intake sigue verde**

Run: `npx vitest run src/lib/messaging/`
Expected: PASS — toda la carpeta, incluidos `core.test.ts` y los tests de adapters, sin regresiones.

- [ ] **Step 7: Commit**

```bash
git add src/lib/comments/link-comment-origin.ts src/lib/comments/link-comment-origin.test.ts src/lib/messaging/core.ts
git commit -m "feat(comments): puente comentario->contacto sin perder el hilo del bot"
```

> **Nota (code review post-Task 7 — Fix 1, Fix 2, Fix 3, Fix 4):** el hook del
> Step 5 solo cubre la mitad del puente (la persona responde el DM y el intake
> normal la encuentra por `linkCommentOrigin`). La otra mitad — el eco que Meta
> manda de vuelta del DM que el CRM mismo mandó — vive en
> `handleEchoMessage` (`src/lib/messaging/core.ts`, ~línea 91), una función
> **anterior a este plan** (Caso 4 de echoes) que este plan no documentaba y
> que el code review tocó directamente:
>
> - **Fix 1 (el importante):** la defensa contra el eco de un DM disparado por
>   una regla era escribir NOSOTROS el opener con el `message_id` de la Send
>   API (`persistOpenerForKnownContact` → `writeOpener`, en este mismo
>   archivo), para que el eco de Meta chocara con
>   `Message.externalMessageId @unique` y se descartara. Eso es una **carrera**,
>   no una garantía: si el `create()` del eco de `handleEchoMessage` commitea
>   primero, esa función ya evaluó `conversation.status === "BOT"` y ya disparó
>   el takeover suave (bot mudo para siempre en ese hilo) **antes** de que
>   nuestro propio `create` choque con `P2002` y se descarte en silencio —
>   demasiado tarde. `handleEchoMessage` ahora comprueba, ANTES de decidir
>   sender/takeover, si `msg.externalMessageId` es el `dmExternalMessageId` de
>   un `CommentRuleLog` (`prisma.commentRuleLog.findFirst`, envuelto en
>   try/catch — la tabla puede no existir todavía o la consulta puede fallar,
>   y el eco debe seguir su camino de siempre sin romper la ingesta). Si
>   coincide: `sender: "BOT"` (no `"ADVISOR"`) y **sin** takeover. Si no
>   coincide, o si la consulta falla, el comportamiento es exactamente el de
>   siempre. Tests en `core.test.ts` (describe "Fix 1 — comprobación
>   determinista contra CommentRuleLog"): eco con log → BOT sin takeover; eco
>   sin log → ADVISOR + takeover (regresión); consulta que lanza → camino de
>   siempre.
> - **Fix 2:** en `linkCommentOrigin`, el `findFirst` + `update` para estampar
>   `contactId` no era atómico. Dos inbounds casi simultáneos del mismo
>   remitente (reintento del webhook de Meta, o dos mensajes seguidos) podían
>   pasar los dos el `findFirst` antes de que cualquiera actualizara. El opener
>   está protegido por el índice único de `externalMessageId`, pero
>   `activity.create` no tenía ninguna protección: se creaban dos notas
>   idénticas "Origen: comentario…" en la cronología del contacto. Se cambió el
>   estampado a `prisma.commentRuleLog.updateMany({ where: { id: log.id,
>   contactId: null }, data: { contactId } })` — candado atómico sin
>   transacción; si `count !== 1`, otro inbound concurrente ya lo reclamó y la
>   función devuelve `null` sin tocar opener ni actividad. Test: "Fix 2: carrera
>   — otro inbound concurrente ya reclamó el log (updateMany count 0)...".
> - **Fix 3:** el mock de `@/lib/db` en `core.test.ts` no declaraba
>   `commentRuleLog`, así que en cada test no-WhatsApp de `handleInboundMessage`
>   el hook del Step 5 (real, sin mockear) reventaba con `TypeError` al llegar
>   a `prisma.commentRuleLog.findFirst` — absorbido en silencio por su propio
>   try/catch, y sin ninguna aserción que cubriera el hook (una regresión que
>   rompiera el guard de WhatsApp no hacía fallar ningún test). Se agregó
>   `commentRuleLog` (`findFirst`/`updateMany`) al mock de `@/lib/db` de
>   `core.test.ts` y un `vi.mock("@/lib/comments/link-comment-origin", ...)`
>   con spy — dos aserciones nuevas: se llama con `(contact.id, msg.channel,
>   msg.senderId)` en un inbound de Instagram/Messenger, y NO se llama en un
>   inbound de WhatsApp.
> - **Fix 4:** en `link-comment-origin.test.ts`, `ensureConversation` estaba
>   mockeado devolviendo siempre `{ id: "conv-1" }` sin importar los
>   argumentos — nada verificaba lo que se le pasaba. Se agregaron dos tests
>   que revisan `ensureConversation.mock.calls[0][0]`: `INSTAGRAM` →
>   `channel: "INSTAGRAM"`, `FACEBOOK` → `channel: "MESSENGER"`, ambos con el
>   `connectorId` correcto — si alguien invierte el mapeo `CHANNEL`, estos
>   tests gritan.
>
> `core.test.ts` queda en 48 tests (43 originales + 5: 3 de Fix 1 + 2 de Fix 3).
> `npx vitest run src/lib/messaging/` ya NO imprime `[messaging] linkCommentOrigin
> falló` en stderr — esa era la señal de que el Fix 3 estaba incompleto.

---

## Task 8: Bifurcar el webhook

**Files:**
- Modify: `src/app/api/webhooks/meta-dm/route.ts`
- Test: `src/app/api/webhooks/meta-dm/route.test.ts` (agregar casos)

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `src/app/api/webhooks/meta-dm/route.test.ts`. Además, agregar el mock de `handleComment` junto a los mocks existentes del inicio del archivo:

```ts
// junto a los otros vi.mock del inicio del archivo:
const handleComment = vi.fn();
vi.mock("@/lib/comments/handle-comment", () => ({
  handleComment: (...a: unknown[]) => handleComment(...a),
}));
```

Y agregar `handleComment.mockReset()` al `beforeEach` existente, junto con `handleComment.mockResolvedValue({ status: "procesado", logId: "log-1" })`.

```ts
describe("meta-dm webhook — comentarios", () => {
  it("payload de comentarios de IG llega al motor de comentarios", async () => {
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: "17841", changes: [{ field: "comments", value: {
        id: "IGCOMMENT-1", text: "info", from: { id: "IGSID-1", username: "luisf" },
        media: { id: "MEDIA-1" },
      } }] }],
    });
    const res = await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(handleComment).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "INSTAGRAM", externalCommentId: "IGCOMMENT-1", accountId: "17841",
      })
    );
    expect(handleInboundMessage).not.toHaveBeenCalled();
  });

  it("payload de comentarios de Facebook llega al motor", async () => {
    const body = JSON.stringify({
      object: "page",
      entry: [{ id: "PAGE-1", changes: [{ field: "feed", value: {
        item: "comment", verb: "add", comment_id: "C-1", post_id: "P-1", parent_id: "P-1",
        from: { id: "ASID-1", name: "Luis" }, message: "info",
      } }] }],
    });
    await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(handleComment).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "FACEBOOK", externalCommentId: "C-1" })
    );
  });

  it("REGRESIÓN: un DM sigue yendo al intake y NO al motor de comentarios", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c1" });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } }] }],
    });
    await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(handleInboundMessage).toHaveBeenCalled();
    expect(handleComment).not.toHaveBeenCalled();
  });

  it("un comentario que revienta no tumba el resto del batch", async () => {
    handleComment.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ status: "procesado" });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: "17841", changes: [
        { field: "comments", value: { id: "C-1", text: "info", from: { id: "A" }, media: { id: "M" } } },
        { field: "comments", value: { id: "C-2", text: "info", from: { id: "B" }, media: { id: "M" } } },
      ] }],
    });
    const res = await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(handleComment).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/app/api/webhooks/meta-dm/route.test.ts`
Expected: FAIL — los 4 nuevos fallan (`handleComment` nunca se llama); los existentes siguen pasando.

- [ ] **Step 3: Modificar la ruta**

En `src/app/api/webhooks/meta-dm/route.ts`:

Actualizar el comentario de cabecera (línea 4):

```ts
//   Verify token: META_DM_VERIFY_TOKEN
//   Campos a suscribir: `messages` (DM) y `comments`/`feed` (comentarios) para
//   los objetos instagram y page. Meta permite UNA callback URL por objeto, así
//   que ambos tipos llegan aquí y se bifurcan por la forma del payload.
```

Agregar el import:

```ts
import { parseCommentWebhook } from "@/lib/comments/parse";
```

Después del bucle `for (const t of botTargets.values())` y **antes** de `recordHit`, insertar:

```ts
  // Comentarios (entry[].changes): camino independiente del de DMs. Un fallo
  // aquí nunca debe afectar lo que ya se ingirió arriba.
  const parsed = parseCommentWebhook(body);

  // `parsed.discarded`: SÍ eran comentarios pero les faltó un campo
  // obligatorio (típicamente `from`, cuando Meta lo omite porque el
  // comentarista bloqueó la Página, falta pages_read_engagement, o la cuenta
  // fue borrada). parseCommentWebhook es pura y no loguea; este es el único
  // lugar donde se deja rastro de un comentario de cliente real que se cayó.
  for (const d of parsed.discarded) {
    console.warn(
      `[meta-dm] comentario descartado (${d.reason}) platform=${d.platform} account=${d.accountId} comment=${d.externalCommentId ?? "?"}`
    );
  }

  let commentsProcessed = 0;
  for (const c of parsed.comments) {
    try {
      const { handleComment } = await import("@/lib/comments/handle-comment");
      const outcome = await handleComment(c);
      commentsProcessed++;
      results.push({ comment: c.externalCommentId, platform: c.platform, status: outcome.status });
    } catch (err) {
      results.push({
        comment: c.externalCommentId,
        platform: c.platform,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error("[meta-dm] comentario:", err);
    }
  }
```

Y cambiar el return final: `discarded` se suma al payload de respuesta para que quede visible sin tener que ir a los logs (no inventa campos nuevos en `results`, solo cuenta cuántos se cayeron en este batch).

```ts
  return NextResponse.json({
    ok: true,
    processed,
    comments: commentsProcessed,
    discarded: parsed.discarded.length,
  });
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/app/api/webhooks/meta-dm/route.test.ts`
Expected: PASS — todos, viejos y nuevos.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/meta-dm/route.ts src/app/api/webhooks/meta-dm/route.test.ts
git commit -m "feat(comments): bifurcar meta-dm entre DMs y comentarios"
```

---

## Task 9: Zod y CRUD de reglas

**Files:**
- Create: `src/server/comment-rules.schema.ts`
- Create: `src/app/api/admin/comment-rules/route.ts`
- Create: `src/app/api/admin/comment-rules/[id]/route.ts`
- Test: `src/app/api/admin/comment-rules/route.test.ts`

- [ ] **Step 1: Escribir el esquema Zod**

```ts
// src/server/comment-rules.schema.ts
// Validación de reglas de comentarios. Vive fuera de cualquier archivo
// "use server" (solo funciones async pueden exportarse de ahí).
import { z } from "zod";

export const PUBLIC_REPLY_MAX = 500;
export const DM_MAX = 900; // el límite de Meta es 1000; margen para {{usuario}}

export const commentRuleCreateSchema = z.object({
  name: z.string().min(2).max(120),
  connectorId: z.string().min(1),
  phrases: z.array(z.string().min(2).max(60)).min(1).max(20),
  publicReplies: z.array(z.string().min(1).max(PUBLIC_REPLY_MAX)).min(1).max(5),
  dmTemplate: z.string().min(1).max(DM_MAX),
  postFilter: z.array(z.string().min(3).max(120)).max(50).default([]),
  priority: z.number().int().min(1).max(999).default(100),
});

export const commentRuleUpdateSchema = commentRuleCreateSchema
  .omit({ connectorId: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

// z.infer da el tipo de SALIDA (postFilter y priority ya resueltos por el
// default). Para lo que el cliente MANDA hay que usar z.input.
export type CommentRuleCreateInput = z.input<typeof commentRuleCreateSchema>;
export type CommentRuleUpdateInput = z.input<typeof commentRuleUpdateSchema>;
```

- [ ] **Step 2: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const ruleFindMany = vi.fn();
const ruleCreate = vi.fn();
const connectorFindFirst = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commentRule: {
      findMany: (...a: unknown[]) => ruleFindMany(...a),
      create: (...a: unknown[]) => ruleCreate(...a),
    },
    leadConnector: { findFirst: (...a: unknown[]) => connectorFindFirst(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET, POST } from "./route";

function req(body: unknown) {
  return new Request("http://t/api/admin/comment-rules", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const VALID = {
  name: "Info Tulum",
  connectorId: "conn-ig",
  phrases: ["INFO", "Información"],
  publicReplies: ["Te escribo al DM 📩"],
  dmTemplate: "Hola {{usuario}}, te paso la info.",
};

beforeEach(() => {
  for (const m of [ruleFindMany, ruleCreate, connectorFindFirst, auditCreate]) m.mockReset();
  session.user.role = "ADMIN";
  connectorFindFirst.mockResolvedValue({ id: "conn-ig", provider: "INSTAGRAM", name: "IG Propyte" });
  ruleFindMany.mockResolvedValue([]);
  ruleCreate.mockResolvedValue({ id: "rule-1", name: "Info Tulum" });
  auditCreate.mockResolvedValue({});
});

describe("POST /api/admin/comment-rules", () => {
  it("crea la regla en pausa y con las frases normalizadas", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(ruleCreate.mock.calls[0][0].data).toMatchObject({
      name: "Info Tulum",
      connectorId: "conn-ig",
      phrases: ["info", "informacion"],
      isActive: false,
      priority: 100,
      postFilter: [],
    });
  });

  it("403 para rol sin permiso", async () => {
    session.user.role = "ASESOR";
    expect((await POST(req(VALID))).status).toBe(403);
  });

  it("400 si faltan frases o respuestas", async () => {
    expect((await POST(req({ ...VALID, phrases: [] }))).status).toBe(400);
    expect((await POST(req({ ...VALID, publicReplies: [] }))).status).toBe(400);
  });

  it("400 si el conector no es de Instagram ni Messenger", async () => {
    connectorFindFirst.mockResolvedValue({ id: "c", provider: "TIKTOK" });
    const res = await POST(req(VALID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Instagram o Messenger/);
  });

  it("404 si el conector no existe", async () => {
    connectorFindFirst.mockResolvedValue(null);
    expect((await POST(req(VALID))).status).toBe(404);
  });

  it("409 si otra regla activa de la misma cuenta ya usa la frase", async () => {
    ruleFindMany.mockResolvedValue([
      { id: "otra", name: "Genérica", isActive: true, phrases: ["info"] },
    ]);
    const res = await POST(req(VALID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Genérica");
  });

  it("permite la misma frase si la otra regla está en pausa", async () => {
    ruleFindMany.mockResolvedValue([
      { id: "otra", name: "Pausada", isActive: false, phrases: ["info"] },
    ]);
    expect((await POST(req(VALID))).status).toBe(201);
  });
});

describe("GET /api/admin/comment-rules", () => {
  it("devuelve arreglo vacío si las tablas aún no existen (pre-migración)", async () => {
    ruleFindMany.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it("propaga cualquier otro error de Prisma", async () => {
    ruleFindMany.mockRejectedValue(Object.assign(new Error("boom"), { code: "P1001" }));
    expect((await GET()).status).toBe(500);
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run src/app/api/admin/comment-rules/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 4: Implementar `route.ts` (GET, POST)**

```ts
// src/app/api/admin/comment-rules/route.ts
// CRUD de reglas de comentarios sociales. Mismo guard de roles que
// /api/admin/connectors. Las frases se guardan ya normalizadas: el matcher
// compara contra la forma normalizada y guardarlas así evita normalizar en
// cada comentario que entra.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { normalize } from "@/lib/comments/match";
import { commentRuleCreateSchema } from "@/server/comment-rules.schema";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

async function assertRole() {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) return null;
  return session;
}

/** P2021 = la tabla no existe: la migración manual aún no se aplicó. */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021";
}

export async function GET() {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const rules = await prisma.commentRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ connectorId: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
      include: {
        connector: { select: { id: true, name: true, provider: true } },
        _count: { select: { logs: true } },
      },
    });
    return NextResponse.json({ data: rules });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ data: [] });
    console.error("[comment-rules] GET:", err);
    return NextResponse.json({ error: "Error al listar reglas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = commentRuleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const connector = await prisma.leadConnector.findFirst({
    where: { id: parsed.data.connectorId, deletedAt: null },
    select: { id: true, provider: true },
  });
  if (!connector) return NextResponse.json({ error: "Conector no encontrado" }, { status: 404 });
  if (connector.provider !== "INSTAGRAM" && connector.provider !== "MESSENGER") {
    return NextResponse.json(
      { error: "El conector debe ser de Instagram o Messenger" },
      { status: 400 }
    );
  }

  const phrases = [...new Set(parsed.data.phrases.map(normalize).filter(Boolean))];
  if (phrases.length === 0) {
    return NextResponse.json({ error: "Las frases quedaron vacías al normalizar" }, { status: 400 });
  }

  // Colisión: dos reglas activas con la misma frase en la misma cuenta hacen
  // que una nunca dispare, sin ningún síntoma visible.
  const siblings = await prisma.commentRule.findMany({
    where: { connectorId: connector.id, deletedAt: null, isActive: true },
    select: { id: true, name: true, phrases: true },
  });
  const clash = siblings.find((s) => s.phrases.some((p) => phrases.includes(p)));
  if (clash) {
    return NextResponse.json(
      { error: `La regla activa "${clash.name}" ya usa una de esas frases` },
      { status: 409 }
    );
  }

  const rule = await prisma.commentRule.create({
    data: {
      name: parsed.data.name,
      connectorId: connector.id,
      phrases,
      publicReplies: parsed.data.publicReplies,
      dmTemplate: parsed.data.dmTemplate,
      postFilter: parsed.data.postFilter,
      priority: parsed.data.priority,
      isActive: false, // nace en pausa, se activa explícitamente
    },
    select: { id: true, name: true, isActive: true },
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "CREATE",
        entity: "CommentRule",
        entityId: rule.id,
        changes: { name: rule.name, phrases },
      },
    })
    .catch(() => {});

  return NextResponse.json({ data: rule }, { status: 201 });
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/app/api/admin/comment-rules/route.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: Implementar `[id]/route.ts` (PATCH, DELETE)**

```ts
// src/app/api/admin/comment-rules/[id]/route.ts
// Editar, activar/pausar y borrar (soft) una regla de comentarios.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { normalize } from "@/lib/comments/match";
import { commentRuleUpdateSchema } from "@/server/comment-rules.schema";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

async function assertRole() {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) return null;
  return session;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = commentRuleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const current = await prisma.commentRule.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, connectorId: true, phrases: true },
  });
  if (!current) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  const phrases = parsed.data.phrases
    ? [...new Set(parsed.data.phrases.map(normalize).filter(Boolean))]
    : current.phrases;
  if (phrases.length === 0) {
    return NextResponse.json({ error: "Las frases quedaron vacías al normalizar" }, { status: 400 });
  }

  // La colisión solo importa entre reglas ACTIVAS de la misma cuenta.
  const willBeActive = parsed.data.isActive ?? undefined;
  if (willBeActive !== false) {
    const siblings = await prisma.commentRule.findMany({
      where: {
        connectorId: current.connectorId,
        deletedAt: null,
        isActive: true,
        id: { not: current.id },
      },
      select: { name: true, phrases: true },
    });
    const clash = siblings.find((s) => s.phrases.some((p) => phrases.includes(p)));
    if (clash) {
      return NextResponse.json(
        { error: `La regla activa "${clash.name}" ya usa una de esas frases` },
        { status: 409 }
      );
    }
  }

  const rule = await prisma.commentRule.update({
    where: { id: current.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.phrases !== undefined ? { phrases } : {}),
      ...(parsed.data.publicReplies !== undefined
        ? { publicReplies: parsed.data.publicReplies }
        : {}),
      ...(parsed.data.dmTemplate !== undefined ? { dmTemplate: parsed.data.dmTemplate } : {}),
      ...(parsed.data.postFilter !== undefined ? { postFilter: parsed.data.postFilter } : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
    select: { id: true, name: true, isActive: true },
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entity: "CommentRule",
        entityId: rule.id,
        changes: parsed.data as object,
      },
    })
    .catch(() => {});

  return NextResponse.json({ data: rule });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const rule = await prisma.commentRule.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!rule) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  // Soft delete: el log conserva ruleId con ON DELETE SET NULL solo si se
  // borrara de verdad; en soft delete el historial queda íntegro.
  await prisma.commentRule.update({
    where: { id: rule.id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "DELETE",
        entity: "CommentRule",
        entityId: rule.id,
        changes: { name: rule.name },
      },
    })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: **cero errores**. Verificado el 2026-08-05 en esta rama: `npx tsc --noEmit` sale limpio con exit 0. No hay errores preexistentes que tolerar, así que cualquier error que aparezca es de tu cambio.

- [ ] **Step 8: Commit**

```bash
git add src/server/comment-rules.schema.ts src/app/api/admin/comment-rules/
git commit -m "feat(comments): API CRUD de reglas con aviso de colision de frases"
```

---

## Task 10: API de log, reintento y probador

**Files:**
- Create: `src/app/api/admin/comment-rules/logs/route.ts`
- Create: `src/app/api/admin/comment-rules/logs/[id]/retry/route.ts`
- Create: `src/app/api/admin/comment-rules/test/route.ts`
- Test: `src/app/api/admin/comment-rules/test/route.test.ts`

- [ ] **Step 1: Escribir el test del probador (es el que tiene lógica propia)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "MARKETING" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const ruleFindMany = vi.fn();
const logCount = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commentRule: { findMany: (...a: unknown[]) => ruleFindMany(...a) },
    commentRuleLog: { count: (...a: unknown[]) => logCount(...a) },
  },
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }) as never;
}

const RULE = {
  id: "rule-1",
  name: "Info Tulum",
  isActive: true,
  priority: 100,
  phrases: ["info"],
  postFilter: [],
  publicReplies: ["Te escribo al DM 📩", "Ya te mandé privado 📩"],
  dmTemplate: "Hola {{usuario}}, aquí va la info.",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  ruleFindMany.mockReset();
  logCount.mockReset();
  logCount.mockResolvedValue(0);
  session.user.role = "MARKETING";
});

describe("POST /api/admin/comment-rules/test", () => {
  it("devuelve la regla, la frase y los textos ya renderizados", async () => {
    ruleFindMany.mockResolvedValue([RULE]);
    const res = await POST(req({ connectorId: "conn-ig", commentText: "mándame INFO", usuario: "luisf" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      match: {
        ruleId: "rule-1",
        ruleName: "Info Tulum",
        phrase: "info",
        publicText: "Te escribo al DM 📩",
        dmText: "Hola luisf, aquí va la info.",
      },
      pausedMatch: null,
    });
  });

  it("muestra la variante que toca según los disparos previos", async () => {
    ruleFindMany.mockResolvedValue([RULE]);
    logCount.mockResolvedValue(1);
    const res = await POST(req({ connectorId: "conn-ig", commentText: "info" }));
    expect((await res.json()).match.publicText).toBe("Ya te mandé privado 📩");
  });

  it("sin match activo, avisa si una regla EN PAUSA habría disparado", async () => {
    ruleFindMany.mockResolvedValue([{ ...RULE, isActive: false }]);
    const res = await POST(req({ connectorId: "conn-ig", commentText: "info" }));
    expect(await res.json()).toEqual({
      match: null,
      pausedMatch: { ruleId: "rule-1", ruleName: "Info Tulum", phrase: "info" },
    });
  });

  it("sin ninguna coincidencia devuelve match y pausedMatch en null", async () => {
    ruleFindMany.mockResolvedValue([RULE]);
    const res = await POST(req({ connectorId: "conn-ig", commentText: "qué bonito" }));
    expect(await res.json()).toEqual({ match: null, pausedMatch: null });
  });

  it("400 sin texto de comentario", async () => {
    expect((await POST(req({ connectorId: "conn-ig", commentText: "" }))).status).toBe(400);
  });

  it("403 para rol sin permiso", async () => {
    session.user.role = "ASESOR";
    expect((await POST(req({ connectorId: "c", commentText: "info" }))).status).toBe(403);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/app/api/admin/comment-rules/test/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 3: Implementar el probador**

```ts
// src/app/api/admin/comment-rules/test/route.ts
// Dry-run del matcher: qué regla ganaría y con qué textos. CERO llamadas a
// Graph — desde el probador es imposible publicar algo por accidente.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { matchRule } from "@/lib/comments/match";
import { renderTemplate, pickVariant } from "@/lib/comments/template";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

const schema = z.object({
  connectorId: z.string().min(1),
  commentText: z.string().min(1).max(2000),
  postId: z.string().max(120).optional(),
  usuario: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { connectorId, commentText, usuario } = parsed.data;
  const postId = parsed.data.postId ?? "__PRUEBA__";

  const rules = await prisma.commentRule.findMany({
    where: { connectorId, deletedAt: null },
  });

  const active = rules.filter((r) => r.isActive);
  const hit = matchRule(active, commentText, postId);

  if (!hit) {
    // Nada activo coincide: decir si una pausada lo habría hecho ahorra el
    // "¿por qué no disparó?" que si no se contesta leyendo la base.
    const paused = matchRule(
      rules.filter((r) => !r.isActive),
      commentText,
      postId
    );
    return NextResponse.json({
      match: null,
      pausedMatch: paused
        ? { ruleId: paused.rule.id, ruleName: paused.rule.name, phrase: paused.phrase }
        : null,
    });
  }

  // Mismo conteo que usa el motor: el probador enseña la variante real.
  const fired = await prisma.commentRuleLog.count({
    where: { ruleId: hit.rule.id, publicReplyStatus: "SENT" },
  });
  const vars = { usuario: usuario ?? null };

  return NextResponse.json({
    match: {
      ruleId: hit.rule.id,
      ruleName: hit.rule.name,
      phrase: hit.phrase,
      publicText: renderTemplate(pickVariant(hit.rule.publicReplies, fired) ?? "", vars),
      dmText: renderTemplate(hit.rule.dmTemplate, vars),
    },
    pausedMatch: null,
  });
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/app/api/admin/comment-rules/test/route.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Implementar el GET del log**

```ts
// src/app/api/admin/comment-rules/logs/route.ts
// Log de comentarios que dispararon regla. Filtros por regla y por estado.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];
const PAGE_SIZE_MAX = 100;

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId");
  const onlyFailed = url.searchParams.get("failed") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Number(url.searchParams.get("pageSize") ?? 25));

  const where = {
    ...(ruleId ? { ruleId } : {}),
    ...(onlyFailed
      ? { OR: [{ publicReplyStatus: "FAILED" as const }, { dmStatus: "FAILED" as const }] }
      : {}),
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.commentRuleLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          rule: { select: { id: true, name: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.commentRuleLog.count({ where }),
    ]);
    return NextResponse.json({ data: rows, total, page, pageSize });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2021") {
      return NextResponse.json({ data: [], total: 0, page, pageSize });
    }
    console.error("[comment-rules] logs GET:", err);
    return NextResponse.json({ error: "Error al listar el log" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Implementar el reintento**

```ts
// src/app/api/admin/comment-rules/logs/[id]/retry/route.ts
// Reintento manual de una acción FAILED. Reusa el texto EXACTO que se guardó:
// reconstruirlo podría mandar otra variante y confundir a quien comentó.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";
import { replyToComment, sendPrivateReply } from "@/lib/comments/graph";
import { persistOpenerForKnownContact } from "@/lib/comments/link-comment-origin";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const log = await prisma.commentRuleLog.findUnique({ where: { id: params.id } });
  if (!log) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
  if (log.publicReplyStatus !== "FAILED" && log.dmStatus !== "FAILED") {
    return NextResponse.json({ error: "Nada que reintentar en este registro" }, { status: 400 });
  }

  const connector = await prisma.leadConnector.findFirst({
    where: { id: log.connectorId, deletedAt: null },
  });
  if (!connector) return NextResponse.json({ error: "Conector no disponible" }, { status: 400 });

  const token = getSocialPageToken(connector);
  if (!token) {
    return NextResponse.json({ error: "Conector sin pageAccessToken" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (log.publicReplyStatus === "FAILED" && log.publicText) {
    try {
      const reply = await replyToComment(
        log.platform,
        token,
        log.externalCommentId,
        log.publicText
      );
      data.publicReplyStatus = "SENT";
      data.publicReplyId = reply.id;
      data.publicReplyError = null;
    } catch (err) {
      data.publicReplyError = errorText(err);
    }
  }

  if (log.dmStatus === "FAILED" && log.dmText) {
    try {
      const dm = await sendPrivateReply(token, log.externalCommentId, log.dmText);
      data.dmStatus = "SENT";
      data.dmRecipientId = dm.recipientId;
      data.dmExternalMessageId = dm.messageId;
      data.dmError = null;
      if (dm.recipientId) {
        await persistOpenerForKnownContact({
          platform: log.platform,
          connectorId: log.connectorId,
          recipientId: dm.recipientId,
          text: log.dmText,
          externalMessageId: dm.messageId,
        }).catch((err) => console.error("[comments] opener en reintento:", err));
      }
    } catch (err) {
      data.dmError = errorText(err);
    }
  }

  const updated = await prisma.commentRuleLog.update({ where: { id: log.id }, data });
  return NextResponse.json({ data: updated });
}
```

- [ ] **Step 7: Verificar tipos y toda la suite**

Run: `npx tsc --noEmit && npx vitest run src/lib/comments src/app/api/admin/comment-rules`
Expected: `tsc` con **cero errores** (exit 0); todos los tests de comentarios en verde.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/admin/comment-rules/
git commit -m "feat(comments): API de log, reintento manual y probador en seco"
```

---

## Task 11: Interfaz — Admin → Comentarios

**Files:**
- Create: `src/components/admin/comments/comment-rules-tab.tsx`
- Create: `src/components/admin/comments/comment-rule-dialog.tsx`
- Create: `src/components/admin/comments/comment-rule-tester.tsx`
- Create: `src/components/admin/comments/comment-rule-logs.tsx`
- Modify: `src/components/admin/admin-content.tsx`
- Modify: `src/components/config/config-center.tsx`

- [ ] **Step 1: Crear los tipos compartidos y el diálogo**

`src/components/admin/comments/comment-rule-dialog.tsx`:

```tsx
// Alta y edición de una regla de comentarios. El aviso de colisión de frases
// se calcula contra las reglas hermanas ya cargadas: es el error que en
// producción no da síntoma (gana la de mayor prioridad y la otra calla).
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";

export interface ConnectorOption {
  id: string;
  name: string;
  provider: "INSTAGRAM" | "MESSENGER";
}

export interface CommentRuleRow {
  id: string;
  name: string;
  connectorId: string;
  isActive: boolean;
  priority: number;
  phrases: string[];
  publicReplies: string[];
  dmTemplate: string;
  postFilter: string[];
  connector: { id: string; name: string; provider: string };
  _count: { logs: number };
}

const MAX_VARIANTS = 5;

// Este repo no tiene componente Textarea: se usa <textarea> nativo con la clase
// form-input, igual que bot-agents-tab.tsx y playbook-tab.tsx.
const TEXTAREA_CLASS = "form-input w-full resize-none text-[13px]";

/** Espejo de normalize() del matcher: lo que el usuario ve es lo que se compara. */
function normalizePreview(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function CommentRuleDialog({
  open, onOpenChange, connectors, rules, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectors: ConnectorOption[];
  rules: CommentRuleRow[];
  editing: CommentRuleRow | null;
  onSaved: () => void;
}) {
  const [connectorId, setConnectorId] = useState("");
  const [name, setName] = useState("");
  const [phrases, setPhrases] = useState<string[]>([]);
  const [phraseDraft, setPhraseDraft] = useState("");
  const [publicReplies, setPublicReplies] = useState<string[]>([""]);
  const [dmTemplate, setDmTemplate] = useState("");
  const [postFilter, setPostFilter] = useState("");
  const [priority, setPriority] = useState(100);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    if (editing) {
      setConnectorId(editing.connectorId);
      setName(editing.name);
      setPhrases(editing.phrases);
      setPublicReplies(editing.publicReplies.length ? editing.publicReplies : [""]);
      setDmTemplate(editing.dmTemplate);
      setPostFilter(editing.postFilter.join("\n"));
      setPriority(editing.priority);
    } else {
      setConnectorId(connectors[0]?.id ?? "");
      setName("");
      setPhrases([]);
      setPublicReplies([""]);
      setDmTemplate("");
      setPostFilter("");
      setPriority(100);
    }
    setPhraseDraft("");
  }, [open, editing, connectors]);

  const normalized = phrases.map(normalizePreview);
  const clashes = rules
    .filter((r) => r.connectorId === connectorId && r.isActive && r.id !== editing?.id)
    .flatMap((r) => r.phrases.filter((p) => normalized.includes(p)).map((p) => ({ rule: r.name, phrase: p })));

  function addPhrase() {
    const value = phraseDraft.trim();
    if (!value) return;
    if (!phrases.some((p) => normalizePreview(p) === normalizePreview(value))) {
      setPhrases([...phrases, value]);
    }
    setPhraseDraft("");
  }

  async function save() {
    setError("");
    const cleanReplies = publicReplies.map((r) => r.trim()).filter(Boolean);
    if (!name.trim() || !connectorId || phrases.length === 0 || cleanReplies.length === 0 || !dmTemplate.trim()) {
      setError("Faltan nombre, cuenta, frases, al menos una respuesta pública y el mensaje privado");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      connectorId,
      phrases,
      publicReplies: cleanReplies,
      dmTemplate: dmTemplate.trim(),
      postFilter: postFilter.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
      priority,
    };
    const res = await fetch(
      editing ? `/api/admin/comment-rules/${editing.id}` : "/api/admin/comment-rules",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...payload, connectorId: undefined } : payload),
      }
    );
    setSaving(false);
    if (res.ok) {
      onOpenChange(false);
      onSaved();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(typeof data.error === "string" ? data.error : "No se pudo guardar la regla");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar regla" : "Nueva regla de comentarios"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Cuenta</Label>
            <Select value={connectorId} onValueChange={setConnectorId} disabled={!!editing}>
              <SelectTrigger><SelectValue placeholder="Elige una cuenta" /></SelectTrigger>
              <SelectContent>
                {connectors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.provider === "INSTAGRAM" ? "Instagram" : "Facebook"} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {connectors.length === 0 && (
              <p className="text-[11px] text-destructive">
                No hay conectores de Instagram o Messenger activos. Créalos en Admin → Integraciones.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Info — campaña Tulum" />
          </div>

          <div className="space-y-1.5">
            <Label>Palabras o frases que disparan</Label>
            <div className="flex gap-2">
              <Input
                value={phraseDraft}
                onChange={(e) => setPhraseDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhrase(); } }}
                placeholder="info"
              />
              <Button type="button" variant="outline" size="sm" onClick={addPhrase}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {phrases.map((p) => (
                <span key={p} className="badge badge-neutral inline-flex items-center gap-1">
                  {p}
                  <button type="button" onClick={() => setPhrases(phrases.filter((x) => x !== p))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            {phrases.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Se compara como: {normalized.map((n) => `"${n}"`).join(", ")} — palabra completa,
                sin acentos ni mayúsculas. &quot;info&quot; no dispara con &quot;informal&quot;.
              </p>
            )}
            {clashes.length > 0 && (
              <p className="text-[11px] text-destructive">
                Choque: {clashes.map((c) => `"${c.phrase}" ya la usa la regla activa "${c.rule}"`).join(" · ")}.
                Solo dispararía una de las dos.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Respuestas públicas (rotan)</Label>
            {publicReplies.map((r, i) => (
              <div key={i} className="flex gap-2">
                <textarea
                  className={TEXTAREA_CLASS}
                  rows={2}
                  value={r}
                  maxLength={500}
                  onChange={(e) => {
                    const next = [...publicReplies];
                    next[i] = e.target.value;
                    setPublicReplies(next);
                  }}
                  placeholder="¡Listo {{usuario}}! Te escribo al privado 📩"
                />
                {publicReplies.length > 1 && (
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setPublicReplies(publicReplies.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {publicReplies.length < MAX_VARIANTS && (
              <Button type="button" variant="outline" size="sm" onClick={() => setPublicReplies([...publicReplies, ""])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Otra variante
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">
              Varias variantes evitan publicar el mismo texto en cadena, que es lo que Meta
              interpreta como spam.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Mensaje privado (DM)</Label>
            <textarea
              className={TEXTAREA_CLASS}
              rows={4}
              maxLength={900}
              value={dmTemplate}
              onChange={(e) => setDmTemplate(e.target.value)}
              placeholder="Hola {{usuario}}, gracias por comentar. Te comparto la info de..."
            />
            <p className="text-[11px] text-muted-foreground">
              Después de este mensaje el bot sigue la conversación en el Inbox.
              Variable disponible: <code>{"{{usuario}}"}</code>.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Publicaciones (opcional)</Label>
            <textarea
              className={TEXTAREA_CLASS}
              rows={2}
              value={postFilter}
              onChange={(e) => setPostFilter(e.target.value)}
              placeholder="MEDIA-1&#10;MEDIA-2"
            />
            <p className="text-[11px] text-muted-foreground">
              Vacío = todos los posts de la cuenta. Solo IDs, no URLs: el ID aparece en el
              log en cuanto llega el primer comentario, y ahí puedes copiarlo.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Prioridad</Label>
            <Input type="number" min={1} max={999} value={priority}
              onChange={(e) => setPriority(Number(e.target.value))} />
            <p className="text-[11px] text-muted-foreground">Menor número gana si dos reglas coinciden.</p>
          </div>

          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <Button className="w-full" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear (queda en pausa)"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Crear el probador en seco**

`src/components/admin/comments/comment-rule-tester.tsx`:

```tsx
// Probador en seco: qué regla ganaría y con qué textos. No llama a Graph.
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ConnectorOption } from "./comment-rule-dialog";

interface TestResult {
  match: { ruleName: string; phrase: string; publicText: string; dmText: string } | null;
  pausedMatch: { ruleName: string; phrase: string } | null;
}

export function CommentRuleTester({ connectors }: { connectors: ConnectorOption[] }) {
  const [connectorId, setConnectorId] = useState(connectors[0]?.id ?? "");
  const [commentText, setCommentText] = useState("");
  const [usuario, setUsuario] = useState("");
  const [postId, setPostId] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!connectorId || !commentText.trim()) return;
    setLoading(true);
    const res = await fetch("/api/admin/comment-rules/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectorId,
        commentText,
        usuario: usuario.trim() || undefined,
        postId: postId.trim() || undefined,
      }),
    });
    setLoading(false);
    setResult(res.ok ? await res.json() : null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Probar una regla</CardTitle>
        <CardDescription>
          Escribe un comentario de ejemplo y mira qué pasaría. No publica nada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Cuenta</Label>
            <Select value={connectorId} onValueChange={setConnectorId}>
              <SelectTrigger><SelectValue placeholder="Cuenta" /></SelectTrigger>
              <SelectContent>
                {connectors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Usuario (opcional)</Label>
            <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="luisf" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Comentario</Label>
          <Input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="mándame info porfa" />
        </div>
        <div className="space-y-1.5">
          <Label>ID de publicación (opcional, para probar el filtro)</Label>
          <Input value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="MEDIA-1" />
        </div>
        <Button size="sm" onClick={run} disabled={loading || !commentText.trim()}>
          {loading ? "Probando…" : "Probar"}
        </Button>

        {result && (
          <div className="rounded-md border p-3 text-sm space-y-2" style={{ borderColor: "var(--border-default)" }}>
            {result.match ? (
              <>
                <p><span className="font-medium">Regla:</span> {result.match.ruleName} (frase &quot;{result.match.phrase}&quot;)</p>
                <p><span className="font-medium">Respuesta pública:</span> {result.match.publicText}</p>
                <p><span className="font-medium">DM:</span> {result.match.dmText}</p>
              </>
            ) : result.pausedMatch ? (
              <p className="text-muted-foreground">
                Ninguna regla activa coincide, pero la regla <strong>en pausa</strong>{" "}
                &quot;{result.pausedMatch.ruleName}&quot; habría disparado con &quot;{result.pausedMatch.phrase}&quot;.
              </p>
            ) : (
              <p className="text-muted-foreground">Ninguna regla coincide con ese comentario.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Crear la tabla de log**

`src/components/admin/comments/comment-rule-logs.tsx`:

```tsx
// Log de comentarios que dispararon regla, con reintento y copiar ID de post.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format-date";
import { RefreshCw, Copy } from "lucide-react";

interface LogRow {
  id: string;
  createdAt: string;
  platform: "INSTAGRAM" | "FACEBOOK";
  postId: string;
  authorHandle: string | null;
  commentText: string;
  matchedPhrase: string;
  publicReplyStatus: string;
  publicReplyError: string | null;
  dmStatus: string;
  dmError: string | null;
  rule: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  SENT: "badge-success",
  FAILED: "badge-error",
  SKIPPED: "badge-neutral",
  PENDING: "badge-neutral",
};

export function CommentRuleLogs({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [onlyFailed, setOnlyFailed] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (onlyFailed) params.set("failed", "1");
    const res = await fetch(`/api/admin/comment-rules/logs?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    setRows(data.data ?? []);
    setTotal(data.total ?? 0);
  }, [page, onlyFailed]);

  useEffect(() => { load(); }, [load, reloadKey]);

  async function retry(id: string) {
    await fetch(`/api/admin/comment-rules/logs/${id}/retry`, { method: "POST" });
    load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Historial</CardTitle>
          <CardDescription>{total} comentarios dispararon una regla</CardDescription>
        </div>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={onlyFailed}
            onChange={(e) => { setOnlyFailed(e.target.checked); setPage(1); }} />
          Solo fallidos
        </label>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Sin registros todavía</p>
        )}
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--border-default)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-neutral">{r.platform === "INSTAGRAM" ? "IG" : "FB"}</span>
              <span className="font-semibold">{r.authorHandle ?? "sin nombre"}</span>
              <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span>
              <span className="badge badge-neutral">{r.rule?.name ?? "regla borrada"}</span>
              <span className={`badge ${STATUS_BADGE[r.publicReplyStatus]}`}>público: {r.publicReplyStatus}</span>
              <span className={`badge ${STATUS_BADGE[r.dmStatus]}`}>DM: {r.dmStatus}</span>
              {r.contact && (
                <a className="underline" href={`/contacts/${r.contact.id}`}>
                  {r.contact.firstName} {r.contact.lastName}
                </a>
              )}
            </div>
            <p className="mt-1">
              &quot;{r.commentText}&quot; <span className="text-muted-foreground">(coincidió: {r.matchedPhrase})</span>
            </p>
            {(r.publicReplyError || r.dmError) && (
              <p className="mt-1 text-destructive">{r.publicReplyError ?? r.dmError}</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button variant="outline" size="sm"
                onClick={() => navigator.clipboard.writeText(r.postId)} title="Copiar ID de la publicación">
                <Copy className="mr-1 h-3 w-3" /> ID del post
              </Button>
              {/* Solo Facebook: la URL de un post de IG usa shortcode, no el media_id
                  que manda el webhook, así que no hay link construible. */}
              {r.platform === "FACEBOOK" && (
                <a className="text-[12px] underline" target="_blank" rel="noreferrer"
                  href={`https://www.facebook.com/${r.postId}`}>
                  Ver publicación
                </a>
              )}
              {(r.publicReplyStatus === "FAILED" || r.dmStatus === "FAILED") && (
                <Button variant="outline" size="sm" onClick={() => retry(r.id)}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Reintentar
                </Button>
              )}
            </div>
          </div>
        ))}
        {total > 25 && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Crear el orquestador de la pestaña**

`src/components/admin/comments/comment-rules-tab.tsx`:

```tsx
// Pestaña Admin → Comentarios: reglas de palabra clave → respuesta pública + DM.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Pause, Play, Pencil, Trash2 } from "lucide-react";
import { CommentRuleDialog, type CommentRuleRow, type ConnectorOption } from "./comment-rule-dialog";
import { CommentRuleTester } from "./comment-rule-tester";
import { CommentRuleLogs } from "./comment-rule-logs";

export function CommentRulesTab() {
  const [rules, setRules] = useState<CommentRuleRow[]>([]);
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CommentRuleRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    const [rulesRes, connRes] = await Promise.all([
      fetch("/api/admin/comment-rules"),
      fetch("/api/admin/connectors"),
    ]);
    if (rulesRes.ok) setRules((await rulesRes.json()).data ?? []);
    if (connRes.ok) {
      const all = (await connRes.json()).data ?? [];
      setConnectors(
        all
          .filter((c: { provider: string; status: string }) =>
            (c.provider === "INSTAGRAM" || c.provider === "MESSENGER") && c.status === "ACTIVE")
          .map((c: { id: string; name: string; provider: ConnectorOption["provider"] }) => ({
            id: c.id, name: c.name, provider: c.provider,
          }))
      );
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(rule: CommentRuleRow) {
    const res = await fetch(`/api/admin/comment-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(typeof data.error === "string" ? data.error : "No se pudo cambiar el estado");
    }
    load();
  }

  async function remove(rule: CommentRuleRow) {
    if (!confirm(`¿Eliminar la regla "${rule.name}"? El historial se conserva.`)) return;
    await fetch(`/api/admin/comment-rules/${rule.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Reglas de comentarios</CardTitle>
            <CardDescription>
              Cuando alguien comenta la palabra clave: respuesta pública + DM privado.
              Después del DM, el bot sigue la conversación en el Inbox.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Nueva regla
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {rules.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Sin reglas configuradas
            </p>
          )}
          {rules.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border p-3"
              style={{ borderColor: "var(--border-default)" }}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold">{r.name}</span>
                  <span className="badge badge-neutral">
                    {r.connector.provider === "INSTAGRAM" ? "Instagram" : "Facebook"} · {r.connector.name}
                  </span>
                  <span className={`badge ${r.isActive ? "badge-success" : "badge-neutral"}`}>
                    {r.isActive ? "ACTIVA" : "EN PAUSA"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.phrases.map((p) => (
                    <span key={p} className="badge badge-neutral">{p}</span>
                  ))}
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {r._count.logs} disparos · prioridad {r.priority} ·{" "}
                  {r.postFilter.length ? `${r.postFilter.length} publicaciones` : "toda la cuenta"} ·{" "}
                  {r.publicReplies.length} variante(s)
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => toggle(r)}
                  title={r.isActive ? "Pausar" : "Activar"}>
                  {r.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="sm"
                  onClick={() => { setEditing(r); setDialogOpen(true); }} title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => remove(r)} title="Eliminar">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <CommentRuleTester connectors={connectors} />
      <CommentRuleLogs reloadKey={reloadKey} />

      <CommentRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connectors={connectors}
        rules={rules}
        editing={editing}
        onSaved={() => { load(); setReloadKey((k) => k + 1); }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Registrar la pestaña en `admin-content.tsx`**

Agregar el import junto a los otros de tabs (después de `import { BotAgentsTab, ... } from "./bot-agents-tab";`):

```tsx
import { CommentRulesTab } from "./comments/comment-rules-tab";
```

Agregar la entrada en `ADMIN_TAB_TITLES`, después de `botAgents`:

```tsx
  comments: "Reglas de comentarios",
```

Agregar el bloque de render después del de `botAgents`:

```tsx
      {activeTab === "comments" && <CommentRulesTab />}
```

- [ ] **Step 6: Agregar la tarjeta de acceso en `config-center.tsx`**

En el import de `lucide-react`, agregar `MessageCircle`. En el grupo `"Bot conversacional"`, después de la tarjeta de `botAgents`:

```tsx
      { href: "/admin?tab=comments", icon: MessageCircle, title: "Reglas de comentarios", items: ["Palabra clave → respuesta pública", "DM privado automático", "Instagram y Facebook", "Historial con reintento"] },
```

- [ ] **Step 7: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: **cero errores** (exit 0).

Run: `npm run build`
Expected: `exit 0`. Si aparece un error de caché stale, borrar `.next/cache` y repetir.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/comments/ src/components/admin/admin-content.tsx src/components/config/config-center.tsx
git commit -m "feat(comments): pestana Admin de reglas con probador y log"
```

---

## Task 12: Gates finales y checklist de smoke

**Files:**
- Create: `docs/qa/comment-rules-smoke.md`

- [ ] **Step 1: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS. El total sube ~122 tests respecto a `main` (8 archivos nuevos en
`src/lib/comments/` y `src/app/api/admin/comment-rules/` + tests agregados a
`src/lib/messaging/core.test.ts` y `src/app/api/webhooks/meta-dm/route.test.ts`;
no ~78 como se estimó al escribir este plan, antes de implementar). Cero fallos
nuevos; si algo de `messaging/` falla, es regresión de Task 7 y se arregla antes
de seguir.

- [ ] **Step 2: Typecheck y build**

Run: `npx tsc --noEmit && npm run build`
Expected: `tsc` con **cero errores** y build con exit 0.

- [ ] **Step 3: Escribir el checklist de smoke**

`docs/qa/comment-rules-smoke.md`:

```markdown
# Smoke: reglas de comentarios sociales

Spec: `docs/superpowers/specs/2026-08-04-reglas-comentarios-sociales-design.md`

## Gate de infraestructura (sin esto la feature está dormida, no rota)

- [ ] Migración `prisma/migrations-manual/2026-08-04-comment-rules.sql` aplicada en
      Supabase `oaijxdpevakashxshhvm` (la aplica Luis).
- [ ] App *CRM Propyte* → Webhooks → objeto `page`: suscribir campo **`feed`**.
- [ ] App *CRM Propyte* → Webhooks → objeto `instagram`: suscribir campo **`comments`**.
- [ ] Acceso Avanzado (App Review) a: `pages_manage_engagement`, `pages_read_engagement`,
      `instagram_manage_comments`, `instagram_manage_messages`.
- [ ] Conector de Instagram y/o Messenger ACTIVO con `pageAccessToken` vigente.

## Verificación funcional

1. [ ] Admin → Comentarios carga sin error aun antes de aplicar la migración
       (lista vacía, no pantalla en blanco).
2. [ ] Crear regla con frase `info`, una respuesta pública y un DM. Queda **EN PAUSA**.
3. [ ] Probador: comentario `mándame info` → muestra regla, variante pública y DM.
4. [ ] Probador: comentario `informal` → ninguna regla coincide.
5. [ ] Probador con la regla en pausa → avisa que una regla en pausa habría disparado.
6. [ ] Crear una segunda regla activa con la misma frase → el diálogo avisa del choque
       y la API responde 409.
7. [ ] Activar la regla. Comentar `info` desde una cuenta personal en un post real.
8. [ ] Aparece la respuesta pública en el post y llega el DM privado.
9. [ ] El log muestra la fila con público SENT y DM SENT.
10. [ ] Comentar `info` otra vez en el MISMO post con la MISMA cuenta → el log
        registra SKIPPED y no se publica nada nuevo.
11. [ ] Comentar `info` en OTRO post → sí responde (la cuota es por publicación).
12. [ ] Responder el DM desde la cuenta personal → se crea el contacto, el hilo aparece
        en el Inbox **en estado BOT**, con el opener antes de la respuesta, y el bot contesta.
13. [ ] El log de ese comentario ya muestra el contacto vinculado.
14. [ ] Contacto → Cronología: aparece la nota "Origen: comentario en la publicación …".
15. [ ] Comentar una respuesta anidada con `info` → no se responde (solo primer nivel).
16. [ ] REGRESIÓN: mandar un DM normal a la cuenta → sigue entrando al Inbox como siempre.
```

- [ ] **Step 4: Commit final**

```bash
git add docs/qa/comment-rules-smoke.md
git commit -m "docs: checklist de smoke de reglas de comentarios"
```

- [ ] **Step 5: Reportar a Luis lo que queda en sus manos**

No hacer push ni merge sin que Luis lo pida. Reportar:
- La migración manual está escrita pero **no aplicada** (Supabase compartida).
- Los campos `feed` y `comments` del webhook y los permisos de App Review son suyos.
- Con la migración aplicada y un conector activo, la feature se enciende regla por regla.

---

## Notas para quien implemente

**Lo que NO hay que hacer:**

- No crear un endpoint nuevo para comentarios. Meta permite una callback URL por objeto y esa URL ya es `/api/webhooks/meta-dm`.
- No mandar el opener del DM sin persistirlo cuando la persona ya es contacto. El eco de Meta lo registraría como `ADVISOR` y el takeover suave dejaría al bot mudo.
- No responder públicamente a respuestas anidadas: Instagram rechaza `/replies` sobre una respuesta.
- No calcular la rotación de variantes en el probador aparte del motor. Usar `pickVariant` en los dos lados o el probador miente.
- No devolver 500 a Meta cuando falla Graph: el comentario ya está en el log y el reintento chocaría con la idempotencia.
- No aplicar la migración desde el agente. La Supabase es compartida con el Hub.

**Orden de dependencias:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. Las tareas 2 a 5 son independientes entre sí y podrían ir en paralelo; de la 6 en adelante cada una depende de las anteriores.
