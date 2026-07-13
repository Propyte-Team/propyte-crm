// Backfill one-shot: contactos IG/Messenger que quedaron "(por identificar)" antes del
// fetch de perfil → consulta Graph con el token del conector de su conversación y repara
// nombre + custom.avatarUrl. Idempotente (los reparados dejan de matchear el filtro).
// Ejecutar: npx tsx scripts/backfill-social-profiles.ts
import prisma from "@/lib/db";
import { fetchProfileForMessage } from "@/lib/messaging/profile";
import { withChangeSource } from "@/lib/audit/change-context";

const PLACEHOLDER = "(por identificar)";

async function main() {
  const contacts = await prisma.contact.findMany({
    where: {
      lastName: PLACEHOLDER,
      deletedAt: null,
      mergedIntoId: null,
      OR: [{ messengerPsid: { not: null } }, { instagramId: { not: null } }],
    },
    select: {
      id: true, firstName: true, messengerPsid: true, instagramId: true, custom: true,
      conversations: {
        where: { channel: { in: ["MESSENGER", "INSTAGRAM"] }, connectorId: { not: null } },
        select: { channel: true, connectorId: true },
        take: 1,
      },
    },
  });
  console.log(`Contactos "(por identificar)" con id social: ${contacts.length}`);

  let ok = 0, sinConector = 0, sinPerfil = 0, fallidos = 0;
  for (const c of contacts) {
    const conv = c.conversations[0];
    if (!conv?.connectorId) {
      sinConector++;
      console.warn(`- ${c.id} (${c.firstName}): sin conversación con conector, skip`);
      continue;
    }
    const channel = conv.channel as "MESSENGER" | "INSTAGRAM";
    const senderId = channel === "MESSENGER" ? c.messengerPsid : c.instagramId;
    if (!senderId) { sinConector++; continue; }

    const profile = await fetchProfileForMessage({ channel, senderId, connectorId: conv.connectorId });
    if (!profile) {
      sinPerfil++;
      console.warn(`- ${c.id} (${c.firstName}): Graph no devolvió perfil (permiso/expirado), skip`);
      continue;
    }
    try {
      const baseCustom =
        typeof c.custom === "object" && c.custom !== null && !Array.isArray(c.custom)
          ? (c.custom as Record<string, unknown>)
          : {};
      await withChangeSource({ source: "social_profile" }, (tx) =>
        tx.contact.update({
          where: { id: c.id },
          data: {
            firstName: profile.firstName,
            lastName: profile.lastName ?? PLACEHOLDER,
            ...(profile.avatarUrl ? { custom: { ...baseCustom, avatarUrl: profile.avatarUrl } } : {}),
          },
        })
      );
      ok++;
      console.log(`✓ ${c.id}: ${profile.firstName} ${profile.lastName ?? ""}`.trim());
    } catch (err) {
      fallidos++;
      console.error(`✗ ${c.id}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\nReparados: ${ok} · Sin conector: ${sinConector} · Sin perfil: ${sinPerfil} · Fallidos: ${fallidos}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
