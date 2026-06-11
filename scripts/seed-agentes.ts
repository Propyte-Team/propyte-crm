// Seeds de agentes pre-construidos (speckit #4 §2.2) — idempotente. CORRER tras
// aplicar la migración C123: npx tsx scripts/seed-agentes.ts
//
// Crea un User de sistema "Agentes Propyte" (rol ASESOR, sin login: password aleatorio,
// isActive=true para RBAC) + 2 agentes L2 INACTIVOS (activar desde /api/admin/agents).
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

const AGENTS = [
  {
    name: "SDR Speed-to-lead",
    goal:
      "Eres el primer contacto de Propyte con un lead nuevo (objetivo: <5 minutos). Saluda por WhatsApp " +
      "en su idioma, agradece su interés, haz UNA pregunta de calificación (presupuesto aproximado o zona " +
      "de interés), y registra lo que aprendas con update_investment_profile. Si pide hablar con alguien, " +
      "quiere visitar o detectas intención fuerte: escalate_to_human y crea una tarea para el asesor. " +
      "Nunca cites precios sin match_units.",
    allowedTools: ["get_contact", "update_investment_profile", "match_units", "send_whatsapp", "create_task", "escalate_to_human"],
    autonomyLevel: "L2" as const,
    trigger: { eventType: "lead.assigned", note: "Disparable desde WF1 o manual" },
    limits: { maxSteps: 8 },
  },
  {
    name: "Calificador",
    goal:
      "Conduce un discovery conversacional por WhatsApp: completa presupuesto (min/max), zona, horizonte " +
      "de compra y tipo de propiedad del contacto usando update_investment_profile. Cuando el perfil esté " +
      "completo, usa match_units y comparte máximo 2 opciones del catálogo (SOLO datos del Hub). Después " +
      "crea una tarea para que el asesor agende visita y escala con resumen.",
    allowedTools: ["get_contact", "update_investment_profile", "match_units", "send_whatsapp", "create_task", "escalate_to_human"],
    autonomyLevel: "L2" as const,
    trigger: { eventType: "whatsapp.replied", note: "Para hilos en discovery" },
    limits: { maxSteps: 10 },
  },
];

async function main() {
  // Identidad de sistema para los agentes (PA1: agente = User con RBAC)
  const email = "agentes@propyte.local";
  let systemUser = await prisma.user.findUnique({ where: { email } });
  if (!systemUser) {
    systemUser = await prisma.user.create({
      data: {
        email,
        name: "Agentes Propyte (IA)",
        role: "ASESOR",
        careerLevel: "JR",
        plaza: "TULUM",
        isActive: true,
        passwordHash: await hash(randomBytes(32).toString("hex"), 12), // sin login práctico
      },
    });
    console.log("User de sistema creado:", systemUser.email);
  } else {
    console.log("User de sistema existente:", systemUser.email);
  }

  for (const a of AGENTS) {
    await prisma.agentDef.upsert({
      where: { name: a.name },
      update: { goal: a.goal, allowedTools: a.allowedTools, trigger: a.trigger, limits: a.limits },
      create: { ...a, systemUserId: systemUser.id, isActive: false },
    });
    console.log("Agente:", a.name, "(INACTIVO — activar cuando ANTHROPIC_API_KEY esté en el server)");
  }

  console.log("\nSeeds de agentes completos.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
