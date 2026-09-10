import { describe, it, expect } from "vitest";
import {
  ROLES_QUE_CORREN_AGENTES,
  puedeCorrerAgentes,
  inputFueraDeTope,
  TOPE_CLAVES_INPUT,
  TOPE_BYTES_INPUT,
} from "./permisos";

// Tarjeta #714 (S-03). `POST /api/agents/[id]/run` solo pedía sesión, y los agentes tienen
// herramientas de ESCRITURA: `send_whatsapp` le manda un mensaje a una persona real y
// `capture_lead` da de alta contactos. O sea que el permiso más consecuente del sistema era
// el único sin puerta.

describe("puedeCorrerAgentes — quién sí", () => {
  it("ADMIN y DIRECTOR", () => {
    expect(puedeCorrerAgentes("ADMIN")).toBe(true);
    expect(puedeCorrerAgentes("DIRECTOR")).toBe(true);
  });

  it("los roles operativos NO, y son los que antes sí podían", () => {
    // Esta es la lista concreta del hueco: cualquiera de estos, con solo tener sesión,
    // podía disparar un agente que le escribe a un cliente en nombre de la empresa.
    for (const rol of ["ASESOR", "ASESOR_SR", "ASESOR_JR", "GERENTE", "HOSTESS", "MARKETING", "TEAM_LEADER"]) {
      expect(puedeCorrerAgentes(rol), `${rol} no debería poder correr agentes`).toBe(false);
    }
  });

  it("sin rol, no", () => {
    // Un token viejo sin `role`, o una sesión a medio construir, no se cuela por
    // `undefined`. El default es cerrado: es la lección de la #715 A-03, donde el rol no
    // contemplado veía TODO porque el default era «sin restricción».
    expect(puedeCorrerAgentes(undefined)).toBe(false);
    expect(puedeCorrerAgentes(null)).toBe(false);
    expect(puedeCorrerAgentes("")).toBe(false);
  });

  it("distingue mayúsculas: no acepta un rol «casi»", () => {
    expect(puedeCorrerAgentes("admin")).toBe(false);
    expect(puedeCorrerAgentes("Director")).toBe(false);
    expect(puedeCorrerAgentes("ADMINISTRADOR")).toBe(false);
  });

  it("la lista es corta a propósito", () => {
    // No es cosmético: cada rol de más es una persona más que puede mandarle un WhatsApp a
    // un cliente sin escribirlo. Si esta prueba falla porque alguien añadió un rol, que sea
    // una decisión consciente y no un descuido.
    expect(ROLES_QUE_CORREN_AGENTES).toEqual(["ADMIN", "DIRECTOR"]);
  });
});

describe("inputFueraDeTope — la barandilla del input", () => {
  it("un input normal pasa", () => {
    expect(inputFueraDeTope({})).toBeNull();
    expect(inputFueraDeTope({ contactId: "c1", motivo: "seguimiento" })).toBeNull();
  });

  it("rechaza demasiadas claves", () => {
    const muchas: Record<string, unknown> = {};
    for (let i = 0; i <= TOPE_CLAVES_INPUT; i++) muchas[`k${i}`] = 1;

    const r = inputFueraDeTope(muchas);
    expect(r).not.toBeNull();
    expect(r!.motivo).toMatch(/claves/);
  });

  it("acepta exactamente el tope de claves", () => {
    // El límite es inclusivo: rechazar en el tope en vez de pasarlo es el error clásico de
    // los off-by-one, y aquí se traduce en un 400 sobre una llamada legítima.
    const justas: Record<string, unknown> = {};
    for (let i = 0; i < TOPE_CLAVES_INPUT; i++) justas[`k${i}`] = 1;

    expect(inputFueraDeTope(justas)).toBeNull();
  });

  it("rechaza un input enorme aunque tenga UNA sola clave", () => {
    // El caso que de verdad importa: el tope de claves no acota nada si una sola puede
    // llevar un texto de megabytes hacia el prompt del modelo.
    const r = inputFueraDeTope({ prompt: "a".repeat(TOPE_BYTES_INPUT + 1) });

    expect(r).not.toBeNull();
    expect(r!.motivo).toMatch(/bytes/);
  });

  it("mide BYTES y no caracteres", () => {
    // Un acento son dos bytes en UTF-8. Contar caracteres dejaría pasar casi el doble de lo
    // que se le manda al modelo, que cobra por bytes.
    const conAcentos = "á".repeat(TOPE_BYTES_INPUT - 100);
    expect(conAcentos.length).toBeLessThan(TOPE_BYTES_INPUT);

    const r = inputFueraDeTope({ texto: conAcentos });
    expect(r, "debería rechazar: son ~2 bytes por carácter").not.toBeNull();
    expect(r!.motivo).toMatch(/bytes/);
  });

  it("rechaza lo que no se puede serializar en vez de dejarlo pasar", () => {
    // Una referencia circular hace tronar a JSON.stringify. Si el error escapara, el 400 se
    // convertiría en un 500; y un input que no se puede serializar tampoco se le puede
    // pasar al modelo, así que la respuesta correcta es rechazarlo.
    const circular: Record<string, unknown> = { a: 1 };
    circular.yo = circular;

    const r = inputFueraDeTope(circular);
    expect(r).not.toBeNull();
    expect(r!.motivo).toMatch(/serializable/);
  });
});
