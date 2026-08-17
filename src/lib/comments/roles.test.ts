import { describe, it, expect } from "vitest";
import { COMMENT_RULES_ROLES, canManageCommentRules } from "./roles";

describe("canManageCommentRules", () => {
  it("deja pasar al mando y a MARKETING", () => {
    for (const role of ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]) {
      expect(canManageCommentRules(role), `${role} debería poder gestionar`).toBe(true);
    }
  });

  it("MARKETING entra: es el acceso de la diseñadora, sin hacerla ADMIN", () => {
    expect(canManageCommentRules("MARKETING")).toBe(true);
  });

  it("los roles de venta y operación quedan fuera", () => {
    for (const role of [
      "TEAM_LEADER",
      "ASESOR",
      "ASESOR_SR",
      "ASESOR_JR",
      "HOSTESS",
      "BROKER",
      "MANTENIMIENTO",
      "DEVELOPER_EXT",
    ]) {
      expect(canManageCommentRules(role), `${role} NO debería poder gestionar`).toBe(false);
    }
  });

  it("un rol ausente o desconocido no cae a un default permisivo", () => {
    expect(canManageCommentRules(undefined)).toBe(false);
    expect(canManageCommentRules(null)).toBe(false);
    expect(canManageCommentRules("")).toBe(false);
    expect(canManageCommentRules("SUPERUSUARIO")).toBe(false);
  });

  it("la lista es la única fuente: el helper no conoce roles fuera de ella", () => {
    for (const role of COMMENT_RULES_ROLES) {
      expect(canManageCommentRules(role)).toBe(true);
    }
    expect(COMMENT_RULES_ROLES).toHaveLength(4);
  });
});
