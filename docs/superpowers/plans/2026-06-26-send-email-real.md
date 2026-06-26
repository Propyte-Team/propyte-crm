# SEND_EMAIL real — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la acción de workflow `SEND_EMAIL` envíe correo de verdad: desde el Gmail del asesor asignado (si tiene Google conectado, con su firma) o por SMTP compartido como fallback, dejando rastro en el timeline del contacto.

**Architecture:** Helpers puros en `src/lib/email/compose.ts` (resolver contenido desde `UserTemplate`/config + render de variables + texto→HTML + resolver remitente gmail/smtp). Un envío SMTP genérico nuevo en `mailer.ts` reusando su transporter Nodemailer. El runner `SEND_EMAIL` de `actions.ts` orquesta: contenido → remitente → envío (`sendGmail` o `sendSmtpEmail`) → log (el hilo en Gmail; una `Activity` en SMTP). Sin migración, sin tocar el motor.

**Tech Stack:** TypeScript, Next.js 14, Prisma, Nodemailer (SMTP Hostinger), Gmail API (googleapis), Vitest.

**Convenciones (leer antes):**
- Worktree `.claude/worktrees/crm-email-send` (rama `feat/crm-email-send` desde `origin/main` `0a90ebf`). Rutas relativas a la raíz del repo.
- Vitest `npx vitest run <ruta>`. Typecheck `npx tsc --noEmit`. Build `npm run build`.
- Si `tsc`/tests fallan por `node_modules`/cliente Prisma ausentes en el worktree: `npm install` + `npx prisma generate` una vez. (Hay 2 errores tsc PRE-existentes en `src/lib/workflows/builder-model.test.ts` — NO son tuyos.)
- Autor commits ya configurado (`Propyte-Luis`). Verificar con `git config user.name`; NO cambiar config.
- Infra existente (NO reconstruir): `src/lib/google/gmail.ts` `sendGmail({userId,to,subject,html,from?,threadId?})` (envía vía Gmail del usuario y logea el saliente al hilo); `src/lib/google/workspace.service.ts` `getConnectionStatus(userId)` (¿Google conectado?); `src/lib/email/mailer.ts` (transporter Nodemailer + `getTransporter()` privado + `from()` privado con `SMTP_FROM ?? "Propyte CRM <SMTP_USER>"`); `actions.ts` helpers `ownerUserId(contact)`, `loadContact(item)`. Modelos: `UserTemplate{channel,name,subject?,body,language,isActive}`, `UserProfile` (firma), `GoogleOAuthToken`, `Activity`.
- **GOTCHA:** `sendGmail` y `transporter.sendMail` usan **`html`**, no texto. El contenido se autora en texto plano y se convierte a HTML mínimo (escape + `\n`→`<br>`) al enviar.

---

## File Structure

**Crear:**
- `src/lib/email/compose.ts` — puro: `renderVars`, `plainToHtml`, `resolveEmailContent`, `resolveEmailSender`.
- `src/lib/email/compose.test.ts` — tests de los 4.
- `src/lib/email/mailer.send.test.ts` — test de `sendSmtpEmail`.

**Modificar:**
- `src/lib/email/mailer.ts` — exportar `sendSmtpEmail({to,subject,html,fromName?})` (reusa transporter).
- `src/lib/workflows/actions.ts` — reemplazar el case `SEND_EMAIL` no-op por la orquestación real.

---

## Task 1: Helpers de composición (`compose.ts`)

**Files:** Create `src/lib/email/compose.ts`; Test `src/lib/email/compose.test.ts`.

