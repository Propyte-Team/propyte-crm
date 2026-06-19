// src/lib/mcp/handlers/introspection.ts
import prisma from "@/lib/db";
import { describeSchema } from "../schema-introspection";

export async function health() {
  const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  return { ok: dbOk, env: process.env.NODE_ENV ?? "unknown", service: "propyte-crm-mcp" };
}
export async function schema() {
  return describeSchema();
}
export async function listUsers() {
  return prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}
export async function listTeams() {
  return prisma.team.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, plaza: true, leaderId: true },
    orderBy: { name: "asc" },
  });
}
