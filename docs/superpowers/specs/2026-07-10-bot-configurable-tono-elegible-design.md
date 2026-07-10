# Motor de Bot configurable + tono elegible (Sub-proyecto A)

> Fecha: 2026-07-10 · Estado: diseño aprobado, pendiente review de spec
> Proyecto: propyte-crm · Área: `src/lib/bot/` + admin UI
> Contexto de memoria: `~/.claude/projects/c--Users-Luis/memory/project_propyte_crm.md`

## 1. Problema y objetivo

El bot conversacional "Sage" (WhatsApp L2) **suena robótico** en su primera prueba. La causa raíz no es arquitectura: es que la voz, el modelo, las reglas y el arranque están **hardcodeados** en `src/lib/bot/claude.ts`, y el `SAGE_SYSTEM_PROMPT` es ~90% prohibiciones con casi nada de guía positiva de tono y **cero ejemplos few-shot**.

Además el equipo necesita **configurar todos los enfoques del bot desde la app** y que el **tono sea elegible** (seleccionable), independiente de las tareas de calificación (que llegan en el Sub-proyecto B, playbook estilo ManyChat).

**Objetivo de A:** convertir el bot en un motor **configurable** cuyo system prompt se ensambla de capas componibles, con **tono elegible por preset curado** desde una UI admin, dejando el arreglo de "robótico" resuelto y el gancho listo para que B (playbook) se enchufe sin refactor.

## 2. Decisiones tomadas (cerradas)

- **Orden:** A primero (fundación), B (playbook) después. A entrega el arreglo de tono rápido y B se apoya en el motor de A.
- **Tono:** **presets curados** en código, seleccionables desde la app. No editor libre (garantiza calidad y respeto de reglas de marca). Un "override avanzado" queda fuera de alcance de A.
- **`BotConfig`:** **singleton** (un bot). Per-plaza / per-canal queda reservado para el futuro (campo `scope` no se agrega aún; se documenta como evolución).
- **Modelo:** default `claude-sonnet-5`; se añade `thinking: {type:"disabled"}` para evitar que el thinking adaptativo (ON por defecto en Sonnet 5) consuma `max_tokens` y trunque la respuesta.
- **Migración:** aditiva; la aplica Luis explícitamente (Supabase compartida). El código trae defaults seguros para no romperse antes de aplicarla.

## 3. Idea de arquitectura: system prompt en 4 capas

El prompt deja de ser una constante y se **ensambla en tiempo de ejecución**:

```
1. [Marca — FIJA]        anti-hype · data-gate · escalamiento · idioma · "no eres IA salvo pregunta" · brevedad(=maxLines)
2. [Tono — ELEGIBLE]     guíaDeVoz + ejemplos few-shot del preset activo
3. [Objetivo — DINÁMICO] hook opcional; en A = "saludo y calificación general"; en B = la tarea del playbook que toca
4. [Catálogo — DINÁMICO] catalogBrief(catalog) existente (data-gate: única fuente citable de cifras)
```

**Invariante clave:** cambiar de tono nunca toca las reglas ni las tareas; cambiar de tarea (B) nunca toca el tono. Esto materializa "sin cambiar el tono, el tono debería ser elegible".

## 4. Alcance

### Dentro de A
- Modelo `BotConfig` (+ enum `BotTonePreset`), singleton, editable desde la app.
- Presets de tono curados en código (`tone-presets.ts`), 4 presets, con `PROFESIONAL_CALIDO` como default y completamente redactado.
- Refactor de `claude.ts`: `SAGE_SYSTEM_PROMPT` → `buildSystemPrompt(...)` (función pura de 4 capas) + `askClaude` lee `config.model` y manda `thinking:disabled`.
- Loader `getBotConfig()` cacheado con defaults seguros.
- Wiring en `bot-respond.ts`: master switch, canales, arranque natural, `maxLines` desde config.
- UI admin "Configuración del Bot" (selector de tono con preview, toggles, escalamiento, modelo).
- Server fns `bot-config.ts` (read/update con `writeAudit`, RBAC ADMIN/MARKETING).
- Eval de tono `scripts/eval-bot-voice.ts` (manual, gates + LLM-judge).
- Migración aditiva + seed de la fila default.

