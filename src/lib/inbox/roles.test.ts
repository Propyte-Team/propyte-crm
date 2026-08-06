// src/lib/inbox/roles.test.ts
import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import { INBOX_FULL_VIEW, INBOX_MANAGERS, isInboxManager, hasInboxFullView } from "./roles";

describe("roles del inbox", () => {
  it("toda constante es subconjunto del enum UserRole (anti-typo)", () => {
    const valid = new Set(Object.values(UserRole));
    for (const r of [...INBOX_FULL_VIEW, ...INBOX_MANAGERS]) {
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
});