- [ ] **Step 1: Test que falla** — `src/lib/email/compose.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderVars, plainToHtml, resolveEmailContent, resolveEmailSender } from "./compose";

describe("renderVars", () => {
  it("reemplaza variables y quita la línea si queda una sin resolver", () => {
    const out = renderVars("Hola {{contact.firstName}}\nSaldo {{x}}\nFin", { "contact.firstName": "Ana" });
    expect(out).toBe("Hola Ana\nFin");
  });
});

describe("plainToHtml", () => {
  it("escapa HTML y convierte saltos de línea en <br>", () => {
    expect(plainToHtml("a<b>\nc")).toContain("a&lt;b&gt;");
    expect(plainToHtml("a\nc")).toContain("<br>");
  });
});

describe("resolveEmailContent", () => {
  const vars = { "contact.firstName": "Ana" };
  it("usa el template (subject+body) y renderiza variables", () => {
    const r = resolveEmailContent({ template: { subject: "Hola {{contact.firstName}}", body: "Cuerpo {{contact.firstName}}" }, configSubject: undefined, configBody: undefined, vars });
    expect(r).toEqual({ subject: "Hola Ana", body: "Cuerpo Ana" });
  });
  it("usa config inline si no hay template", () => {
    const r = resolveEmailContent({ template: null, configSubject: "Asunto", configBody: "Texto {{contact.firstName}}", vars });
    expect(r).toEqual({ subject: "Asunto", body: "Texto Ana" });
  });
  it("sin body → null", () => {
    expect(resolveEmailContent({ template: null, configSubject: "x", configBody: undefined, vars })).toBeNull();
  });
  it("sin subject → null", () => {
    expect(resolveEmailContent({ template: null, configSubject: undefined, configBody: "x", vars })).toBeNull();
  });
});

describe("resolveEmailSender", () => {
  it("owner con Google conectado → gmail", async () => {
    const r = await resolveEmailSender("u1", async () => true);
    expect(r).toEqual({ kind: "gmail", userId: "u1" });
  });
  it("owner sin conexión → smtp conservando userId", async () => {
    const r = await resolveEmailSender("u1", async () => false);
    expect(r).toEqual({ kind: "smtp", userId: "u1" });
  });
  it("sin owner → smtp userId null", async () => {
    const r = await resolveEmailSender(null, async () => true);
    expect(r).toEqual({ kind: "smtp", userId: null });
  });
});
```

- [ ] **Step 2: Correr para verlo fallar** — `npx vitest run src/lib/email/compose.test.ts` → FAIL (módulo ausente).

- [ ] **Step 3: Implementar** — `src/lib/email/compose.ts`:

```ts
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
```