### Fuera de A (va en B u otro)
- Playbook de calificación (`BotPlaybook`/`BotTask`), extracción a campos, progreso por conversación → **Sub-proyecto B**.
- Editor de tono libre / override avanzado.
- `BotConfig` per-plaza / per-canal.
- Exponer bot-config por el MCP admin (compatible, pero no en A).
- Cambios al brand-linter, al data-gate o al motor de workflows.

## 5. Modelo de datos

`prisma/schema.prisma` (schema `propyte_crm`). Aditivo.

```prisma
enum BotTonePreset {
  PROFESIONAL_CALIDO
  CALIDO_CERCANO_MX
  EJECUTIVO_SOBRIO
  NEUTRO_DIRECTO
  @@schema("propyte_crm")
}

model BotConfig {
  id                 String        @id @default(uuid())
  singleton          Boolean       @default(true) @unique  // garantiza una sola fila activa
  botEnabled         Boolean       @default(true)          // kill-switch global (≠ Conversation.botEnabled)
  tonePreset         BotTonePreset @default(PROFESIONAL_CALIDO)
  autonomyLevel      AutonomyLevel @default(L2)            // enum existente
  model              String        @default("claude-sonnet-5")
  openerStyle        String        @default("WARM_NAME")   // WARM_NAME | DIRECT
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

- **Singleton:** columna `singleton Boolean @unique @default(true)` → sólo puede existir una fila con `true`. El loader hace `findFirst`.
- Relación inversa `botConfigUpdates BotConfig[] @relation("BotConfigUpdatedBy")` en `User` (mínima).
- `escalationTriggers`/`enabledChannels` como Json (listas de strings) — evita DDL para agregar disparadores/canales.

## 6. Presets de tono (`src/lib/bot/tone-presets.ts`)

Data pura. Cada preset:

```ts
interface TonePreset {
  key: BotTonePreset;
  label: string;          // para la UI
  description: string;    // para la UI
  voiceGuidance: string;  // capa 2 del prompt
  fewShot: { role: "user" | "assistant"; content: string }[];  // ejemplos ilustrativos embebidos en el prompt
}
```

**`PROFESIONAL_CALIDO` (default) — guía de voz:**
- Escribe como un asesor senior real por WhatsApp: cordial y humano, pero sobrio y premium. Sin emoji. Sin signos de exclamación de más. Cero hype.
- Saluda por su nombre y reconoce lo que dijo antes de responder.
- Una idea por mensaje; 2–4 líneas; frases naturales, sin viñetas ni encabezados; contracciones normales del español.
- Cuando falte un dato, ofrécelo con naturalidad ("déjame confirmarte el número exacto y te lo paso", enlazando al asesor) en lugar de cortar seco.
- Haz **una** pregunta a la vez para perfilar.

**Ejemplos few-shot (PROFESIONAL_CALIDO):**
1. Apertura: `user: "Hola, vi un depa en Tulum"` → `assistant: "Hola, buenas. Qué bueno que te interesó Tulum. Para orientarte bien, ¿lo estás viendo para vivir, rentar o como inversión? Con eso te muestro lo que más te conviene."`
2. Precio sin catálogo (data-gate cálido): `user: "¿Cuánto cuesta?"` → `assistant: "Buena pregunta. Para darte el precio exacto y no un aproximado, ¿me confirmas cuál desarrollo o el rango que traes en mente? Así te aterrizo números reales."`
3. Transición a escala: `user: "Quiero apartarlo hoy"` → `assistant: "Me encanta que estés decidido. Eso lo ve directo tu asesor para dejarte todo en orden hoy mismo; te contacta enseguida. [ESCALAR]"`

**Otros presets** (misma estructura, distinta `voiceGuidance` + ejemplos):
- `CALIDO_CERCANO_MX`: español mexicano cercano, tuteo, emoji ocasional permitido, más coloquial. Mantiene anti-hype.
- `EJECUTIVO_SOBRIO`: cordial pero más formal/breve, tono corporativo suave, sin emoji.
- `NEUTRO_DIRECTO`: humano y fluido, va al grano con amabilidad, sin adornos.

Las reglas de marca (capa 1) y el `[ESCALAR]` son idénticas en todos los presets; sólo cambia el registro.

## 7. Ensamblado del prompt (`src/lib/bot/claude.ts`)

```ts
export function buildSystemPrompt(args: {
  config: BotConfigResolved;
  contact: { firstName: string; preferredLanguage: string };
  catalog: Development[];      // ya lo provee findMatchingDevelopments
  objective?: string;         // capa 3: null en A → default; B lo llena con la tarea del playbook
}): string { /* concatena capas 1–4 */ }
```

- **Capa 1 (marca, fija):** constante `BRAND_RULES` en el módulo (anti-hype, data-gate condicionado por `config.dataGateStrict`, escalamiento con `config.escalationTriggers`, idioma, "no eres IA salvo pregunta directa", brevedad `= config.maxLines` líneas).
- **Capa 2 (tono):** `preset.voiceGuidance` + `preset.fewShot` (los ejemplos se insertan como bloque ilustrativo dentro del system, no como turnos reales del historial).
- **Capa 3 (objetivo):** `args.objective ?? "Saluda y avanza en calificar (zona, presupuesto, plazo) con una sola pregunta a la vez."`
- **Capa 4 (catálogo):** `catalogBrief(catalog)` si hay; si no, la nota "no cites precios".

`askClaude`:
- `model = config.model` (env `BOT_MODEL` sigue como override).
- Body incluye `thinking: { type: "disabled" }` (evita gotcha de Sonnet 5).
- `max_tokens` sin cambio (300 para respuesta, 200 para resumen).

`getBotConfig()` (`src/lib/bot/config.ts`): `findFirst` de `bot_config`, cache en memoria (TTL corto o invalidación en update), **defaults seguros** si no hay fila (objeto `DEFAULT_BOT_CONFIG`) → el bot funciona igual antes de la migración.

## 8. Runtime (`src/lib/bot/bot-respond.ts`)

- Al inicio: `const config = await getBotConfig()`. Si `!config.botEnabled` → return false (bot apagado global). Si `!config.enabledChannels.includes(channel)` → return false.
- Arranque natural: reemplazar el placeholder mecánico
  `history.push({ role: "user", content: "(inicia la conversación: ...)" })`
  por una instrucción de primer contacto derivada de `config.openerStyle` (usa `contact.firstName` + interés/zona conocidos si existen). La calidez la produce el preset (capa 2), no la stage-direction.
- `system = buildSystemPrompt({ config, contact, catalog })` en vez de la concatenación actual.
- El resto del pipeline (linter → send/escala, resumen, escalateToHuman) queda **igual**.

## 9. Server fns (`src/server/bot-config.ts`)

- `getBotConfigForAdmin()` → devuelve la fila (o el default materializado).
- `updateBotConfig(input, actor)` → valida con zod (tonePreset ∈ enum, autonomyLevel ∈ enum, model ∈ allowlist `["claude-sonnet-5","claude-sonnet-4-6","claude-haiku-4-5"]`, maxLines 1–8, canales/triggers de listas conocidas), upsert singleton, `writeAudit(source='admin')`, invalida cache de `getBotConfig()`.
- RBAC: sólo ADMIN/MARKETING (patrón existente).

## 10. UI admin — "Configuración del Bot"

Página nueva en el área admin/settings existente (misma ruta/patrón que Integraciones). Secciones:
- **Estado:** master toggle (`botEnabled`) + canales habilitados.
- **Tono:** selector de los 4 presets con **preview en vivo** — al elegir uno muestra su `description` + 2–3 ejemplos (`fewShot`) leídos de `tone-presets.ts`.
- **Comportamiento:** autonomía (L0/L1/L2), arranque (WARM_NAME/DIRECT), longitud (`maxLines`), data-gate estricto (toggle).
- **Escalamiento:** lista editable de disparadores (chips).
- **Modelo:** selector (avanzado; default Sonnet 5).
- Guardar → `updateBotConfig`. Banner de "guardado" sin recargar (evitar el bug histórico de `window.location.reload()` que borra state — ver changelog CRM 2026-04-13).

## 11. Eval de tono (`scripts/eval-bot-voice.ts`)

Manual (cuesta unos centavos de API; requiere `ANTHROPIC_API_KEY`). No en CI.
- ~7 escenarios: apertura fría, precio **con** catálogo, precio **sin** catálogo, calificar zona, "quiero apartar" (→ escala), queja (→ escala), pregunta legal/fiscal (→ escala), mensaje en inglés (→ responder EN). (El de inglés puede combinarse; objetivo ≥7 casos.)
- Corre cada escenario contra el preset elegido por arg (`--preset=...`) o contra los 4.
- **Gates automáticos:** `lintBrandVoice` pasa; data-gate (sin cifras `$`/MXN inventadas cuando no hay catálogo); presencia de `[ESCALAR]` donde corresponde; idioma correcto.
- **LLM-judge:** segunda llamada a Claude que puntúa 1–5 (profesional-cálido / humano / no-robótico / sin-hype) con justificación.
- Salida: tabla `escenario → respuesta → score → PASS/FAIL de gates`.

## 12. Migración y archivos

**Migración** `prisma/migrations-manual/2026-07-10-botconfig.sql` — aditiva: crea enum `BotTonePreset`, tabla `bot_config`, y seed de la fila default (`PROFESIONAL_CALIDO`, `claude-sonnet-5`, `L2`, `botEnabled=true`). **La aplica Luis** en Supabase (compartida); el código no la corre solo.

**Archivos**
- Nuevos: `src/lib/bot/tone-presets.ts`, `src/lib/bot/config.ts`, `src/server/bot-config.ts`, UI de settings (página + componente), `scripts/eval-bot-voice.ts`, `prisma/migrations-manual/2026-07-10-botconfig.sql`.
- Editados: `prisma/schema.prisma` (+`BotConfig`, +enum, relación en `User`), `src/lib/bot/claude.ts` (builder + model/thinking), `src/lib/bot/bot-respond.ts` (config wiring + arranque).
- Tests: `tone-presets` snapshot/estructura; `buildSystemPrompt` unit (arma 4 capas, respeta `maxLines`/`dataGateStrict`/preset); se conservan los tests de brand-linter y channel.

## 13. Criterios de aceptación

1. Con la fila default aplicada, `botRespond` produce respuestas en tono **profesional-cálido** (validado por el eval: LLM-judge ≥ 4/5 en los escenarios base) sin hype y sin cifras inventadas.
2. Cambiar `tonePreset` desde la UI cambia el registro de las respuestas **sin** alterar reglas de marca ni escalamiento (verificable corriendo el eval contra 2 presets).
3. `botEnabled=false` apaga el bot globalmente; un canal fuera de `enabledChannels` no recibe respuesta del bot.
4. En Sonnet 5 no hay truncados por thinking (respuestas completas ≤ `maxLines`).
5. Antes de aplicar la migración, el bot sigue funcionando con `DEFAULT_BOT_CONFIG` (sin errores).
6. `buildSystemPrompt` es función pura testeada; el hook `objective` acepta un string y se refleja en la capa 3 (listo para B).
7. Todas las mutaciones de config quedan en `AuditLog` (`source='admin'`).

## 14. Gancho para el Sub-proyecto B (playbook)

`buildSystemPrompt({ objective })` es el único punto de integración: el runtime del playbook (B) calculará la tarea actual y la pasará como `objective` (capa 3). Nada más de A cambia. `BotConfig` podrá ganar `activePlaybookId` en B sin migración disruptiva (columna aditiva).
