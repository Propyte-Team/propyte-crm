// Probador del bot EN SECO: arma el mismo prompt que usa bot-respond (buildSystemPrompt) con la
// configuración elegida y pide UNA respuesta a Claude. No crea contactos, conversaciones ni
// mensajes y no envía nada por ningún canal (ni siquiera importa el motor bot-respond).
// Limitaciones a propósito: no usa el catálogo del Hub (el bot de prueba no cita precios) y no
// avanza el estado del playbook: pregunta por la primera tarea del guion.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canWriteBrands } from "@/lib/brands/roles";
import { getBotConfig, type BotConfigResolved } from "@/lib/bot/config";
import { askClaude, buildSystemPrompt, ESCALATE_TOKEN, type BotMessage, type DiagnosticoClaude } from "@/lib/bot/claude";
import { applyAgentTone, composeObjective } from "@/lib/bot/agent-profiles";
import { buildObjective, nextTask, type PlaybookTaskLite } from "@/lib/bot/playbook/engine";

const TONOS = ["PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"] as const;

const schema = z.object({
  message: z.string().trim().min(1, "Escribe un mensaje de prueba").max(1000, "El mensaje es muy largo (máximo 1,000 caracteres)"),
  // Turnos anteriores de la prueba (el cliente los lleva en pantalla; el servidor no guarda nada).
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(10)
    .optional(),
  brandId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  // Valores de la pantalla sin guardar, para probar antes de guardar.
  overrides: z
    .object({
      tonePreset: z.enum(TONOS).optional(),
      maxLines: z.number().int().min(1).max(8).optional(),
      openerStyle: z.enum(["WARM_NAME", "DIRECT"]).optional(),
      dataGateStrict: z.boolean().optional(),
      escalationTriggers: z.array(z.string().min(1).max(80)).max(20).optional(),
    })
    .optional(),
});

/** Primera pregunta del guion (sin estado de conversación: nada completado ni contacto lleno). */
async function objetivoDeGuion(playbookId: string | null | undefined): Promise<string | undefined> {
  if (!playbookId) return undefined;
  const pb = await prisma.botPlaybook.findFirst({
    where: { id: playbookId, isActive: true, deletedAt: null },
    include: { tasks: { where: { isActive: true }, orderBy: { order: "asc" } } },
  });
  if (!pb || pb.tasks.length === 0) return undefined;
  const t = nextTask(pb.tasks as unknown as PlaybookTaskLite[], [], {});
  return t ? buildObjective(t) : undefined;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !canWriteBrands(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { message, history = [], brandId, agentId, overrides } = parsed.data;

  const general = await getBotConfig();
  let config: BotConfigResolved = { ...general, ...overrides };

  let marca: { name: string; persona: string | null; knowledge: string | null; slug: string } | null = null;
  let guionId: string | null | undefined;
  let identidad: string | undefined;
  let origen = "Configuración general";

  if (brandId) {
    const b = await prisma.brand.findFirst({ where: { id: brandId, deletedAt: null } });
    if (!b) return NextResponse.json({ error: "La marca ya no existe" }, { status: 404 });
    if (!b.isDefault) {
      marca = { name: b.name, persona: b.persona, knowledge: b.knowledge, slug: b.slug };
      // Igual que bot-respond: con marca manda su estilo y su guion (no hereda el global).
      if (b.tonePreset) config = { ...config, tonePreset: b.tonePreset };
      guionId = b.playbookId;
      origen = `Marca ${b.name}`;
    }
  }
  if (!marca && agentId) {
    const a = await prisma.botAgentProfile.findFirst({ where: { id: agentId, deletedAt: null } });
    if (!a) return NextResponse.json({ error: "El agente ya no existe" }, { status: 404 });
    config = applyAgentTone(config, a);
    guionId = a.playbookId; // un agente sin guion NO usa el general
    identidad = a.identity;
    origen = `Agente ${a.name}`;
  }
  if (!marca && !agentId) guionId = general.activePlaybookId;

  const objetivo = composeObjective(identidad, await objetivoDeGuion(guionId));
  const system = buildSystemPrompt({
    config,
    contact: { firstName: "Ana (prueba)", preferredLanguage: "ES" },
    objective: objetivo,
    ...(marca ? { brand: marca } : {}),
  });

  const messages: BotMessage[] = [...history, { role: "user", content: message }];
  const diag: DiagnosticoClaude = {};
  let texto: string | null = null;
  try {
    texto = await askClaude({ system, messages, model: config.model, maxTokens: 400 }, diag);
  } catch (err) {
    console.error("[bot/probar] Claude falló:", err);
  }
  if (!texto) {
    const sinLlave = diag.sinRespuesta?.motivo === "sin_api_key";
    return NextResponse.json(
      { error: sinLlave ? "Este entorno no tiene la llave de IA configurada, así que no se puede probar." : "El modelo no respondió. Intenta de nuevo." },
      { status: 503 },
    );
  }

  const escalaria = texto.includes(ESCALATE_TOKEN);
  return NextResponse.json({
    respuesta: texto.replaceAll(ESCALATE_TOKEN, "").trim(),
    escalaria,
    origen,
    tono: config.tonePreset,
    usaGuion: !!objetivo,
  });
}
