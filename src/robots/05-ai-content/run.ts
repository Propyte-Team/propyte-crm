/**
 * Robot 05 - AI Content Fallback (defensivo)
 *
 * Solo actua como relleno de gaps, nunca como regenerador.
 *
 * Reglas:
 *  1. Solo procesa unidades con ext_publicado = true (humano las aprobo)
 *  2. Solo toca si faltan campos criticos:
 *     - ext_content_es.metaTitle
 *     - ext_content_es.metaDescription
 *     - ext_content_es.hero (descripcion principal)
 *  3. Si ext_content_es.faq ya existe, NO lo toca (Felipe lo genero)
 *  4. Si ext_ai_enriched_at IS NOT NULL → skip (ya procesada)
 *  5. Al completar, setea ext_ai_enriched_at = now()
 *
 * Costo controlado:
 *  - Solo manual trigger (workflow_dispatch en GH Actions)
 *  - --limit obligatorio para runs manuales (default 20 por run)
 *  - Prompt cache con 1h TTL sobre el system prompt
 *
 * Uso:
 *   npx tsx src/robots/05-ai-content/run.ts --dry-run --limit 5
 *   npx tsx src/robots/05-ai-content/run.ts --limit 20
 */

import Anthropic from "@anthropic-ai/sdk";
import { closeDb, getDb } from "../shared/db";
import { parseCli } from "../shared/cli";
import { RobotLogger } from "../shared/logger";
import { execWrite, type DryRunContext } from "../shared/dry-run";
import type { ContentJsonb } from "../shared/types";

const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap para content generation
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface UnidadTarget {
  id: string;
  titulo_unidad: string | null;
  recamaras: number | null;
  banos_completos: number | null;
  superficie_total_m2: number | null;
  precio_mxn: number | null;
  estado_unidad: string | null;
  ext_content_es: ContentJsonb | null;
  // contexto del desarrollo
  nombre_desarrollo: string | null;
  municipio: string | null;
  estado: string | null;
  colonia: string | null;
}

async function fetchTargets(limit: number): Promise<UnidadTarget[]> {
  const db = getDb();
  return (await db.$queryRawUnsafe<UnidadTarget[]>(
    `SELECT u.id::text as id,
            u.titulo_unidad, u.recamaras, u.banos_completos, u.superficie_total_m2,
            u.precio_mxn, u.estado_unidad, u.ext_content_es,
            d.nombre_desarrollo, d.municipio, d.estado, d.colonia
     FROM real_estate_hub."Propyte_unidades" u
     LEFT JOIN real_estate_hub."Propyte_desarrollos" d ON d.id = u.id_desarrollo
     WHERE u.ext_publicado = true
       AND u.deleted_at IS NULL
       AND u.ext_ai_enriched_at IS NULL
       AND (
         u.ext_content_es IS NULL
         OR u.ext_content_es->>'metaTitle' IS NULL
         OR u.ext_content_es->>'metaDescription' IS NULL
       )
     ORDER BY u.created_at DESC
     LIMIT ${limit}`
  )) as UnidadTarget[];
}

interface AIContent {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  hero?: string; // descripcion corta solo si no existe
}

const SYSTEM_PROMPT = `Eres un experto en SEO de bienes raices en Mexico, especializado en el Caribe (Tulum, Playa del Carmen, Cancun, Merida). Generas contenido para listados inmobiliarios de lujo y preventa.

Formato de respuesta: JSON estricto con estas keys exactas:
{
  "metaTitle": "string, max 60 caracteres, incluye ubicacion y tipo",
  "metaDescription": "string, max 160 caracteres, call-to-action suave",
  "keywords": ["array", "de", "5-8", "keywords", "relevantes"],
  "hero": "string opcional, descripcion corta 200-300 caracteres si el input no tiene hero"
}

Reglas:
- No menciones precios exactos en meta (cambian). Usa rangos o "desde".
- Enfocate en el valor (ubicacion, amenidades, preventa), no en cliches.
- Tono: profesional, confiable, sin superlatives vacios ("el mejor", "increible").
- Si input tiene hero no vacio, NO generes hero nuevo (retorna sin esa key).`;

