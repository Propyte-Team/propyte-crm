import { describe, it, expect, vi, beforeEach } from "vitest";

// #839: cuando un correo no sale, el mailer avisa a los administradores y lanza un error que
// las rutas pueden distinguir. Antes solo dejaba una línea en el log.
const sendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: (o: unknown) => sendMail(o) }) },
}));
const avisar = vi.fn();
vi.mock("./avisar-fallo-smtp", () => ({
  avisarFalloSmtp: (a: unknown) => avisar(a),
}));

const err535 = Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), {
  code: "EAUTH",
  responseCode: 535,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  avisar.mockResolvedValue({ causa: "credenciales", avisados: ["a"] });
  process.env.SMTP_HOST = "smtp.gmail.com";
  process.env.SMTP_USER = "u@test.com";
  process.env.SMTP_PASS = "x";
});

describe("mailer cuando el correo no sale (#839)", () => {
  it("restablecer contraseña: lanza CorreoNoEnviadoError con el mismo texto y avisa", async () => {
    sendMail.mockRejectedValue(err535);
    const { sendPasswordResetCode, CorreoNoEnviadoError } = await import("./mailer");

    const e = await sendPasswordResetCode("fernanda@propyte.com", "123456").catch((x) => x);
    expect(e).toBeInstanceOf(CorreoNoEnviadoError);
    expect(e.message).toBe("No se pudo enviar el código de restablecimiento");
    expect(e.causaOriginal).toBe(err535);
    expect(avisar).toHaveBeenCalledWith({ err: err535, que: "restablecer_contrasena", destinatario: "fernanda@propyte.com" });
  });

  it("código de acceso y solicitud de acceso también avisan", async () => {
    sendMail.mockRejectedValue(err535);
    const { sendLoginCode, sendAccessRequest, CorreoNoEnviadoError } = await import("./mailer");

    await expect(sendLoginCode("a@b.com", "1")).rejects.toBeInstanceOf(CorreoNoEnviadoError);
    await expect(sendAccessRequest({ name: "N", email: "c@d.com" })).rejects.toBeInstanceOf(CorreoNoEnviadoError);
    expect(avisar.mock.calls.map((c) => c[0].que)).toEqual(["codigo_acceso", "solicitud_acceso"]);
  });

  it("SMTP sin configurar también es un correo que no salió: avisa y lanza el error propio", async () => {
    delete process.env.SMTP_PASS;
    const { sendPasswordResetCode, CorreoNoEnviadoError } = await import("./mailer");

    await expect(sendPasswordResetCode("a@b.com", "1")).rejects.toBeInstanceOf(CorreoNoEnviadoError);
    expect(sendMail).not.toHaveBeenCalled();
    expect(String(avisar.mock.calls[0][0].err)).toContain("SMTP no configurado");
  });

  it("las automatizaciones siguen recibiendo el error original, pero también avisan", async () => {
    sendMail.mockRejectedValue(err535);
    const { sendSmtpEmail } = await import("./mailer");

    await expect(sendSmtpEmail({ to: "c@d.com", subject: "S", html: "<p>x</p>" })).rejects.toBe(err535);
    expect(avisar).toHaveBeenCalledWith({ err: err535, que: "automatizacion", destinatario: "c@d.com" });
  });

  it("si el aviso truena, el error que sale es el del correo", async () => {
    sendMail.mockRejectedValue(err535);
    avisar.mockRejectedValue(new Error("aviso roto"));
    const { sendLoginCode } = await import("./mailer");
    await expect(sendLoginCode("a@b.com", "1")).rejects.toThrow("No se pudo enviar el código de acceso");
  });

  it("cuando el correo sale, no avisa a nadie", async () => {
    sendMail.mockResolvedValue({ messageId: "m1" });
    const { sendPasswordResetCode } = await import("./mailer");
    await sendPasswordResetCode("a@b.com", "1");
    expect(avisar).not.toHaveBeenCalled();
  });
});
