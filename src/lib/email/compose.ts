// Helpers PUROS para componer y rutear el envío de SEND_EMAIL. Sin BD, sin red.

/** Reemplaza {{k}} por vars[k]; si una línea conserva un {{...}} sin resolver, se elimina. */
export function renderVars(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
  return out
    .split("\n")
    .filter((line) => !/\{\{[^}]+\}\}/.test(line))
    .join("\n");
}

/** Para el subject: reemplaza vars y borra los {{...}} no resueltos (sin quitar la línea). */
function renderInline(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
  return out.replace(/\{\{[^}]+\}\}/g, "").trim();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Texto plano → HTML mínimo (escape + saltos de línea). sendGmail/sendMail usan html. */
export function plainToHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;color:#1a1a1a;white-space:normal">${esc(text).replace(/\n/g, "<br>")}</div>`;
}

export interface ResolvedContent { subject: string; body: string }

export function resolveEmailContent(input: {
  template: { subject: string | null; body: string } | null;
  configSubject: unknown;
  configBody: unknown;
  vars: Record<string, string>;
}): ResolvedContent | null {
  const rawSubject = input.template ? input.template.subject ?? "" : (typeof input.configSubject === "string" ? input.configSubject : "");
  const rawBody = input.template ? input.template.body : (typeof input.configBody === "string" ? input.configBody : "");
  const subject = renderInline(rawSubject, input.vars);
  const body = renderVars(rawBody, input.vars).trim();
  if (!subject || !body) return null;
  return { subject, body };
}

export type EmailSender = { kind: "gmail" | "smtp"; userId: string | null };

export async function resolveEmailSender(
  ownerUserId: string | null,
  isConnected: (userId: string) => Promise<boolean>,
): Promise<EmailSender> {
  if (ownerUserId && (await isConnected(ownerUserId))) return { kind: "gmail", userId: ownerUserId };
  return { kind: "smtp", userId: ownerUserId };
}
