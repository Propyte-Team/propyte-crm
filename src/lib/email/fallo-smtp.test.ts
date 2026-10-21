import { describe, it, expect } from "vitest";
import {
  armarAvisoFalloSmtp,
  causaFalloSmtp,
  detalleSeguro,
  enmascararCorreo,
  MENSAJE_SMTP_NO_CONFIGURADO,
  TIPO_AVISO_SMTP,
} from "./fallo-smtp";

// El error tal como lo dejó nodemailer en el log de hPanel el 2026-10-07 (#839).
function errorGmail535() {
  return Object.assign(
    new Error(
      "Invalid login: 535-5.7.8 Username and Password not accepted. For more information, go to\n" +
        "535 5.7.8  https://support.google.com/mail/?p=BadCredentials 41be03b00d2f7-b6a gsmtp",
    ),
    { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" },
  );
}

describe("causaFalloSmtp (#839)", () => {
  it("el 535 de Gmail es de credenciales", () => {
    expect(causaFalloSmtp(errorGmail535())).toBe("credenciales");
  });

  it("también lo reconoce solo por el texto, si el proveedor no rellena code", () => {
    expect(causaFalloSmtp(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"))).toBe("credenciales");
  });

  it("534 (Google pide clave de aplicación) también es de credenciales", () => {
    expect(causaFalloSmtp(Object.assign(new Error("x"), { responseCode: 534 }))).toBe("credenciales");
  });

  it("sin variables es no_configurado", () => {
    expect(causaFalloSmtp(new Error(MENSAJE_SMTP_NO_CONFIGURADO))).toBe("no_configurado");
  });

  it("sin conexión es conexion", () => {
    expect(causaFalloSmtp(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }))).toBe("conexion");
    expect(causaFalloSmtp(Object.assign(new Error("x"), { code: "ECONNECTION" }))).toBe("conexion");
  });

  it("lo demás es otro, y no truena con valores raros", () => {
    expect(causaFalloSmtp(new Error("Message rejected"))).toBe("otro");
    expect(causaFalloSmtp(null)).toBe("otro");
    expect(causaFalloSmtp("texto")).toBe("otro");
  });
});

describe("detalleSeguro", () => {
  it("se queda con el primer renglón y tacha la clave si apareciera", () => {
    const err = new Error("fallo con abcd1234efgh5678 dentro\nsegundo renglón");
    expect(detalleSeguro(err, "abcd1234efgh5678")).toBe("fallo con *** dentro");
  });

  it("recorta a 160", () => {
    expect(detalleSeguro(new Error("x".repeat(500)), undefined)).toHaveLength(160);
  });
});

describe("enmascararCorreo", () => {
  it("deja dos letras y el dominio", () => {
    expect(enmascararCorreo("fernanda@propyte.com")).toBe("fe***@propyte.com");
  });
  it("sin correo válido no inventa nada", () => {
    expect(enmascararCorreo(null)).toBeNull();
    expect(enmascararCorreo("sin-arroba")).toBeNull();
  });
});

describe("armarAvisoFalloSmtp", () => {
  it("con credenciales dice qué hacer, para quién era y que afecta a todo el correo", () => {
    const aviso = armarAvisoFalloSmtp({
      causa: "credenciales",
      que: "restablecer_contrasena",
      destinatario: "fe***@propyte.com",
      detalle: "Invalid login: 535-5.7.8",
      host: "smtp.gmail.com",
    });
    expect(aviso.type).toBe(TIPO_AVISO_SMTP);
    expect(aviso.title).toBe("Los correos del CRM no están saliendo");
    expect(aviso.message).toContain("restablecer la contraseña para fe***@propyte.com");
    expect(aviso.message).toContain("smtp.gmail.com rechazó el usuario y la clave");
    expect(aviso.message).toContain("SMTP_PASS");
    expect(aviso.message).toContain("tampoco salen los demás correos");
  });

  it("con causa desconocida muestra el detalle", () => {
    const aviso = armarAvisoFalloSmtp({
      causa: "otro",
      que: "automatizacion",
      destinatario: null,
      detalle: "Message rejected",
      host: undefined,
    });
    expect(aviso.message).toContain("el servidor de correo devolvió un error: Message rejected");
    expect(aviso.message).not.toContain(" para ");
  });
});
