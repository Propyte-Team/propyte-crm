import { describe, it, expect, vi } from "vitest";

// #890: el Dashboard se retiró y «Hoy» es la página de inicio.

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
let sesion: { user: { id: string } } | null = null;
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

import DashboardRetirado from "./page";
import Home from "../../page";

describe("inicio = Hoy (#890)", () => {
  it("/dashboard (marcadores viejos) lleva a /hoy", () => {
    expect(() => DashboardRetirado()).toThrow("REDIRECT /hoy");
  });
  it("la raíz con sesión lleva a /hoy", async () => {
    sesion = { user: { id: "u1" } };
    await expect(Home()).rejects.toThrow("REDIRECT /hoy");
  });
  it("la raíz sin sesión lleva a /login", async () => {
    sesion = null;
    await expect(Home()).rejects.toThrow("REDIRECT /login");
  });
});
