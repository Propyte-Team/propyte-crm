/**
 * Busca cualquier variable de entorno que contenga password de la nueva
 * Supabase DB (oaijxdpevakashxshhvm) e intenta conectar.
 *
 * Uso: npx tsx scripts/find-new-db-password.ts
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";

async function main() {
  console.log("\n=== Buscando connection string para nueva DB ===\n");

  // 1. Buscar variables que mencionen el ref nuevo
  const candidates: Array<{ name: string; value: string }> = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (value.includes(NEW_REF)) {
      candidates.push({ name, value });
    }
  }

  console.log(`Variables que mencionan ${NEW_REF}:`);
  for (const c of candidates) {
    const masked =
      c.value.length > 80
        ? `${c.value.slice(0, 60)}...${c.value.slice(-10)}`
        : c.value;
    console.log(`  - ${c.name}: ${masked}`);
  }
  console.log();

  // 2. Buscar variables que parecen passwords (por nombre conocido)
  const PASSWORD_VAR_NAMES = [
    "SUPABASE_DB_PASSWORD",
    "NEW_SUPABASE_DB_PASSWORD",
    "NEW_DB_PASSWORD",
    "DB_PASSWORD",
    "SUPABASE_PASSWORD",
  ];
  console.log("Buscando variables de password por nombre conocido:");
  let foundPassword: string | null = null;
  let foundPasswordName: string | null = null;
  for (const name of PASSWORD_VAR_NAMES) {
    if (process.env[name]) {
      console.log(`  [OK] ${name} encontrada (len=${process.env[name]!.length})`);
      foundPassword = process.env[name]!;
      foundPasswordName = name;
      break;
    }
  }
  if (!foundPassword) {
    console.log(`  [INFO] Ninguna de: ${PASSWORD_VAR_NAMES.join(", ")}`);
  }
  console.log();

  // 3. Construir candidatos de connection string
  const pgCandidates = candidates.filter(
    (c) =>
      c.value.startsWith("postgresql://") || c.value.startsWith("postgres://")
  );

  // Si encontramos password suelto, construir connection strings con el
  if (foundPassword) {
    const encoded = encodeURIComponent(foundPassword);
    pgCandidates.push({
      name: `${foundPasswordName} (pooler aws-1 puerto 5432)`,
      value: `postgresql://postgres.${NEW_REF}:${encoded}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
    });
    pgCandidates.push({
      name: `${foundPasswordName} (pooler aws-1 puerto 6543)`,
      value: `postgresql://postgres.${NEW_REF}:${encoded}@aws-1-us-east-1.pooler.supabase.com:6543/postgres`,
    });
  }

  if (pgCandidates.length === 0) {
    console.log("[FAIL] NO se encontro ninguna connection string de Postgres apuntando a la nueva DB.");
    console.log("\nLas variables encontradas son solo URLs de Supabase API o JWT keys.");
    console.log("\nNECESITAS agregar al .env del CRM una linea como:");
    console.log("  SUPABASE_DB_PASSWORD=<el password de la nueva DB>");
    console.log("\nO directamente:");
    console.log("  NEW_DATABASE_URL=postgresql://postgres.oaijxdpevakashxshhvm:<PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres");
    process.exit(1);
  }

  // 3. Probar conectar con cada candidata via Prisma
  console.log(`\nProbando conexion con ${pgCandidates.length} candidata(s)...\n`);

  for (const c of pgCandidates) {
    process.stdout.write(`  ${c.name}: `);
    const prisma = new PrismaClient({
      datasources: { db: { url: c.value } },
    });
    try {
      const r = (await prisma.$queryRawUnsafe(
        "SELECT current_database() as db, current_user as usr"
      )) as Array<{ db: string; usr: string }>;
      console.log(`[OK] db=${r[0].db} user=${r[0].usr}`);

      const schemas = (await prisma.$queryRawUnsafe(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name"
      )) as Array<{ schema_name: string }>;
      console.log(`     Schemas existentes: ${schemas.map((s) => s.schema_name).join(", ")}`);

      await prisma.$disconnect();
      console.log(`\n[SUCCESS] Usaremos esta variable: ${c.name}\n`);
      return;
    } catch (e: any) {
      console.log(`[FAIL] ${e.message.split("\n")[0]}`);
      try {
        await prisma.$disconnect();
      } catch {}
    }
  }

  console.log("\n[FAIL] Ninguna connection string conecto correctamente.");
  process.exit(1);
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
