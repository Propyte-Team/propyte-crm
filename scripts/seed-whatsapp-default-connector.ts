// Crea el LeadConnector "default" de WhatsApp desde los env vars actuales y backfillea
// los hilos WhatsApp existentes a ese connector. Idempotente.
import prisma from "@/lib/db";
import { writeCredentials } from "@/lib/intake/connectors";

async function main() {
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.META_WA_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) throw new Error("Faltan META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN");

  const existing = await prisma.leadConnector.findFirst({
    where: { provider: "WHATSAPP", config: { path: ["phoneNumberId"], equals: phoneNumberId } },
  });
  const connector = existing ?? await prisma.leadConnector.create({
    data: {
      name: "WhatsApp Propyte (default)",
      provider: "WHATSAPP",
      direction: "BOTH",
      status: "ACTIVE",
      config: { phoneNumberId, brand: "Propyte" },
      credentials: writeCredentials({
        accessToken,
        verifyToken: process.env.META_WA_VERIFY_TOKEN?.trim() ?? "",
        appSecret: process.env.META_WA_APP_SECRET?.trim() ?? "",
      }),
    },
  });

  const backfilled = await prisma.conversation.updateMany({
    where: { channel: "WHATSAPP", connectorId: null },
    data: { connectorId: connector.id },
  });
  console.log(`Connector default ${connector.id}; hilos backfilleados: ${backfilled.count}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