async function generateContent(
  client: Anthropic,
  target: UnidadTarget
): Promise<AIContent> {
  const inputContext = {
    titulo: target.titulo_unidad,
    desarrollo: target.nombre_desarrollo,
    ubicacion: [target.colonia, target.municipio, target.estado].filter(Boolean).join(", "),
    recamaras: target.recamaras,
    banos: target.banos_completos,
    m2: target.superficie_total_m2,
    precio_mxn: target.precio_mxn,
    estado_unidad: target.estado_unidad,
    hero_existente: target.ext_content_es?.hero ?? null,
  };

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Genera contenido SEO para este listado:\n\n${JSON.stringify(inputContext, null, 2)}`,
      },
    ],
  });

  const textBlock = msg.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude no devolvio text block");
  }

  // Parse JSON del response
  const text = textBlock.text.trim();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`Respuesta sin JSON parseable: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as AIContent;
  return parsed;
}

async function enrichUnidad(
  ctx: DryRunContext,
  client: Anthropic,
  target: UnidadTarget
): Promise<void> {
  const ai = await generateContent(client, target);

  // Merge defensivo: mantener campos existentes, solo agregar faltantes
  const currentContent = target.ext_content_es ?? {};
  const newContent: ContentJsonb = {
    ...currentContent,
    metaTitle: currentContent.metaTitle ?? ai.metaTitle,
    metaDescription: currentContent.metaDescription ?? ai.metaDescription,
  };

  // hero solo si no existe
  if (!currentContent.hero && ai.hero) {
    newContent.hero = ai.hero;
  }

  // keywords: acumular (no sobreescribir)
  const existingKeywords = Array.isArray(currentContent.keywords)
    ? (currentContent.keywords as string[])
    : [];
  const mergedKeywords = Array.from(new Set([...existingKeywords, ...(ai.keywords ?? [])]));
  newContent.keywords = mergedKeywords;

  await execWrite(
    ctx,
    `ai enrich unidad ${target.id.slice(0, 8)}`,
    `UPDATE real_estate_hub."Propyte_unidades"
     SET ext_content_es = $1::jsonb,
         ext_ai_enriched_at = now(),
         updated_at = now()
     WHERE id = $2::uuid`,
    [JSON.stringify(newContent), target.id]
  );
}

async function main() {
  const opts = parseCli();
  const logger = new RobotLogger("05-ai-content");
  const ctx: DryRunContext = { dryRun: opts.dryRun, logger };

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const run = await logger.start({
    dry_run: opts.dryRun,
    limit,
    model: MODEL,
  });

  try {
    logger.info(`fetching targets (limit=${limit})`);
    const targets = await fetchTargets(limit);
    logger.setMetric("targets_total", targets.length);
    logger.info(`found ${targets.length} unidades publicadas sin AI enrichment`);

    if (targets.length === 0) {
      logger.info("nothing to enrich (no unidades publicadas con gaps)");
      await logger.finish(run.id, opts.dryRun ? "dry_run" : "success");
      console.log("\n## SUMMARY\n{ \"targets_total\": 0 }\n");
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY requerido (hay " + targets.length + " targets pendientes)");
    }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    for (const target of targets) {
      try {
        await enrichUnidad(ctx, client, target);
        logger.metric("unidades_enriched", 1);
      } catch (err) {
        logger.error(`unidad ${target.id.slice(0, 8)} failed`, err);
        logger.metric("unidades_failed", 1);
      }
    }

    const errorCount = logger.getErrors().length;
    const status = errorCount === 0 ? (opts.dryRun ? "dry_run" : "success") : "partial";
    await logger.finish(run.id, status);

    console.log("\n## SUMMARY\n");
    console.log(JSON.stringify(logger.getMetrics(), null, 2));
  } catch (err) {
    logger.error("fatal", err);
    await logger.finish(run.id, "failure");
    throw err;
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
