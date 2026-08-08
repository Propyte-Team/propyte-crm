// Sonda de suscripciones de webhook de Meta (diagnóstico, read-only).
// Responde: ¿qué campos tiene suscrita CADA página para la app del CRM?
// `message_echoes` es un campo APARTE de `messages`: sin él, los envíos que hace
// la Página desde Business Suite / la app nunca llegan de vuelta como echo.
//
//   npx tsx --env-file=.env scripts/probe-meta-subscriptions.ts
//
// NO imprime tokens ni secretos: solo id/nombre de página y la lista de campos.
import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "crypto";

const prisma = new PrismaClient();
const GRAPH = "https://graph.facebook.com/v24.0";

function decryptPII(value: string): string {
  const [v, ivB64, tagB64, dataB64] = value.split(":");
  if (v !== "v1") throw new Error("Formato de cifrado desconocido");
  const k = Buffer.from(process.env.KYC_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("KYC_ENCRYPTION_KEY ausente o no son 32 bytes base64");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB64, "base64")), d.final()]).toString("utf8");
}

async function get(path: string, token: string) {
  const res = await fetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function main() {
  const connectors = await prisma.leadConnector.findMany({
    where: { deletedAt: null, provider: { in: ["MESSENGER", "INSTAGRAM"] } },
    orderBy: { name: "asc" },
  });

  // Un token por pageId (los conectores de la misma página comparten página).
  const byPage = new Map<string, { name: string; token: string; igBusinessId?: string }>();
  for (const c of connectors) {
    const cfg = (c.config ?? {}) as { pageId?: string; igBusinessId?: string };
    if (!cfg.pageId || !c.credentials) continue;
    let creds: { pageAccessToken?: string };
    try {
      creds = JSON.parse(decryptPII(c.credentials));
    } catch (err) {
      console.log(`${c.name}: credenciales ilegibles — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!creds.pageAccessToken) {
      console.log(`${c.name}: sin pageAccessToken`);
      continue;
    }
    const prev = byPage.get(cfg.pageId);
    byPage.set(cfg.pageId, {
      name: prev?.name ?? c.name,
      token: creds.pageAccessToken,
      igBusinessId: cfg.igBusinessId ?? prev?.igBusinessId,
    });
  }

  for (const [pageId, p] of byPage) {
    console.log(`\n=== ${p.name}  (page ${pageId})`);
    const subs = await get(`/${pageId}/subscribed_apps`, p.token);
    if (subs.status !== 200) {
      console.log(`  subscribed_apps → HTTP ${subs.status}`, JSON.stringify(subs.body));
      continue;
    }
    const apps = (subs.body.data ?? []) as Array<{ id?: string; name?: string; subscribed_fields?: string[] }>;
    if (!apps.length) console.log("  ⚠ ninguna app suscrita a esta página");
    for (const a of apps) {
      const f = a.subscribed_fields ?? [];
      console.log(`  app ${a.name} (${a.id}) → ${f.length} campos`);
      console.log(`    messages:          ${f.includes("messages") ? "✅" : "❌"}`);
      console.log(`    message_echoes:    ${f.includes("message_echoes") ? "✅" : "❌"}`);
      console.log(`    feed:              ${f.includes("feed") ? "✅" : "❌"}`);
      console.log(`    messaging_referral:${f.includes("messaging_referral") ? "✅" : "❌"}`);
      console.log(`    todos: ${f.join(", ")}`);
    }
    if (p.igBusinessId) {
      const ig = await get(`/${p.igBusinessId}/subscribed_apps`, p.token);
      console.log(`  IG ${p.igBusinessId} → HTTP ${ig.status} ${JSON.stringify(ig.body).slice(0, 400)}`);
    }
  }

  // Capa de APP (Dashboard → Webhooks): gobierna qué eventos SALEN hacia la
  // callback URL. Es distinta de subscribed_apps (capa de página) y se lee con
  // un app access token `{app-id}|{app-secret}`.
  const APP_ID = "1718579335943082";
  const secrets = new Set<string>();
  for (const c of connectors) {
    if (!c.credentials) continue;
    try {
      const creds = JSON.parse(decryptPII(c.credentials)) as { appSecret?: string };
      if (creds.appSecret) secrets.add(creds.appSecret);
    } catch {
      /* ya reportado arriba */
    }
  }
  const envSecret = process.env.META_DM_APP_SECRET?.trim();
  if (envSecret) secrets.add(envSecret);
  console.log(`\n=== capa de APP ${APP_ID} — ${secrets.size} secret(s) distintos a probar`);
  if (!secrets.size) console.log("  sin appSecret disponible: no se puede leer /subscriptions");
  let i = 0;
  for (const s of secrets) {
    i++;
    const r = await get(`/${APP_ID}/subscriptions`, `${APP_ID}|${s}`);
    if (r.status !== 200) {
      console.log(`  secret#${i} → HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 220)}`);
      continue;
    }
    const objs = (r.body.data ?? []) as Array<{ object?: string; fields?: Array<{ name?: string }>; callback_url?: string; active?: boolean }>;
    for (const o of objs) {
      const names = (o.fields ?? []).map((f) => f.name ?? "?");
      console.log(`  objeto "${o.object}" active=${o.active} url=${o.callback_url}`);
      console.log(`    message_echoes: ${names.includes("message_echoes") ? "✅" : "❌"}   messages: ${names.includes("messages") ? "✅" : "❌"}`);
      console.log(`    campos: ${names.join(", ")}`);
    }
    break; // el primer secret que funciona basta
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
