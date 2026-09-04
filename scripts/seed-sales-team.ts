// ============================================================
// Alta del equipo de ventas real en el CRM (tabla users)
//
// Contexto: hasta ahora las únicas cuentas con rol de asesor eran de prueba
// (@propyte.local) y el ruteo las rechaza, así que ningún lead se asignaba.
// Este script da de alta a los asesores reales del roster autoritativo
// (pantalla "Asesores") para que el round-robin tenga a quién asignarle.
//
// Uso:
//   npx tsx scripts/seed-sales-team.ts              → DRY-RUN: imprime qué haría, no escribe
//   APPLY=1 npx tsx scripts/seed-sales-team.ts      → aplica los cambios en la base
//   APPLY=1 CONFIRM_DOWNGRADE_ADMINS=1 npx tsx scripts/seed-sales-team.ts
//                                                    → además baja a Conrad y Felipe de ADMIN a GERENTE
//
// Notas:
// - Idempotente: si el correo ya existe, actualiza rol/plaza/nivel; no duplica.
// - No imprime contraseñas: cada alta nace con una contraseña temporal aleatoria
//   y el asesor entra con "Acceder con código por correo" (requiere SMTP en prod).
// - NO toca las cuentas de prueba (.local) ni reasigna contactos: eso es un paso aparte.
// - Plaza: el enum del CRM es PDC | TULUM | MERIDA. TLM→TULUM; CORPO se mapea por ciudad.
// ============================================================
import { PrismaClient, type UserRole, type Plaza, type CareerLevel } from "@prisma/client";
import { hash } from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";
const DOWNGRADE_ADMINS = process.env.CONFIRM_DOWNGRADE_ADMINS === "1";

type Seed = {
  email: string;
  name: string;
  role: UserRole;
  plaza: Plaza;
  careerLevel: CareerLevel;
  nota?: string;
};

// Roster autoritativo (pantalla "Asesores"). Gerentes de ventas + asesores.
// Victor Sanfilippo entra como GERENTE (mando, no recibe round-robin).
// Los 6 asesores (2 Sr + 4 Jr) son los que alimentan el ruteo.
const salesTeam: Seed[] = [
  { email: "victor@propyte.com",       name: "Victor Sanfilippo", role: "GERENTE",    plaza: "PDC",   careerLevel: "GERENTE" },
  { email: "sonia@nativatulum.mx",     name: "Sonia Cervantes",   role: "ASESOR_SR",  plaza: "TULUM", careerLevel: "SR" },
  { email: "zyanya@propyte.com",       name: "Zyanya Martineau",  role: "ASESOR_SR",  plaza: "TULUM", careerLevel: "SR" },
  { email: "elvira@propyte.com",       name: "Elvira Chavez",     role: "ASESOR_JR",  plaza: "PDC",   careerLevel: "JR" },
  { email: "ignacio@propyte.com",      name: "Ignacio Lencinas",  role: "ASESOR_JR",  plaza: "PDC",   careerLevel: "JR" },
  { email: "oscar@propyte.com",        name: "Oscar Gonzalez",    role: "ASESOR_JR",  plaza: "PDC",   careerLevel: "JR" },
  { email: "arroyo@propyte.com",       name: "Victor Arroyo",     role: "ASESOR_JR",  plaza: "PDC",   careerLevel: "JR" },
];

// Cambios de rol sobre cuentas que HOY son ADMIN. Sensible: se aplican solo con
// CONFIRM_DOWNGRADE_ADMINS=1. Conrad y Felipe son mando de ventas, no admins de sistema.
const adminRoleChanges: Seed[] = [
  { email: "conrad@propyte.com", name: "Conrad Alvarado", role: "GERENTE", plaza: "PDC", careerLevel: "GERENTE", nota: "hoy ADMIN" },
  { email: "fluksic@propyte.com", name: "Felipe Luksic",  role: "GERENTE", plaza: "PDC", careerLevel: "GERENTE", nota: "hoy ADMIN" },
];

async function upsertOne(s: Seed, opts: { allowAdminChange?: boolean } = {}) {
  const email = s.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role === "ADMIN" && !opts.allowAdminChange) {
      console.log(`  SALTAR  ${email} — ya es ADMIN; no se toca sin CONFIRM_DOWNGRADE_ADMINS=1`);
      return;
    }
    const cambia = existing.role !== s.role || existing.careerLevel !== s.careerLevel;
    if (!cambia && existing.isActive && existing.deletedAt === null) {
      console.log(`  OK      ${email} — ya existe con rol ${existing.role}, sin cambios`);
      return;
    }
    console.log(`  UPDATE  ${email} — ${existing.role} → ${s.role} (${s.careerLevel}), activo`);
    if (APPLY) {
      await prisma.user.update({
        where: { email },
        data: { role: s.role, careerLevel: s.careerLevel, isActive: true, deletedAt: null, name: s.name },
      });
    }
    return;
  }

  console.log(`  CREATE  ${email} — ${s.role} (${s.careerLevel}) · plaza ${s.plaza}`);
  if (APPLY) {
    const tempPassword = crypto.randomBytes(32).toString("hex");
    const passwordHash = await hash(tempPassword, 12);
    await prisma.user.create({
      data: {
        email,
        name: s.name,
        role: s.role,
        careerLevel: s.careerLevel,
        plaza: s.plaza,
        isActive: true,
        passwordHash,
      },
    });
  }
}

async function main() {
  console.log(APPLY ? "== APLICANDO cambios ==" : "== DRY-RUN (no escribe; usa APPLY=1 para aplicar) ==");

  // Luis = ADMIN propietario. Solo se asegura que siga ADMIN y activo.
  const luis = await prisma.user.findUnique({ where: { email: "marketing@nativatulum.mx" } });
  if (luis) {
    console.log(`  OK      marketing@nativatulum.mx — ADMIN propietario (Luis), rol actual ${luis.role}`);
    if (APPLY && (luis.role !== "ADMIN" || !luis.isActive)) {
      await prisma.user.update({ where: { email: "marketing@nativatulum.mx" }, data: { role: "ADMIN", isActive: true } });
    }
  } else {
    console.log("  AVISO   marketing@nativatulum.mx NO existe — Luis debería estar dado de alta como ADMIN.");
  }

  console.log("\n-- Equipo de ventas (crea/actualiza) --");
  for (const s of salesTeam) await upsertOne(s);

  console.log("\n-- Cambios sobre cuentas ADMIN (Conrad, Felipe) --");
  if (!DOWNGRADE_ADMINS) {
    console.log("  (omitido: pasa CONFIRM_DOWNGRADE_ADMINS=1 para bajarlos ADMIN → GERENTE)");
  } else {
    for (const s of adminRoleChanges) await upsertOne(s, { allowAdminChange: true });
  }

  console.log("\nListo." + (APPLY ? "" : " (fue DRY-RUN — nada se escribió)"));
  console.log("Los asesores nuevos entran con «Acceder con código por correo» en el login.");
}

main()
  .catch((e) => {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
