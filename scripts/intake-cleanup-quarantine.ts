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
