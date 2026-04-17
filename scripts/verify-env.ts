/**
 * Verifica que todas las variables de entorno criticas esten configuradas
 * y que las conexiones a Neon (Prisma) y Supabase funcionen.
 *
 * Uso: npx tsx scripts/verify-env.ts
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

config();

type Result = { label: string; ok: boolean; detail: string };
const results: Result[] = [];

function check(label: string, ok: boolean, detail: string) {
  results.push({ label, ok, detail });
}

function maskValue(val: string | undefined): string {
  if (!val) return "(vacio)";
  if (val.length < 20) return "(muy corto — ¿valido?)";
  return `${val.slice(0, 12)}...${val.slice(-4)} (len=${val.length})`;
}

function parseJwtProjectRef(jwt: string | undefined): string | null {
  if (!jwt) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64").toString()
    );
    return payload.ref ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n=== VERIFICACION DE .env — Propyte CRM ===\n");

  // --- 1. Presencia de variables ---
  const DATABASE_URL = process.env.DATABASE_URL;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
  const NEXTAUTH_URL = process.env.NEXTAUTH_URL;

  check("DATABASE_URL presente", !!DATABASE_URL, maskValue(DATABASE_URL));
  check("SUPABASE_URL presente", !!SUPABASE_URL, SUPABASE_URL ?? "(vacio)");
  check(
    "NEXT_PUBLIC_SUPABASE_URL presente",
    !!NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL ?? "(vacio)"
  );
  check("SUPABASE_ANON_KEY presente", !!SUPABASE_ANON_KEY, maskValue(SUPABASE_ANON_KEY));
  check(
    "SUPABASE_SERVICE_ROLE_KEY presente",
    !!SUPABASE_SERVICE_ROLE_KEY,
    maskValue(SUPABASE_SERVICE_ROLE_KEY)
  );
  check("NEXTAUTH_SECRET presente", !!NEXTAUTH_SECRET, maskValue(NEXTAUTH_SECRET));
  check("NEXTAUTH_URL presente", !!NEXTAUTH_URL, NEXTAUTH_URL ?? "(vacio)");

  // --- 2. Coherencia de URLs y keys de Supabase ---
  const EXPECTED_REF = "oaijxdpevakashxshhvm";

  if (SUPABASE_URL) {
    check(
      "SUPABASE_URL apunta a nueva DB",
      SUPABASE_URL.includes(EXPECTED_REF),
      SUPABASE_URL.includes(EXPECTED_REF)
        ? `OK — contiene ${EXPECTED_REF}`
        : `ADVERTENCIA — no contiene ${EXPECTED_REF}`
    );
  }

  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_URL) {
    check(
      "SUPABASE_URL === NEXT_PUBLIC_SUPABASE_URL",
      SUPABASE_URL === NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_URL === NEXT_PUBLIC_SUPABASE_URL
        ? "OK — coinciden"
        : "NO coinciden (deben ser iguales)"
    );
  }

  const anonRef = parseJwtProjectRef(SUPABASE_ANON_KEY);
  if (anonRef) {
    check(
      "SUPABASE_ANON_KEY apunta a nueva DB",
      anonRef === EXPECTED_REF,
      anonRef === EXPECTED_REF
        ? `OK — ref=${anonRef}`
        : `ref=${anonRef} (esperado ${EXPECTED_REF})`
    );
  }

  const serviceRef = parseJwtProjectRef(SUPABASE_SERVICE_ROLE_KEY);
  if (serviceRef) {
    check(
      "SUPABASE_SERVICE_ROLE_KEY apunta a nueva DB",
      serviceRef === EXPECTED_REF,
      serviceRef === EXPECTED_REF
        ? `OK — ref=${serviceRef}`
        : `ref=${serviceRef} (esperado ${EXPECTED_REF})`
    );
  }

  // --- 3. Conexion a Neon (Prisma) ---
  if (DATABASE_URL) {
    const isNeon = DATABASE_URL.includes("neon.tech");
    const isSupabase = DATABASE_URL.includes("supabase.com");
    check(
      "DATABASE_URL tipo",
      isNeon || isSupabase,
      isNeon ? "Neon (correcto para CRM actual)" : isSupabase ? "Supabase (¿ya migraste Prisma?)" : "Desconocido"
    );

    try {
      const prisma = new PrismaClient();
      const r = (await prisma.$queryRawUnsafe("SELECT 1 as ok")) as Array<{ ok: number }>;
      check("Conexion DATABASE_URL (Prisma)", r[0]?.ok === 1, "Query SELECT 1 OK");
      await prisma.$disconnect();
    } catch (e: any) {
      check("Conexion DATABASE_URL (Prisma)", false, `ERROR: ${e.message}`);
    }
  }

  // --- 4. Conexion a Supabase con anon key ---
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { error } = await sb.auth.getSession();
      check(
        "Conexion Supabase (anon key)",
        !error,
        error ? `ERROR: ${error.message}` : "Cliente anon inicializado OK"
      );
    } catch (e: any) {
      check("Conexion Supabase (anon key)", false, `ERROR: ${e.message}`);
    }
  }

  // --- 5. Conexion a Supabase con service role ---
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });
      // Intenta listar schemas via rpc o query simple
      const { error } = await sb.from("_dummy_table_that_does_not_exist").select("*").limit(1);
      // Si la conexion funciona, error sera "table not found" (42P01 o similar)
      // Si la key es invalida, sera otro error
      const authOk =
        !error || (error && !error.message.toLowerCase().includes("invalid"));
      check(
        "Conexion Supabase (service role)",
        authOk,
        error ? `Respuesta: ${error.message} (esperado si tabla no existe)` : "OK"
      );
    } catch (e: any) {
      check("Conexion Supabase (service role)", false, `ERROR: ${e.message}`);
    }
  }

  // --- Reporte ---
  console.log("Resultados:\n");
  for (const r of results) {
    const icon = r.ok ? "[OK]" : "[FAIL]";
    console.log(`${icon} ${r.label}`);
    console.log(`      ${r.detail}\n`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${results.length - failed}/${results.length} checks pasaron ===\n`);
  if (failed > 0) {
    console.log("Revisa los FAIL arriba y corrige el .env\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
