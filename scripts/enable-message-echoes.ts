// Activa `message_echoes` en la capa de APP (Dashboard → Webhooks) para los
// objetos que le faltan. La capa de página (subscribed_apps) es OTRA cosa y ya
// está bien: sin las dos, el eco no llega.
//
//   npx tsx --env-file=.env scripts/enable-message-echoes.ts          # dry-run
//   npx tsx --env-file=.env scripts/enable-message-echoes.ts --apply  # escribe
//
// `fields` en POST /{app-id}/subscriptions REEMPLAZA la lista entera: por eso se
// RELEE la actual y se le añade el campo, nunca se manda una lista fija.
// Meta re-verifica la callback URL con el verify_token, así que prod tiene que
// responder el challenge; si el token local no es el de prod, la llamada falla
// sin cambiar nada.
import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "crypto";

const prisma = new PrismaClient();
const GRAPH = "https://graph.facebook.com/v24.0";
const APP_ID = "1718579335943082";
const APPLY = process.argv.includes("--apply");

const TARGETS = [
  { object: "instagram", callback: "https://crm.propyte.com/api/webhooks/meta-dm", tokenEnv: "META_DM_VERIFY_TOKEN" },
  { object: "whatsapp_business_account", callback: "https://crm.propyte.com/api/webhooks/whatsapp/meta", tokenEnv: "META_WA_VERIFY_TOKEN" },
];

function decryptPII(value: string): string {
  const [v, ivB64, tagB64, dataB64] = value.split(":");
  if (v !== "v1") throw new Error("Formato de cifrado desconocido");
  const k = Buffer.from(process.env.KYC_ENCRYPTION_KEY ?? "", "base64");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB64, "base64")), d.final()]).toString("utf8");
}

type Subscription = { object?: string; fields?: Array<{ name?: string }>; callback_url?: string; active?: boolean };

async function readSubs(appToken: string) {
  const res = await fetch(`${GRAPH}/${APP_ID}/subscriptions?access_token=${encodeURIComponent(appToken)}`);
  const body = (await res.json()) as { data?: Subscription[]; error?: unknown };
  if (!res.ok) throw new Error(`GET /subscriptions → ${res.status} ${JSON.stringify(body.error)}`);
  return body.data ?? [];
}

async function main() {
  // Cuál de los appSecret guardados sirve contra ESTA app (hay varios y no todos valen).
  const connectors = await prisma.leadConnector.findMany({ where: { deletedAt: null } });
  const secrets = new Set<string>();
  for (const c of connectors) {
    if (!c.credentials) continue;
    try {
      const s = (JSON.parse(decryptPII(c.credentials)) as { appSecret?: string }).appSecret;
      if (s) secrets.add(s);
    } catch {
      /* conector sin credenciales legibles */
    }
  }
  if (process.env.META_DM_APP_SECRET?.trim()) secrets.add(process.env.META_DM_APP_SECRET.trim());

  let appToken = "";
  let subs: Subscription[] = [];
  for (const s of secrets) {
    try {
      const t = `${APP_ID}|${s}`;
      subs = await readSubs(t);
      appToken = t;
      break;
    } catch {
      /* secret de otra app */
    }
  }
  if (!appToken) throw new Error("Ningún appSecret disponible sirve contra la app " + APP_ID);

  for (const t of TARGETS) {
    const cur = subs.find((s) => s.object === t.object);
    const fields = (cur?.fields ?? []).map((f) => f.name).filter((n): n is string => !!n);
    console.log(`\n=== ${t.object}: ${fields.length} campos actuales`);
    if (fields.includes("message_echoes")) {
      console.log("  ya tiene message_echoes — nada que hacer");
      continue;
    }
    if (cur?.callback_url && cur.callback_url !== t.callback) {
      console.log(`  ⚠ callback en Meta (${cur.callback_url}) != la esperada (${t.callback}) — se respeta la de Meta`);
    }
    const callback = cur?.callback_url ?? t.callback;
    // Sin verify_token se intenta igual: la callback ya está verificada y activa,
    // así que Meta puede aceptar el cambio de campos sin repetir el challenge. Si
    // lo exige, responde error y NO cambia nada — el intento es seguro.
    const verifyToken = process.env[t.tokenEnv]?.trim();
    if (!verifyToken) console.log(`  ⚠ ${t.tokenEnv} no está en este .env — se intenta sin re-verificar`);
    // --noop: reenvía la lista TAL CUAL. Sirve para saber si el "Invalid
    // Permissions" lo causa message_echoes o un campo viejo que la app ya no
    // puede suscribir (el POST es todo-o-nada y manda la lista entera).
    const next = process.argv.includes("--noop") ? fields : [...fields, "message_echoes"];
    console.log(`  → ${next.length} campos (añade message_echoes)`);
    if (!APPLY) {
      console.log("  [dry-run] no se escribe nada; corre con --apply");
      continue;
    }
    // Meta exige callback_url y verify_token juntos o ninguno (#194). Sin el
    // verify_token a mano se mandan solo object+fields: la callback ya registrada
    // se conserva.
    const params = new URLSearchParams({ object: t.object, fields: next.join(","), access_token: appToken });
    if (verifyToken) {
      params.set("callback_url", callback);
      params.set("verify_token", verifyToken);
    }
    const res = await fetch(`${GRAPH}/${APP_ID}/subscriptions`, { method: "POST", body: params });
    const body = await res.json();
    console.log(`  POST → HTTP ${res.status} ${JSON.stringify(body)}`);
  }

  if (APPLY) {
    console.log("\n=== relectura de comprobación");
    for (const s of await readSubs(appToken)) {
      const names = (s.fields ?? []).map((f) => f.name ?? "?");
      console.log(`  ${s.object}: message_echoes ${names.includes("message_echoes") ? "✅" : "❌"} (${names.length} campos)`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
