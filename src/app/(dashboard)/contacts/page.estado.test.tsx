import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";

(globalThis as unknown as { React: typeof React }).React = React;

const getContacts = vi.fn();
vi.mock("@/server/contacts", () => ({ getContacts: (...a: unknown[]) => getContacts(...a) }));
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => ({ user: { id: "u1", role: "ADMIN" } }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/brands/view-context", () => ({ getBrandViewContext: async () => ({ options: [] }) }));
vi.mock("@/components/brands/brand-view", () => ({ BrandViewProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/contacts/contacts-list", () => ({ ContactsList: () => null }));

import ContactsPage from "./page";

function propsDeLaLista(arbol: React.ReactElement): Record<string, unknown> {
  const proveedor = (arbol.props as { children: React.ReactElement }).children;
  return (proveedor.props as { children: React.ReactElement }).children.props as Record<string, unknown>;
}

beforeEach(() => {
  getContacts.mockReset().mockResolvedValue({ contacts: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
});

describe("Contactos — ?estado=", () => {
  it("filtra la primera página y pasa el estado a la lista", async () => {
    const arbol = (await ContactsPage({ searchParams: Promise.resolve({ estado: "DEMO" }) })) as React.ReactElement;
    expect(getContacts).toHaveBeenCalledWith(expect.objectContaining({ estado: "DEMO" }));
    expect(propsDeLaLista(arbol).estadoInicial).toBe("DEMO");
  });
  it("ignora un estado inventado", async () => {
    const arbol = (await ContactsPage({ searchParams: Promise.resolve({ estado: "XYZ" }) })) as React.ReactElement;
    expect(getContacts).toHaveBeenCalledWith(expect.objectContaining({ estado: null }));
    expect(propsDeLaLista(arbol).estadoInicial).toBeNull();
  });
});
