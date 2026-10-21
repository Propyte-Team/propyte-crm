// Servicio de email transaccional via Nodemailer + el SMTP de SMTP_HOST (hoy Gmail, ver #839)
import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";
import { MENSAJE_SMTP_NO_CONFIGURADO, type CorreoQueFallo } from "./fallo-smtp";

// Transporter lazy — no truena en build/import
let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(MENSAJE_SMTP_NO_CONFIGURADO);
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
 * Lo que lanza el mailer cuando un correo no salió (#839). Las rutas lo distinguen de
 * cualquier otro error para decirle a la persona «no pudimos enviar el correo» en vez de un
 * «Error al procesar la solicitud» genérico. `message` es el mismo texto de antes.
 */
export class CorreoNoEnviadoError extends Error {
  constructor(message: string, readonly causaOriginal: unknown) {
    super(message);
    this.name = "CorreoNoEnviadoError";
  }
}

/**
 * Manda el correo y, si no sale, avisa a los administradores antes de relanzar (#839).
 * `getTransporter()` va DENTRO del try: un SMTP sin configurar también es un correo que no
 * salió, y antes se escapaba sin el aviso ni el mensaje propio.
 *
 * El aviso se importa al fallar y no arriba: así el camino normal no carga la base de datos,
 * y el mailer se sigue pudiendo probar sin ella.
 */
async function enviar(
  que: CorreoQueFallo,
  opciones: SendMailOptions & { to: string },
  fallo: { log: string; mensaje: string } | null,
): Promise<void> {
  try {
    await getTransporter().sendMail(opciones);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[smtp] ${fallo?.log ?? "Error enviando correo"}:`, message);
    try {
      const { avisarFalloSmtp } = await import("./avisar-fallo-smtp");
      await avisarFalloSmtp({ err, que, destinatario: opciones.to });
    } catch (e) {
      console.error("[smtp] no se pudo cargar el aviso de fallo", e);
    }
    // Las automatizaciones (sendSmtpEmail) siempre recibieron el error original de nodemailer;
    // se respeta para no cambiar lo que guardan en su historial.
    if (!fallo) throw err;
    throw new CorreoNoEnviadoError(fallo.mensaje, err);
  }
}

// Escapa HTML de inputs de usuario antes de interpolarlos en el correo
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Notifica al equipo una solicitud de acceso al CRM desde el landing (BUG-15).
 */
export async function sendAccessRequest(input: {
  name: string;
  email: string;
  company?: string;
  message?: string;
}) {
  const to = process.env.ACCESS_REQUEST_TO ?? "marketing@propyte.com";

  await enviar(
    "solicitud_acceso",
    {
      from: from(),
      to,
      replyTo: input.email,
      subject: `Solicitud de acceso al CRM — ${input.name}`,
      html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
    <h2 style="color:#1a1a1a;margin-bottom:16px;">Solicitud de acceso — Propyte CRM</h2>
    <p style="color:#444;margin:4px 0;"><b>Nombre:</b> ${esc(input.name)}</p>
    <p style="color:#444;margin:4px 0;"><b>Email:</b> ${esc(input.email)}</p>
    ${input.company ? `<p style="color:#444;margin:4px 0;"><b>Empresa:</b> ${esc(input.company)}</p>` : ""}
    ${input.message ? `<p style="color:#444;margin:12px 0 0;"><b>Mensaje:</b><br>${esc(input.message)}</p>` : ""}
  </div>
</body>
</html>`,
    },
    { log: "Error enviando solicitud de acceso", mensaje: "No se pudo enviar la solicitud de acceso" },
  );
}

/**
 * Envía un código de acceso temporal al correo del usuario.
 */
export async function sendLoginCode(email: string, code: string) {
  await enviar(
    "codigo_acceso",
    {
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
    },
    { log: "Error enviando código de acceso", mensaje: "No se pudo enviar el código de acceso" },
  );
}

/**
 * Envía un código para restablecer la contraseña.
 */
export async function sendPasswordResetCode(email: string, code: string) {
  await enviar(
    "restablecer_contrasena",
    {
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
    },
    { log: "Error enviando código de restablecimiento", mensaje: "No se pudo enviar el código de restablecimiento" },
  );
}

/**
 * Envío genérico para acciones de workflow (SEND_EMAIL fallback SMTP).
 * Reusa el transporter. `fromName` solo cambia el display; la dirección es SMTP_USER/SMTP_FROM.
 */
export async function sendSmtpEmail(input: {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
}): Promise<void> {
  const addr = process.env.SMTP_USER ?? "";
  const fromHeader = input.fromName ? `${input.fromName} <${addr}>` : from();
  await enviar("automatizacion", { from: fromHeader, to: input.to, subject: input.subject, html: input.html }, null);
}