- [ ] **Step 4: Correr para verlo pasar** — `npx vitest run src/lib/email/compose.test.ts` → PASS (8 casos). `npx tsc --noEmit` limpio (salvo los 2 pre-existentes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/compose.ts src/lib/email/compose.test.ts
git commit -m "feat(email): helpers puros de composición/ruteo de SEND_EMAIL"
```

---

## Task 2: Envío SMTP genérico (`sendSmtpEmail`)

**Files:** Modify `src/lib/email/mailer.ts`; Test `src/lib/email/mailer.send.test.ts`.

- [ ] **Step 1: READ `src/lib/email/mailer.ts`** — confirma `getTransporter()` (privado, lee `SMTP_HOST/USER/PASS/PORT`) y `from()` (privado, `SMTP_FROM ?? "Propyte CRM <SMTP_USER>"`).

- [ ] **Step 2: Test que falla** — `src/lib/email/mailer.send.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Correr para verlo fallar** — `npx vitest run src/lib/email/mailer.send.test.ts` → FAIL (export ausente).

- [ ] **Step 4: Implementar** — agregar al final de `src/lib/email/mailer.ts`:

```ts
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
  const transporter = getTransporter();
  const addr = process.env.SMTP_USER ?? "";
  const fromHeader = input.fromName ? `${input.fromName} <${addr}>` : from();
  await transporter.sendMail({ from: fromHeader, to: input.to, subject: input.subject, html: input.html });
}
```

- [ ] **Step 5: Correr para verlo pasar** — `npx vitest run src/lib/email/mailer.send.test.ts` → PASS. `npx tsc --noEmit` limpio.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email/mailer.ts src/lib/email/mailer.send.test.ts
git commit -m "feat(email): sendSmtpEmail genérico reusando transporter Nodemailer"
```

---

## Task 3: Orquestación del runner `SEND_EMAIL`

**Files:** Modify `src/lib/workflows/actions.ts`.

- [ ] **Step 1: READ `src/lib/workflows/actions.ts`** — confirma: el case `SEND_EMAIL` actual (~línea 209, devuelve skip "se habilita con F5"); `ownerUserId(contact)`; cómo el case `SEND_WHATSAPP` arma variables y resuelve plantilla (`renderTemplateBody`); cómo `CREATE_TASK`/`NOTIFY` crean registros (`prisma.activity.create` o similar) para imitar el modelo `Activity` real (campos exactos: `type`, `contactId`, `userId`, `subject`/`title`, `body`/`notes`, etc.).

- [ ] **Step 2: Imports al inicio de actions.ts**

```ts
import { resolveEmailContent, resolveEmailSender, plainToHtml } from "@/lib/email/compose";
import { sendSmtpEmail } from "@/lib/email/mailer";
import { sendGmail } from "@/lib/google/gmail";
import { getConnectionStatus } from "@/lib/google/workspace.service";
```

- [ ] **Step 3: Reemplazar el case `SEND_EMAIL`** (el bloque actual que devuelve `{ skipped: true, note: "SEND_EMAIL se habilita con F5..." }`) por:

```ts
    case "SEND_EMAIL": {
      if (!contact?.email) return { skipped: true, note: "Contacto sin email" };
      if (contact.doNotContact) return { skipped: true, note: "Opt-out" };

      // 1) Plantilla (si config.template) o contenido inline.
      const templateRef = typeof config.template === "string" ? config.template : undefined;
      const tpl = templateRef
        ? await prisma.userTemplate.findFirst({
            where: {
              isActive: true, channel: "EMAIL",
              OR: [{ id: templateRef }, { name: templateRef }],
              language: contact.language === "EN" ? "EN" : "ES",
            },
            select: { subject: true, body: true },
          })
        : null;

      const vars: Record<string, string> = {
        "contact.firstName": contact.firstName ?? "",
        "contact.lastName": contact.lastName ?? "",
      };
      const content = resolveEmailContent({
        template: tpl, configSubject: config.subject, configBody: config.body, vars,
      });
      if (!content) return { skipped: true, note: "SEND_EMAIL sin contenido (plantilla o subject/body)" };

      // 2) Remitente: Gmail del dueño si está conectado; si no, SMTP.
      const owner = await ownerUserId(contact);
      const sender = await resolveEmailSender(owner, async (uid) => {
        const st = await getConnectionStatus(uid).catch(() => null);
        return Boolean(st && (st as { connected?: boolean }).connected);
      });

      // 3) Firma del perfil del dueño (ambos paths).
      let body = content.body;
      if (sender.userId) {
        const profile = await prisma.userProfile.findUnique({
          where: { userId: sender.userId }, select: { signature: true },
        }).catch(() => null);
        const sig = profile?.signature?.trim();
        if (sig) body = `${body}\n\n${sig}`;
      }
      const html = plainToHtml(body);

      // 4) Enviar.
      if (sender.kind === "gmail" && sender.userId) {
        await sendGmail({ userId: sender.userId, to: contact.email, subject: content.subject, html });
        return {}; // sendGmail ya logea el saliente al hilo del contacto
      }

      // SMTP fallback: enviar + Activity en el timeline.
      const ownerName = sender.userId
        ? (await prisma.user.findUnique({ where: { id: sender.userId }, select: { name: true } }).catch(() => null))?.name ?? undefined
        : undefined;
      await sendSmtpEmail({ to: contact.email, subject: content.subject, html, fromName: ownerName });
      const logUserId = sender.userId ?? (await ownerUserId(contact));
      if (logUserId) {
        await prisma.activity.create({
          data: {
            type: "EMAIL", contactId: contact.id, userId: logUserId,
            subject: content.subject, body, direction: "OUTBOUND",
          },
        }).catch(() => null);
      }
      return {};
    }
```

> IMPORTANTE: los nombres de campos de `prisma.activity.create` (`type`/`subject`/`body`/`direction`/etc.) y el valor del enum (`"EMAIL"`, `"OUTBOUND"`) DEBEN coincidir con el modelo `Activity` real y otros usos en `actions.ts`. Ajusta según lo que viste en Step 1 (p. ej. si el campo es `title`/`notes` o si no hay `direction`). Si `Activity` no tiene un tipo `EMAIL`, usa el que exista para correos o el genérico que usen `CREATE_TASK`/`NOTIFY`. El `getConnectionStatus` devuelve un objeto de estado; ajusta el check `connected` al shape real (Step 1 / leer `workspace.service.ts`).

- [ ] **Step 4: Test del runner** — `src/lib/workflows/actions.send-email.test.ts`. Mockea las dependencias de red/BD y verifica el ruteo. Ejemplo (ADAPTA los mocks al estilo de otros tests de actions si existen):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendGmail = vi.fn().mockResolvedValue({ messageId: "m", threadId: "t", from: "x" });
const sendSmtpEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/google/gmail", () => ({ sendGmail }));
vi.mock("@/lib/email/mailer", () => ({ sendSmtpEmail }));
const getConnectionStatus = vi.fn();
vi.mock("@/lib/google/workspace.service", () => ({ getConnectionStatus }));

const contact = { id: "c1", email: "a@b.com", firstName: "Ana", lastName: "P", doNotContact: false, language: "ES", assignedToId: "u1" };
const prismaMock = {
  contact: { findUnique: vi.fn().mockResolvedValue(contact) },
  userTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
  userProfile: { findUnique: vi.fn().mockResolvedValue({ signature: "— Ana" }) },
  user: { findUnique: vi.fn().mockResolvedValue({ name: "Ana" }) },
  activity: { create: vi.fn().mockResolvedValue({}) },
  deal: { findUnique: vi.fn() },
};
vi.mock("@/lib/db", () => ({ default: prismaMock }));

beforeEach(() => { sendGmail.mockClear(); sendSmtpEmail.mockClear(); prismaMock.activity.create.mockClear(); });

describe("SEND_EMAIL runner", () => {
  it("usa Gmail cuando el dueño está conectado", async () => {
    getConnectionStatus.mockResolvedValue({ connected: true });
    const { executeAction } = await import("./actions");
    const r = await executeAction({ actionType: "SEND_EMAIL", entityType: "contact", entityId: "c1", config: { subject: "Hola {{contact.firstName}}", body: "Cuerpo" } } as never);
    expect(sendGmail).toHaveBeenCalledTimes(1);
    expect(sendSmtpEmail).not.toHaveBeenCalled();
    expect(r.skipped).toBeUndefined();
  });

  it("cae a SMTP + Activity cuando no hay conexión", async () => {
    getConnectionStatus.mockResolvedValue({ connected: false });
    const { executeAction } = await import("./actions");
    await executeAction({ actionType: "SEND_EMAIL", entityType: "contact", entityId: "c1", config: { subject: "Hola", body: "Cuerpo" } } as never);
    expect(sendSmtpEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1);
  });

  it("skip si no hay contenido", async () => {
    getConnectionStatus.mockResolvedValue({ connected: true });
    const { executeAction } = await import("./actions");
    const r = await executeAction({ actionType: "SEND_EMAIL", entityType: "contact", entityId: "c1", config: {} } as never);
    expect(r.skipped).toBe(true);
    expect(sendGmail).not.toHaveBeenCalled();
  });
});
```

> Si el patrón de mock de `@/lib/db` o la firma de `executeAction` difiere de los tests existentes en `src/lib/workflows/`, ALINÉATE a ellos (lee uno antes). El objetivo es probar el ruteo gmail/smtp + skip-sin-contenido, no la red real.

- [ ] **Step 5: Correr + verificar**
`npx vitest run src/lib/workflows src/lib/email` → verde. `npx tsc --noEmit` → solo los 2 pre-existentes. `npm run build` → verde (paste status).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/actions.ts src/lib/workflows/actions.send-email.test.ts
git commit -m "feat(workflows): SEND_EMAIL real (Gmail del asesor + fallback SMTP + Activity)"
```

---

## Verificación final (antes de merge)
- [ ] `npx vitest run` — suite verde (incluye compose + mailer.send + actions.send-email).
- [ ] `npx tsc --noEmit` — solo los 2 pre-existentes de `builder-model.test.ts`.
- [ ] `npm run build` — verde.
- [ ] **Smoke (opcional, pedir autorización):** difícil end-to-end sin un asesor con Google conectado + un envío real; el valor está en los unit tests del ruteo. Alternativa: verificar que el endpoint/cron del motor encola y que un `SEND_EMAIL` con SMTP configurado manda (requiere `SMTP_*` en el dev). Probable que se omita como en métricas.
- [ ] Review final (Opus) del diff.
- [ ] ff-push `feat/crm-email-send` → `main` (autor Propyte-Luis) → auto-deploy.

## Notas / caveats
- **Gmail `from` = cuenta conectada** (default de `sendGmail`); NO se fuerza el alias `sendAs` en v1 para evitar rechazos por alias no verificado. Alias por perfil = mejora futura.
- **HTML mínimo** (escape + nl2br); diseño rico/plantillas HTML = futuro.
- **Env del fallback:** reusa `SMTP_HOST/USER/PASS/PORT/FROM` (ya configurados para login/reset). Si faltan, `getTransporter()` lanza → la acción reintenta y eventualmente FAILED (visible en `action_queue`). No se introduce `EMAIL_FROM` (el spec lo mencionaba; se usa el `SMTP_*` existente).
- **Fuera de alcance:** MAKE_CALL (E2), HTML rico, adjuntos, tracking, threading de respuestas.
