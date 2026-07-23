import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import { navGroups, visibleNavItems } from "./nav-config";

// AUD-20260710-05 (y BUG TEAM_LEADER jun-2026): roles del enum sin ningún item de nav
// → sidebar vacío, el usuario entra pero no puede navegar. Este test fija la clase entera:
// TODO rol del enum UserRole debe ver al menos un item.
describe("nav-config — cobertura de roles del sidebar", () => {
  it("todo rol del enum UserRole ve al menos 1 item de navegación", () => {
    for (const role of Object.values(UserRole)) {
      const items = visibleNavItems(role);
      expect(items.length, `rol sin sidebar: ${role}`).toBeGreaterThan(0);
    }
  });

  it("los roles referenciados en navGroups existen en el enum (sin typos)", () => {
    const valid = new Set(Object.values(UserRole) as string[]);
    for (const group of navGroups) {
      for (const item of group.items) {
        for (const role of item.roles) {
          expect(valid.has(role), `rol inexistente "${role}" en item ${item.href}`).toBe(true);
        }
      }
    }
  });

  it("MANTENIMIENTO no ve páginas que lo redirigen (conexiones/configuracion)", () => {
    const hrefs = visibleNavItems("MANTENIMIENTO").map((i) => i.href);
    expect(hrefs).not.toContain("/conexiones");
    expect(hrefs).not.toContain("/configuracion");
  });
});
