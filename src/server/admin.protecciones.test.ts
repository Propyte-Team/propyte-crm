import { describe, it, expect, vi, beforeEach } from "vitest";

// Mismo patrón que admin.resetPassword.test.ts: mockear la sesión y Prisma
// con vi.fn() para poder mover al actor y al objetivo entre roles sin tocar
// una base de datos real.
const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => session }));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userCount = vi.fn();
const configFindUnique = vi.fn();
const configUpsert = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
      count: (...a: unknown[]) => userCount(...a),
    },
    systemConfig: {
      findUnique: (...a: unknown[]) => configFindUnique(...a),
      upsert: (...a: unknown[]) => configUpsert(...a),
    },
  },
}));

import { deactivateUser, updateUser, updateSystemConfig } from "./admin";

// Objetivos de prueba reutilizables. isActive siempre parte en true salvo que
// el caso lo cambie explícitamente.
const ADMIN_TARGET = { id: "admin-2", name: "Otro Admin", email: "admin2@nativatulum.mx", role: "ADMIN", isActive: true };
const ASESOR_TARGET = { id: "asesor-1", name: "Asesor Uno", email: "asesor@nativatulum.mx", role: "ASESOR_SR", isActive: true };

beforeEach(() => {
  for (const m of [userFindUnique, userUpdate, userCount, configFindUnique, configUpsert]) m.mockReset();
  // Sin propietario designado por defecto: el reparto plano de siempre.
  configFindUnique.mockResolvedValue(null);
  configUpsert.mockImplementation(async (a: { create: unknown }) => a.create);
  session.user.role = "DIRECTOR";
  session.user.id = "actor-1";
  // Por defecto hay varios ADMIN activos: la Regla D solo debe dispararse en
  // los tests que explícitamente dejan un único ADMIN.
  userCount.mockResolvedValue(3);
  userUpdate.mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: args.where.id,
    ...args.data,
  }));
});

