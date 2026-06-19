// src/lib/mcp/respond.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
export function fail(error: string, status = 400, details?: unknown) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

/** Registra una mutación MCP en audit_logs. No lanza. */
export async function writeAudit(
  userId: string,
  action: "CREATE" | "UPDATE",
  entity: string,
  entityId: string,
  changes: Record<string, unknown>
) {
  await prisma.auditLog
    .create({ data: { userId, action, entity, entityId, changes: { source: "mcp", ...changes } } })
    .catch(() => null);
}
