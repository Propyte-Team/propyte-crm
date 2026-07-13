import { describe, it, expect } from "vitest";
import { $Enums } from "@prisma/client";
import {
  CONTACT_STATUS_LABELS,
  CONTACT_STATUS_COLORS,
  CONTACT_STATUS_ORDER,
} from "@/lib/constants";

// Sincronía enum Prisma ↔ constants (labels/colores/orden) ↔ zod.
// El zod de contactStatus en route.ts (createContactSchema) usa z.enum(CONTACT_STATUS_ORDER)
// como ÚNICA fuente — por diseño no hay una lista separada que pueda desincronizarse
// (lección del repo, feedback_db_enum_vs_zod_enum: un valor válido en BD pero ausente en
// zod = update rechazado en silencio). Este test cubre el lado "constants".
const NEW_STATUSES = ["PERDIDO", "CONTACTADO_PERDIDO", "REUNION", "PROSPECTO"] as const;

describe("ContactStatus: sincronía enum Prisma ↔ constants (labels/colores/orden/zod)", () => {
  it("el enum Prisma ContactStatus incluye los 4 estados nuevos", () => {
    const values: string[] = Object.values($Enums.ContactStatus);
    for (const s of NEW_STATUSES) {
      expect(values).toContain(s);
    }
  });

  it("CONTACT_STATUS_LABELS cubre TODOS los valores del enum Prisma", () => {
    for (const value of Object.values($Enums.ContactStatus)) {
      expect(CONTACT_STATUS_LABELS[value]).toBeTruthy();
    }
  });

  it("CONTACT_STATUS_COLORS cubre TODOS los valores del enum Prisma", () => {
    for (const value of Object.values($Enums.ContactStatus)) {
      expect(CONTACT_STATUS_COLORS[value]).toBeTruthy();
    }
  });

  it("CONTACT_STATUS_ORDER (fuente del z.enum en /api/contacts) cubre TODOS los valores del enum Prisma, sin duplicados", () => {
    expect(new Set(CONTACT_STATUS_ORDER).size).toBe(CONTACT_STATUS_ORDER.length);
    for (const value of Object.values($Enums.ContactStatus)) {
      expect(CONTACT_STATUS_ORDER as readonly string[]).toContain(value);
    }
  });
});