describe("Regla A — actuar sobre un ADMIN exige ser ADMIN", () => {
  it("GERENTE no puede desactivar a un ADMIN", async () => {
    session.user.role = "GERENTE";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);

    await expect(deactivateUser(ADMIN_TARGET.id)).rejects.toThrow(/administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("DIRECTOR no puede desactivar a un ADMIN", async () => {
    session.user.role = "DIRECTOR";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);

    await expect(deactivateUser(ADMIN_TARGET.id)).rejects.toThrow(/administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("GERENTE tampoco puede editar (sin desactivar) a un ADMIN", async () => {
    session.user.role = "GERENTE";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);

    await expect(updateUser(ADMIN_TARGET.id, { name: "Nuevo Nombre" })).rejects.toThrow(/administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("ADMIN sí puede desactivar a otro ADMIN cuando quedan varios activos", async () => {
    session.user.role = "ADMIN";
    session.user.id = "actor-1";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);
    userCount.mockResolvedValue(3);

    await expect(deactivateUser(ADMIN_TARGET.id)).resolves.toMatchObject({
      id: ADMIN_TARGET.id,
      isActive: false,
    });
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("Regla B — promover a ADMIN exige ser ADMIN", () => {
  it("GERENTE no puede promover a otro usuario a ADMIN", async () => {
    session.user.role = "GERENTE";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    await expect(updateUser(ASESOR_TARGET.id, { role: "ADMIN" })).rejects.toThrow(/administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("GERENTE no puede autopromoverse a ADMIN", async () => {
    session.user.role = "GERENTE";
    session.user.id = "gerente-1";
    const self = { id: "gerente-1", name: "Un Gerente", email: "gerente@nativatulum.mx", role: "GERENTE", isActive: true };
    userFindUnique.mockResolvedValue(self);

    await expect(updateUser("gerente-1", { role: "ADMIN" })).rejects.toThrow(/administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("Regla C — nadie se desactiva a sí mismo", () => {
  it("deactivateUser rechaza que el actor se desactive a sí mismo", async () => {
    session.user.role = "ADMIN";
    session.user.id = "actor-1";
    const self = { ...ADMIN_TARGET, id: "actor-1" };
    userFindUnique.mockResolvedValue(self);
    userCount.mockResolvedValue(3); // que no sea también el último ADMIN

    await expect(deactivateUser("actor-1")).rejects.toThrow(/propia cuenta/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("updateUser con isActive:false rechaza que el actor se desactive a sí mismo", async () => {
    session.user.role = "DIRECTOR";
    session.user.id = "actor-1";
    const self = { id: "actor-1", name: "Actor", email: "actor@nativatulum.mx", role: "DIRECTOR", isActive: true };
    userFindUnique.mockResolvedValue(self);

    await expect(updateUser("actor-1", { isActive: false })).rejects.toThrow(/propia cuenta/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("Regla D — no se puede desactivar al último ADMIN activo", () => {
  it("deactivateUser falla aunque el actor sea ADMIN", async () => {
    session.user.role = "ADMIN";
    session.user.id = "actor-1";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);
    userCount.mockResolvedValue(1); // el objetivo es el único ADMIN activo

    await expect(deactivateUser(ADMIN_TARGET.id)).rejects.toThrow(/último administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("updateUser con isActive:false también falla sobre el último ADMIN", async () => {
    session.user.role = "ADMIN";
    session.user.id = "actor-1";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);
    userCount.mockResolvedValue(1);

    await expect(updateUser(ADMIN_TARGET.id, { isActive: false })).rejects.toThrow(/último administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  // El hueco que la primera versión de la Regla D no cubría: desactivar no es
  // la única forma de quedarse sin administradores. Degradar al último ADMIN
  // deja la casa igual de cerrada, y es PEOR que desactivarlo, porque la Regla
  // B impide que nadie vuelva a repartir ese rol.
  it("degradar al último ADMIN también falla, aunque nadie lo desactive", async () => {
    session.user.role = "ADMIN";
    session.user.id = "actor-1";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);
    userCount.mockResolvedValue(1);

    await expect(updateUser(ADMIN_TARGET.id, { role: "GERENTE" })).rejects.toThrow(/último administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("el último ADMIN tampoco puede autodegradarse", async () => {
    session.user.role = "ADMIN";
    session.user.id = "admin-solo";
    userFindUnique.mockResolvedValue({ ...ADMIN_TARGET, id: "admin-solo" });
    userCount.mockResolvedValue(1);

    await expect(updateUser("admin-solo", { role: "DIRECTOR" })).rejects.toThrow(/último administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("degradar a un ADMIN cuando quedan varios sí funciona", async () => {
    session.user.role = "ADMIN";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);
    userCount.mockResolvedValue(3);

    await expect(updateUser(ADMIN_TARGET.id, { role: "GERENTE" })).resolves.toBeTruthy();
    expect(userUpdate).toHaveBeenCalled();
  });

  it("tocar a un ADMIN ya inactivo no cuenta contra el mínimo", async () => {
    session.user.role = "ADMIN";
    userFindUnique.mockResolvedValue({ ...ADMIN_TARGET, isActive: false });
    userCount.mockResolvedValue(1);

    await expect(updateUser(ADMIN_TARGET.id, { role: "GERENTE" })).resolves.toBeTruthy();
    expect(userCount).not.toHaveBeenCalled();
  });
});

describe("El blindaje no rompe el trabajo normal", () => {
  it("GERENTE puede seguir editando a un usuario NO-ADMIN (ASESOR)", async () => {
    session.user.role = "GERENTE";
    session.user.id = "gerente-1";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    await expect(updateUser(ASESOR_TARGET.id, { name: "Nombre Actualizado" })).resolves.toMatchObject({
      id: ASESOR_TARGET.id,
      name: "Nombre Actualizado",
    });
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it("GERENTE puede desactivar a un usuario NO-ADMIN (ASESOR)", async () => {
    session.user.role = "GERENTE";
    session.user.id = "gerente-1";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    await expect(deactivateUser(ASESOR_TARGET.id)).resolves.toMatchObject({
      id: ASESOR_TARGET.id,
      isActive: false,
    });
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it("ADMIN no es bloqueado por la Regla B (el esquema, no la autorización, decide el resto)", async () => {
    session.user.role = "ADMIN";
    session.user.id = "actor-1";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    // El esquema Zod de updateUser no incluye "ADMIN" entre los roles
    // asignables (ADMIN se administra fuera de este panel), así que la
    // llamada igual falla — pero por VALIDACIÓN, no por autorización: la
    // Regla B no debe ser lo que la bloquee cuando el actor sí es ADMIN.
    let error: unknown;
    try {
      await updateUser(ASESOR_TARGET.id, { role: "ADMIN" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect((error as Error).message).not.toMatch(/solo un administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("No filtra información de más", () => {
  it("el mensaje de la Regla A no revela el conteo de ADMIN ni otros datos del objetivo", async () => {
    session.user.role = "GERENTE";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);
    userCount.mockResolvedValue(1);

    await expect(deactivateUser(ADMIN_TARGET.id)).rejects.toThrow(/^Solo un Administrador puede modificar a otro Administrador$/);
  });
});

// El caso de Luis: tres ADMIN con el MISMO acceso al CRM, pero uno solo puede
// administrar a los otros dos. La jerarquía no puede salir del rol —ADMIN es
// comodín, y cualquier otro rol les daría menos acceso, no una posición
// distinta—, así que sale de una clave de system_config.
describe("Propietario — un solo ADMIN puede tocar a los demás ADMIN", () => {
  const PROPIETARIO = "luis-1";
  const OTRO_ADMIN = { id: "conrad-1", name: "Conrad", email: "conrad@propyte.com", role: "ADMIN", isActive: true };

  function conPropietario(id: string) {
    configFindUnique.mockResolvedValue({ key: "admin_owner_user_id", value: id });
  }

  it("sin propietario designado, cualquier ADMIN puede tocar a otro (comportamiento previo)", async () => {
    session.user.role = "ADMIN";
    session.user.id = "conrad-1";
    userFindUnique.mockResolvedValue({ ...OTRO_ADMIN, id: "fluksic-1" });
    configFindUnique.mockResolvedValue(null);

    await expect(updateUser("fluksic-1", { name: "Felipe" })).resolves.toBeTruthy();
  });

  it("con propietario, un ADMIN cualquiera NO puede tocar a otro ADMIN", async () => {
    session.user.role = "ADMIN";
    session.user.id = "conrad-1";
    userFindUnique.mockResolvedValue({ ...OTRO_ADMIN, id: "fluksic-1" });
    conPropietario(PROPIETARIO);

    await expect(updateUser("fluksic-1", { name: "Felipe" })).rejects.toThrow(/propietario/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("con propietario, un ADMIN cualquiera NO puede desactivar a otro ADMIN", async () => {
    session.user.role = "ADMIN";
    session.user.id = "conrad-1";
    userFindUnique.mockResolvedValue({ ...OTRO_ADMIN, id: "fluksic-1" });
    conPropietario(PROPIETARIO);

    await expect(deactivateUser("fluksic-1")).rejects.toThrow(/propietario/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("el propietario sí puede desactivar a otro ADMIN", async () => {
    session.user.role = "ADMIN";
    session.user.id = PROPIETARIO;
    userFindUnique.mockResolvedValue(OTRO_ADMIN);
    conPropietario(PROPIETARIO);

    await expect(deactivateUser(OTRO_ADMIN.id)).resolves.toBeTruthy();
  });

  it("un ADMIN no propietario sigue pudiendo editarse a sí mismo", async () => {
    session.user.role = "ADMIN";
    session.user.id = "conrad-1";
    userFindUnique.mockResolvedValue({ ...OTRO_ADMIN, id: "conrad-1" });
    conPropietario(PROPIETARIO);

    await expect(updateUser("conrad-1", { phone: "+52 998 000 0000" })).resolves.toBeTruthy();
  });

  it("un ADMIN no propietario sigue administrando el resto del CRM (edita a un ASESOR)", async () => {
    session.user.role = "ADMIN";
    session.user.id = "conrad-1";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);
    conPropietario(PROPIETARIO);

    await expect(updateUser(ASESOR_TARGET.id, { name: "Asesor Editado" })).resolves.toBeTruthy();
  });
});

describe("La clave del propietario se protege a sí misma", () => {
  it("un ADMIN que no es el propietario no puede robársela", async () => {
    session.user.role = "ADMIN";
    session.user.id = "conrad-1";
    configFindUnique.mockResolvedValue({ key: "admin_owner_user_id", value: "luis-1" });

    await expect(updateSystemConfig("admin_owner_user_id", "conrad-1")).rejects.toThrow(/propietario actual/i);
    expect(configUpsert).not.toHaveBeenCalled();
  });

  it("el propietario sí puede transferirla", async () => {
    session.user.role = "ADMIN";
    session.user.id = "luis-1";
    configFindUnique.mockResolvedValue({ key: "admin_owner_user_id", value: "luis-1" });

    await expect(updateSystemConfig("admin_owner_user_id", "conrad-1")).resolves.toBeTruthy();
  });

  it("sin propietario, cualquier ADMIN puede designar al primero (arranque)", async () => {
    session.user.role = "ADMIN";
    session.user.id = "conrad-1";
    configFindUnique.mockResolvedValue(null);

    await expect(updateSystemConfig("admin_owner_user_id", "luis-1")).resolves.toBeTruthy();
  });

  it("un GERENTE nunca puede designar propietario, aunque no haya ninguno", async () => {
    session.user.role = "GERENTE";
    session.user.id = "gerente-1";
    configFindUnique.mockResolvedValue(null);

    await expect(updateSystemConfig("admin_owner_user_id", "gerente-1")).rejects.toThrow(/administrador/i);
    expect(configUpsert).not.toHaveBeenCalled();
  });

  it("las demás claves de configuración siguen abiertas al rol de administración", async () => {
    session.user.role = "GERENTE";
    session.user.id = "gerente-1";

    await expect(updateSystemConfig("activity_agreement", { minDailyCalls: 10 })).resolves.toBeTruthy();
    expect(configUpsert).toHaveBeenCalled();
  });
});
