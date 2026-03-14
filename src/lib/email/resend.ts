// Servicio de email transaccional via Resend
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Envía un código de acceso temporal al correo del usuario.
 */
export async function sendLoginCode(email: string, code: string) {
  const { error } = await resend.emails.send({
    from: "Propyte CRM <noreply@propyte.com>",
    to: email,
    subject: `Tu código de acceso: ${code}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1a1a1a; margin-bottom: 8px;">Propyte CRM</h2>
        <p style="color: #666; margin-bottom: 24px;">Tu código de acceso temporal:</p>
        <div style="background: #f4f4f5; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a;">${code}</span>
        </div>
        <p style="color: #999; font-size: 13px;">
          Este código es de un solo uso. Solicita uno nuevo cada vez que necesites acceder.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("Error enviando código de acceso:", error);
    throw new Error("No se pudo enviar el código de acceso");
  }
}
