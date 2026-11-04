import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";

// Vitest compila el JSX en modo clásico (environment: node, sin plugin de React).
(globalThis as unknown as { React: typeof React }).React = React;

// #958 — los enlaces de las tareas abren /contacts?etiqueta=…: la primera página ya sale filtrada y
// la lista recibe la etiqueta para mostrar el chip y seguir filtrando al paginar.
const getContacts = vi.fn();
vi.mock("@/server/contacts", () => ({ getContacts: (...a: unknown[]) => getContacts(...a) }));
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => ({ user: { id: "u1", role: "ADMIN" } }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/brands/view-context", () => ({ getBrandViewContext: async () => ({ options: [] }) }));
vi.mock("@/components/brands/brand-view", () => ({ BrandViewProvider: ({ children }: { children: unknown }) => children }));
const ContactsList = vi.fn((_props: Record<string, unknown>) => null);
vi.mock("@/components/contacts/contacts-list", () => ({ ContactsList: (p: Record<string, unknown>) => ContactsList(p) }));

import ContactsPage from "./page";

beforeEach(() => {
  getContacts.mockReset();
  getContacts.mockResolvedValue({ contacts: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
});

function propsDeLaLista(arbol: React.ReactElement): Record<string, unknown> {
  // <div><BrandViewProvider><ContactsList …/></BrandViewProvider></div>
  const proveedor = (arbol.props as { children: React.ReactElement }).children;
  const lista = (proveedor.props as { children: React.ReactElement }).children;
  return lista.props as Record<string, unknown>;
}

describe("Contactos — ?etiqueta= (#958)", () => {
  it("filtra la primera página y pasa la etiqueta a la lista", async () => {
    const arbol = (await ContactsPage({ searchParams: Promise.resolve({ etiqueta: "falta-razon" }) })) as React.ReactElement;
    expect(getContacts).toHaveBeenCalledWith(expect.objectContaining({ etiqueta: "falta-razon" }));
    expect(propsDeLaLista(arbol).etiquetaInicial).toBe("falta-razon");
  });

  it("sin etiqueta no filtra", async () => {
    const arbol = (await ContactsPage({ searchParams: Promise.resolve({}) })) as React.ReactElement;
    expect(getContacts).toHaveBeenCalledWith(expect.objectContaining({ etiqueta: null }));
    expect(propsDeLaLista(arbol).etiquetaInicial).toBeNull();
  });
});
