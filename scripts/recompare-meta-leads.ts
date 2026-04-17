// Re-comparar todos los meta_leads contra Propyte_zoho_leads actualizado
// npx tsx scripts/recompare-meta-leads.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.replace(/[\s\-\(\)\+]/g, "").slice(-10);
}

function normalizeEmail(email: string | null): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

async function main() {
  console.log("=== Re-comparación completa de Meta Leads ===\n");

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  const supabase = createClient(url, key);

  // 1. Reset ALL matched/missing to PENDING
  const resetCount = await prisma.metaLead.updateMany({
    where: { status: { in: ["MATCHED", "MISSING_IN_CRM"] } },
    data: { status: "PENDING", matchedContactId: null, matchedAt: null, matchMethod: null },
  });
  console.log("Reset a PENDING:", resetCount.count, "leads");

  // 2. Load all Zoho leads emails/phones
  const zohoEmailSet = new Set<string>();
  const zohoPhoneSet = new Set<string>();
  const zohoEmailToId = new Map<string, string>();
  const zohoPhoneToId = new Map<string, string>();

  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page } = await supabase
      .schema("real_estate_hub")
      .from("Propyte_zoho_leads")
      .select("zoho_record_id, email, phone, mobile")
      .range(from, from + pageSize - 1);

    if (!page || page.length === 0) break;

    for (const zl of page) {
      if (zl.email) {
        const norm = zl.email.toLowerCase().trim();
        zohoEmailSet.add(norm);
        zohoEmailToId.set(norm, zl.zoho_record_id);
      }
      if (zl.phone) {
        const norm = zl.phone.replace(/[\s\-\(\)\+]/g, "").slice(-10);
        if (norm.length >= 7) { zohoPhoneSet.add(norm); zohoPhoneToId.set(norm, zl.zoho_record_id); }
      }
      if (zl.mobile) {
        const norm = zl.mobile.replace(/[\s\-\(\)\+]/g, "").slice(-10);
        if (norm.length >= 7) { zohoPhoneSet.add(norm); zohoPhoneToId.set(norm, zl.zoho_record_id); }
      }
    }
    if (page.length < pageSize) break;
    from += pageSize;
  }
  console.log("Zoho emails cargados:", zohoEmailSet.size);
  console.log("Zoho phones cargados:", zohoPhoneSet.size);

  // 3. Get all PENDING leads and compare
  const pendingLeads = await prisma.metaLead.findMany({
    where: { status: "PENDING" },
    select: { id: true, email: true, phone: true },
  });
  console.log("Leads a comparar:", pendingLeads.length);

  let matched = 0;
  let missing = 0;
  const matchData: { id: string; contactId: string; method: string }[] = [];
  const missingIds: string[] = [];

  for (const lead of pendingLeads) {
    const normEmail = normalizeEmail(lead.email);
    const normPhone = normalizePhone(lead.phone);

    let matchedId: string | null = null;
    let matchMethod = "";

    if (normEmail && zohoEmailSet.has(normEmail)) {
      matchedId = zohoEmailToId.get(normEmail) || null;
      matchMethod = "email";
    }
    if (!matchedId && normPhone && normPhone.length >= 7 && zohoPhoneSet.has(normPhone)) {
      matchedId = zohoPhoneToId.get(normPhone) || null;
      matchMethod = "phone";
    }
    if (matchedId && matchMethod === "email" && normPhone && normPhone.length >= 7 && zohoPhoneSet.has(normPhone)) {
      matchMethod = "both";
    }

    if (matchedId) {
      matched++;
      matchData.push({ id: lead.id, contactId: matchedId, method: matchMethod });
    } else {
      missing++;
      missingIds.push(lead.id);
    }
  }

  // 4. Update DB
  if (missingIds.length > 0) {
    await prisma.metaLead.updateMany({
      where: { id: { in: missingIds } },
      data: { status: "MISSING_IN_CRM" },
    });
  }

  const now = new Date();
  for (let i = 0; i < matchData.length; i += 50) {
    const chunk = matchData.slice(i, i + 50);
    await prisma.$transaction(
      chunk.map((m) =>
        prisma.metaLead.update({
          where: { id: m.id },
          data: {
            status: "MATCHED",
            matchedContactId: m.contactId,
            matchedAt: now,
            matchMethod: m.method,
          },
        })
      )
    );
  }

  console.log("\n=== RESULTADO ===");
  console.log("MATCHED:", matched);
  console.log("MISSING_IN_CRM:", missing);

  // 5. Verificar Elizabeth
  const eliz = await prisma.metaLead.findFirst({ where: { lastName: "Resendiz" } });
  console.log("\n=== Elizabeth Resendiz ===");
  console.log("status:", eliz?.status);
  console.log("matchedContactId:", eliz?.matchedContactId);
  console.log("matchMethod:", eliz?.matchMethod);

  // 6. Stats
  const stats = await prisma.metaLead.groupBy({ by: ["status"], _count: true });
  console.log("\n=== STATS FINALES ===");
  for (const s of stats) console.log("  " + s.status + ": " + s._count);

  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", e); process.exit(1); });
