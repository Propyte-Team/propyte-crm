// Escritura de valores capturados por el bot al Contact + auditoría (Anexo Técnico §B-Task 6).
// Regla de oro: best-effort. Esta función NUNCA debe lanzar — el bot que la invoca
// no debe romperse por un problema de escritura/auditoría. Si algo no se puede
// hacer con seguridad (contacto inexistente, sin actor para auditar), se omite.
import type { Prisma, PrismaClient } from "@prisma/client";
import { isCustomTarget, isNativeTarget } from "./fields";
import { setChangeSource } from "@/lib/audit/change-context";

export interface FieldWrite {
  field: string;
  value: string | number | boolean;
}

export type ResolvedWrite =
  | { kind: "native"; column: string; value: unknown }
  | { kind: "custom"; key: string; value: unknown }
  | { kind: "skip"; field: string };

export function resolveWrite(w: FieldWrite): ResolvedWrite {
  if (isNativeTarget(w.field)) {
    return { kind: "native", column: w.field, value: w.value };
  }
  if (isCustomTarget(w.field)) {
    return { kind: "custom", key: w.field.slice("custom.".length), value: w.value };
  }
  return { kind: "skip", field: w.field };
}

// Prisma expone montos Decimal (budgetMin/budgetMax) como objetos Decimal.
// Para meterlos en un Json de auditoría hay que serializarlos a number/string;
// null/undefined se preservan tal cual.
function serializeForAudit(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "toNumber" in (value as Record<string, unknown>)) {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (value instanceof Date) return value.toISOString();
  return value as Prisma.InputJsonValue;
}

export async function applyCapture(
  db: PrismaClient,
  contactId: string,
  writes: FieldWrite[],
  meta: { taskKey: string; conversationId: string },
): Promise<void> {
  try {
    const contact = await db.contact.findUnique({ where: { id: contactId } });
    if (!contact) return;

    const resolved = writes.map(resolveWrite);
    const nativeWrites = resolved.filter(
      (r): r is Extract<ResolvedWrite, { kind: "native" }> => r.kind === "native",
    );
    const customWrites = resolved.filter(
      (r): r is Extract<ResolvedWrite, { kind: "custom" }> => r.kind === "custom",
    );

    if (nativeWrites.length === 0 && customWrites.length === 0) return;

    const actorId =
      contact.assignedToId ??
      (
        await db.user.findFirst({
          where: { role: "ADMIN", isActive: true },
          select: { id: true },
        })
      )?.id;
    if (!actorId) return;

    const contactRecord = contact as unknown as Record<string, unknown>;
    const data: Prisma.ContactUpdateInput = {};
    const auditEntries: { field: string; from: Prisma.InputJsonValue | null; to: unknown }[] = [];

    for (const w of nativeWrites) {
      (data as Record<string, unknown>)[w.column] = w.value;
      auditEntries.push({
        field: w.column,
        from: serializeForAudit(contactRecord[w.column]),
        to: w.value,
      });
    }

    if (customWrites.length > 0) {
      const prevCustom = (contact.custom as Record<string, unknown> | null) ?? {};
      const nextCustom = { ...prevCustom };
      for (const w of customWrites) {
        auditEntries.push({
          field: `custom.${w.key}`,
          from: serializeForAudit(prevCustom[w.key]),
          to: w.value,
        });
        nextCustom[w.key] = w.value;
      }
      data.custom = nextCustom as Prisma.InputJsonValue;
    }

    // Forma interactiva (en vez de array-batch): permite fijar crm.source/crm.actor_id
    // ANTES del UPDATE, en la misma transacción, para que el trigger de cronología los vea.
    await db.$transaction(async (tx) => {
      await setChangeSource(tx, { source: "bot_playbook", actorId });
      await tx.contact.update({ where: { id: contactId }, data });
      for (const entry of auditEntries) {
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: "UPDATE",
            entity: "Contact",
            entityId: contactId,
            changes: {
              field: entry.field,
              from: entry.from,
              to: entry.to as Prisma.InputJsonValue,
              source: "bot_playbook",
              taskKey: meta.taskKey,
              conversationId: meta.conversationId,
            },
          },
        });
      }
    });
  } catch {
    // Best-effort: nunca romper el flujo del bot por un fallo de escritura/auditoría.
    return;
  }
}
