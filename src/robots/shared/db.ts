/**
 * Cliente Prisma singleton apuntando al Supabase NUEVO (oaijxdpevakashxshhvm).
 *
 * Los robots usan $queryRawUnsafe / $executeRawUnsafe con tipos manuales
 * de types.ts (ver decision arquitectonica en project_supabase_new.md).
 *
 * Este cliente NO usa el schema.prisma del CRM — ignora los modelos definidos
 * y solo hace raw queries. Por eso el path de Prisma apunta al mismo schema del
 * CRM pero la DATABASE_URL efectiva se override aqui.
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();

const NEW_REF = "oaijxdpevakashxshhvm";

function buildUrl(): string {
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error(
      "SUPABASE_DB_PASSWORD no esta definido. Revisa .env del CRM o los secrets del workflow."
    );
  }
  return `postgresql://postgres.${NEW_REF}:${encodeURIComponent(
    password
  )}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
}

let instance: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (!instance) {
    instance = new PrismaClient({
      datasources: { db: { url: buildUrl() } },
      log: process.env.ROBOT_DEBUG === "true" ? ["query", "warn", "error"] : ["warn", "error"],
    });
  }
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.$disconnect();
    instance = null;
  }
}
