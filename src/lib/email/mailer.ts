// Servicio de email transaccional via Nodemailer + Hostinger SMTP
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// Transporter lazy — no truena en build/import
let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP no configurado (SMTP_HOST/USER/PASS)");
  }

  const port = Number(process.env.SMTP_PORT ?? 465);

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return _transporter;
}

function from(): string {
  return (
    process.env.SMTP_FROM ??
    `Propyte CRM <${process.env.SMTP_USER}>`
  );
}

/**
 * Envía un código de acceso temporal al correo del usuario.
 */
export async function sendLoginCode(email: string, code: string) {
  const transporter = getTransporter();

  try {
    await transporter.sendMail({
      from: from(),
      to: email,
      subject: `Tu código de acceso: ${code}`,
      html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
    <h2 style="color:#1a1a1a;margin-bottom:8px;">Propyte CRM</h2>
    <p style="color:#666;margin-bottom:24px;">Tu código de acceso temporal:</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
      <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a1a1a;">${code}</span>
    </div>
    <p style="color:#999;font-size:13px;">
      Este código expira en 10 minutos. Solicita uno nuevo si lo necesitas.
    </p>
  </div>
</body>
</html>`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error enviando código de acceso:", message);
    throw new Error("No se pudo enviar el código de acceso");
  }
}

/**
 * Envía un código para restablecer la contraseña.
 */
export async function sendPasswordResetCode(email: string, code: string) {
  const transporter = getTransporter();

  try {
    await transporter.sendMail({
      from: from(),
      to: email,
      subject: `Restablecer contraseña — código: ${code}`,
      html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
    <h2 style="color:#1a1a1a;margin-bottom:8px;">Propyte CRM</h2>
    <p style="color:#666;margin-bottom:24px;">Has solicitado restablecer tu contraseña. Usa este código:</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
      <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a1a1a;">${code}</span>
    </div>
    <p style="color:#999;font-size:13px;">
      Este código expira en 10 minutos. Si no solicitaste este cambio, ignora este correo.
    </p>
  </div>
</body>
</html>`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error enviando código de restablecimiento:", message);
    throw new Error("No se pudo enviar el código de restablecimiento");
  }
}
