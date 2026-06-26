import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMail = vi.fn().mockResolvedValue({ messageId: "m1" });
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

beforeEach(() => {
  sendMail.mockClear();
  process.env.SMTP_HOST = "smtp.test"; process.env.SMTP_USER = "u@test.com"; process.env.SMTP_PASS = "x";
});

describe("sendSmtpEmail", () => {
  it("envía con el transporter y arma el from con fromName", async () => {
    const { sendSmtpEmail } = await import("./mailer");
    await sendSmtpEmail({ to: "a@b.com", subject: "Asunto", html: "<p>hola</p>", fromName: "Ana Asesora" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.subject).toBe("Asunto");
    expect(arg.html).toBe("<p>hola</p>");
    expect(String(arg.from)).toContain("Ana Asesora");
    expect(String(arg.from)).toContain("u@test.com");
  });

  it("sin fromName usa el remitente por defecto", async () => {
    const { sendSmtpEmail } = await import("./mailer");
    await sendSmtpEmail({ to: "a@b.com", subject: "S", html: "<p>x</p>" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].from).toBeTruthy();
  });
});
