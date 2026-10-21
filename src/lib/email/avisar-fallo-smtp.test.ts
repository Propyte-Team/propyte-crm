import { describe, it, expect, vi, beforeEach } from "vitest";

// #839: el aviso a los administradores cuando un correo no sale.
const userFindMany = vi.fn();
const notifFindMany = vi.fn();
const notifCreateMany = vi.fn();
vi.mock("@/lib/db", () => {
  const db = {
    user: { findMany: (a: unknown) => userFindMany(a) },
    notification: { findMany: (a: unknown) => notifFindMany(a), createMany: (a: unknown) => notifCreateMany(a) },
  };
  return { prisma: db, default: db };
});

import { avisarFalloSmtp } from "./avisar-fallo-smtp";

const err535 = Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), {
  code: "EAUTH",
  responseCode: 535,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMTP_HOST = "smtp.gmail.com";
  userFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
  notifFindMany.mockResolvedValue([]);
  notifCreateMany.mockResolvedValue({ count: 2 });
});

describe("avisarFalloSmtp (#839)", () => {
  it("avisa a los ADMIN que son personas, con la causa y el correo enmascarado", async () => {
    const r = await avisarFalloSmtp({ err: err535, que: "restablecer_contrasena", destinatario: "fernanda@propyte.com" });

    expect(r).toEqual({ causa: "credenciales", avisados: ["admin-1", "admin-2"] });
    const where = userFindMany.mock.calls[0][0].where;
    expect(where.role).toBe("ADMIN");
    expect(where.isActive).toBe(true);
    expect(where.NOT).toEqual({ email: { endsWith: ".local" } });

    const filas = notifCreateMany.mock.calls[0][0].data;
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ userId: "admin-1", type: "smtp_fallo", title: "Los correos del CRM no están saliendo" });
    expect(filas[0].message).toContain("fe***@propyte.com");
    expect(filas[0].message).not.toContain("fernanda@");
  });

  it("no repite el aviso a quien ya tiene uno sin leer", async () => {
    notifFindMany.mockResolvedValue([{ userId: "admin-1" }]);
    const r = await avisarFalloSmtp({ err: err535, que: "codigo_acceso", destinatario: "x@y.com" });

    expect(r.avisados).toEqual(["admin-2"]);
    const dedup = notifFindMany.mock.calls[0][0].where;
    expect(dedup).toMatchObject({ type: "smtp_fallo", isRead: false });
    expect(dedup.createdAt.gte).toBeInstanceOf(Date);
  });

  it("si todos ya tienen uno sin leer, no escribe nada", async () => {
    notifFindMany.mockResolvedValue([{ userId: "admin-1" }, { userId: "admin-2" }]);
    const r = await avisarFalloSmtp({ err: err535, que: "codigo_acceso" });
    expect(r.avisados).toEqual([]);
    expect(notifCreateMany).not.toHaveBeenCalled();
  });

  it("nunca lanza, aunque la base falle", async () => {
    userFindMany.mockRejectedValue(new Error("db caída"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(avisarFalloSmtp({ err: err535, que: "solicitud_acceso" })).resolves.toEqual({
      causa: "credenciales",
      avisados: [],
    });
    spy.mockRestore();
  });
});
