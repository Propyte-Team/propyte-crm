import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
config();
const NEW_URL = `postgresql://postgres.oaijxdpevakashxshhvm:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: NEW_URL } } });
  try {
    // Revisar permisos granulares del authenticator
    console.log("=== Permisos del authenticator ===\n");
    const perms = await db.$queryRawUnsafe(`
      SELECT 'schema' as tipo, nspname as obj, has_schema_privilege('authenticator', nspname, 'USAGE') as can
      FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'
      ORDER BY nspname
    `) as any[];
    for (const p of perms) console.log(`  ${p.tipo} ${p.obj}: USAGE=${p.can}`);

    // Verificar que authenticator puede SET ROLE
    console.log("\n=== Rol authenticator info ===\n");
    const rol = await db.$queryRawUnsafe(`
      SELECT rolname, rolsuper, rolinherit, rolcanlogin, rolconfig
      FROM pg_roles WHERE rolname IN ('authenticator','anon','authenticated','service_role')
      ORDER BY rolname
    `) as any[];
    for (const r of rol) console.log(`  ${r.rolname}: super=${r.rolsuper} inherit=${r.rolinherit} login=${r.rolcanlogin} config=${r.rolconfig}`);

    // Verificar memberships
    console.log("\n=== Memberships ===\n");
    const mem = await db.$queryRawUnsafe(`
      SELECT r.rolname as role, m.rolname as member_of
      FROM pg_auth_members am
      JOIN pg_roles r ON r.oid = am.member
      JOIN pg_roles m ON m.oid = am.roleid
      WHERE r.rolname = 'authenticator'
    `) as any[];
    for (const m of mem) console.log(`  ${m.role} is member of ${m.member_of}`);
  } finally { await db.$disconnect(); }
}
main();
