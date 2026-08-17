import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  isPermission,
  isSensitive,
} from "./catalog";

describe("catálogo de permisos", () => {
  it("toda clave tiene etiqueta legible", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(PERMISSIONS[key].label.length, `${key} sin etiqueta`).toBeGreaterThan(3);
    }
  });

  it("las claves usan el formato modulo.accion", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(key, `${key} no es modulo.accion`).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it("los sensibles son exactamente los dos decididos", () => {
    expect([...SENSITIVE_PERMISSIONS].sort()).toEqual([
      "permisos.gestionar",
      "usuarios.password",
    ]);
  });

  it("isSensitive coincide con la lista", () => {
    expect(isSensitive("usuarios.password")).toBe(true);
    expect(isSensitive("permisos.gestionar")).toBe(true);
    expect(isSensitive("usuarios.ver")).toBe(false);
    // integraciones.apikeys NO es sensible a propósito: marcarlo se lo
    // quitaría también a DIRECTOR, y eso nadie lo decidió. Ver spec §4.1.
    expect(isSensitive("integraciones.apikeys")).toBe(false);
  });

  it("isPermission rechaza lo que no está en el catálogo", () => {
    expect(isPermission("usuarios.ver")).toBe(true);
    expect(isPermission("usuarios.inventado")).toBe(false);
    expect(isPermission("")).toBe(false);
  });

  it("cubre las superficies que migrará la fase 1", () => {
    for (const key of [
      "usuarios.ver",
      "usuarios.editar",
      "usuarios.password",
      "comisiones.reglas",
      "config.actividad",
      "integraciones.conectores",
      "integraciones.apikeys",
      "bot.configurar",
      "comentarios.gestionar",
      "permisos.gestionar",
    ]) {
      expect(ALL_PERMISSIONS, `falta ${key}`).toContain(key);
    }
  });
});
