// src/lib/inbox/roles.test.ts
import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import {
  INBOX_FULL_VIEW,
  INBOX_MANAGERS,
  INBOX_CLAIMERS,
  isInboxManager,
  hasInboxFullView,
  canOwnInboxContact,
} from "./roles";

describe("roles del inbox", () => {
  it("toda constante es subconjunto del enum UserRole (anti-typo)", () => {
    const valid = new Set(Object.values(UserRole));
    for (const r of [...INBOX_FULL_VIEW, ...INBOX_MANAGERS, ...INBOX_CLAIMERS]) {
      expect(valid.has(r as UserRole), `rol desconocido: ${r}`).toBe(true);
    }
  });

  it("TEAM_LEADER es mando (reparte la cola) pero NO tiene vista completa", () => {
    expect(INBOX_MANAGERS).toContain("TEAM_LEADER");
    expect(INBOX_FULL_VIEW).not.toContain("TEAM_LEADER");
  });

  it("los tres roles de dirección están en ambos sets", () => {
    for (const r of ["ADMIN", "DIRECTOR", "GERENTE"]) {
      expect(INBOX_FULL_VIEW).toContain(r);
      expect(INBOX_MANAGERS).toContain(r);
    }
  });

  it("helpers", () => {
    expect(isInboxManager("TEAM_LEADER")).toBe(true);
    expect(isInboxManager("ASESOR_SR")).toBe(false);
    expect(hasInboxFullView("GERENTE")).toBe(true);
    expect(hasInboxFullView("TEAM_LEADER")).toBe(false);
  });

  it("canOwnInboxContact: mando + asesores pueden ser dueños; el resto no", () => {
    for (const r of [...INBOX_MANAGERS, ...INBOX_CLAIMERS]) {
      expect(canOwnInboxContact(r), `${r} debería poder ser dueño`).toBe(true);
    }
    for (const r of ["HOSTESS", "MARKETING", "DEVELOPER_EXT", "BROKER", "MANTENIMIENTO"]) {
      expect(canOwnInboxContact(r), `${r} NO debería poder ser dueño`).toBe(false);
    }
  });
});
