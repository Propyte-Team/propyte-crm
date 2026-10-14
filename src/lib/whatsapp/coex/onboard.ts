// Alta de un número de WhatsApp Business (app) en coexistencia — 2026-10-14.
// Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §5.
//
// Un solo orquestador para el número de una marca (Conexiones) y, desde el PR 2, el de un asesor
// (Mi Perfil). El orden no es libre:
//   1. canjear el código PRIMERO: vive 30 s (doc de Implementation);
//   2. saber qué número es (el evento de fin de coexistencia puede traer solo el WABA);
//   3. conflictos ANTES de escribir nada;
//   4. suscribir la app a la WABA: sin eso no llega ni un webhook;
//   5. crear o actualizar la cuenta ANTES de pedir el historial, porque sus webhooks pueden
//      llegar en segundos y tienen que encontrar la cuenta;
//   6. pedir contactos y luego historial (cada uno se puede pedir UNA vez por conexión, y hay
//      24 h desde el alta; repetir el flujo no los vuelve a pedir salvo que hayan fallado o que
//      el negocio se haya desconectado entre medias).
// El registro del número (`/register`) se omite a propósito: la doc de coexistencia dice que el
// número ya está registrado.
//
// Nunca sale el token: ni en la respuesta, ni en un log, ni en un mensaje de error (se limpian
// en graph.ts). Los logs llevan códigos y tipos, no cuerpos.
import prisma from "@/lib/db";
import type { ConnectorScope, ConnectorStatus, Prisma } from "@prisma/client";
import { readCredentials, writeCredentials } from "@/lib/intake/connectors";
import {
  exchangeCodeForToken,
  fetchPhoneNumber,
  listWabaPhoneNumbers,
  requestSmbAppData,
  subscribeAppToWaba,
  type GraphDeps,
  type GraphFailure,
  type PhoneNumberInfo,
} from "./graph";
import { metaAppCredentials, ENV_APP_ID, ENV_APP_SECRET } from "./public-config";
import { readCoexState, type CoexState } from "./status";
import { mergeCoexState } from "./state";

export interface OnboardInput {
  code: string;
  wabaId: string;
  phoneNumberId?: string | null;
  scope: ConnectorScope;
  /** Solo BRAND. `undefined` = no tocar la marca de una cuenta que ya existía. */
  brandId?: string | null;
  /** Nombre propuesto; si no, se arma con el nombre verificado del número. */
  name?: string | null;
  /** Quién hizo el alta (auditoría). */
  actorUserId: string;
}

export type SyncOutcome =
  | { status: "requested" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export type OnboardResult =
  | {
      ok: true;
      created: boolean;
      connector: { id: string; name: string; status: ConnectorStatus };
      number: { phoneNumberId: string; wabaId: string; displayPhone: string; verifiedName: string };
      subscription: { ok: true } | { ok: false; error: string };
      sync: { contacts: SyncOutcome; history: SyncOutcome };
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): OnboardResult => ({ ok: false, status, error });

/** Fallo de Graph → respuesta HTTP: «graph» es culpa de los datos (400), «network» de la red (502). */
function fromGraph(f: GraphFailure, prefix: string): OnboardResult {
  return fail(f.kind === "graph" ? 400 : 502, `${prefix}: ${f.error}`);
}

/**
 * El número a conectar. Con `phone_number_id` se usa ese; sin él (el ejemplo del evento de
 * coexistencia solo trae `waba_id`) se busca en la WABA: el único, o el único que sigue en la app.
 */
async function resolveNumber(
  wabaId: string,
  phoneNumberId: string | null | undefined,
  token: string,
  deps: GraphDeps,
): Promise<{ ok: true; info: PhoneNumberInfo } | OnboardResult> {
  if (phoneNumberId) {
    const r = await fetchPhoneNumber(phoneNumberId, token, deps);
    return r.ok ? r : fromGraph(r, "Meta no dejó leer el número");
  }
  const list = await listWabaPhoneNumbers(wabaId, token, deps);
  if (!list.ok) return fromGraph(list, "Meta no dejó leer los números de la cuenta de WhatsApp");
  if (list.numbers.length === 0) return fail(400, "La cuenta de WhatsApp que se conectó no tiene ningún número.");
  const detailed: PhoneNumberInfo[] = [];
  for (const n of list.numbers.slice(0, 10)) {
    const r = await fetchPhoneNumber(n.id, token, deps);
    detailed.push(r.ok ? r.info : n);
  }
  if (detailed.length === 1) return { ok: true, info: detailed[0] };
  const onApp = detailed.filter((n) => n.isOnBizApp === true);
  if (onApp.length === 1) return { ok: true, info: onApp[0] };
  return fail(
    409,
    `La cuenta de WhatsApp tiene ${detailed.length} números y no se pudo saber cuál se conectó ` +
      `(${detailed.map((n) => n.displayPhoneNumber || n.id).join(", ")}). Vuelve a intentarlo; si se repite, avisa a soporte.`,
  );
}

type ExistingConnector = {
  id: string;
  name: string;
  scope: ConnectorScope;
  status: ConnectorStatus;
  brandId: string | null;
  config: Prisma.JsonValue;
  credentials: string | null;
};

const SCOPE_LABEL: Record<ConnectorScope, string> = { BRAND: "de una marca", ADVISOR: "de un asesor" };

/** ¿Choca con una cuenta que ya existe? Mismo número con otro alcance = no se toca nada. */
function conflictWith(existing: ExistingConnector, input: OnboardInput, display: string): OnboardResult | null {
  if (existing.scope !== input.scope) {
    return fail(
      409,
      `El número ${display} ya está conectado en el CRM como número ${SCOPE_LABEL[existing.scope]} («${existing.name}»). ` +
        "Para cambiarlo, primero hay que quitar esa conexión.",
    );
  }
  return null;
}

function defaultName(info: PhoneNumberInfo): string {
  const who = info.verifiedName || info.displayPhoneNumber || info.id;
  return `WhatsApp · ${who}`.slice(0, 120);
}

/** ¿Hay que (volver a) pedir esta sincronización? Solo si nunca se pidió en esta conexión o falló. */
function needsSync(prev: CoexState | null, key: "contactsSync" | "historySync"): boolean {
  if (!prev || prev.accountState !== "CONNECTED") return true; // conexión nueva o tras desconectarse
  const s = prev[key];
  return !s || s.state === "FAILED";
}

export async function onboardCoexistenceNumber(input: OnboardInput, deps: GraphDeps = {}): Promise<OnboardResult> {
  const app = metaAppCredentials();
  if (!app) {
    return fail(503, `Falta configurar ${ENV_APP_ID} y/o ${ENV_APP_SECRET} en el servidor (ver docs/whatsapp-coexistencia-meta-setup.md).`);
  }

  // 1. El código caduca en 30 s: va antes que todo lo demás.
  const exchange = await exchangeCodeForToken({ code: input.code, appId: app.appId, appSecret: app.appSecret }, deps);
  if (!exchange.ok) {
    console.warn(`[whatsapp-coex] canje del código rechazado (${exchange.kind}${exchange.code ? ` ${exchange.code}` : ""})`);
    return exchange.kind === "graph"
      ? fail(400, `Meta no aceptó el código de autorización (caduca a los 30 segundos). Vuelve a conectar. Detalle: ${exchange.error}`)
      : fail(502, `No se pudo canjear el código con Meta: ${exchange.error}`);
  }
  const token = exchange.accessToken;

  // 2. Qué número es.
  const resolved = await resolveNumber(input.wabaId, input.phoneNumberId, token, deps);
  if (!("info" in resolved)) return resolved;
  const info = resolved.info;
  const display = info.displayPhoneNumber || info.id;
  const warnings: string[] = [];
  if (info.isOnBizApp === false) {
    warnings.push("Meta dice que este número ya no está en la app de WhatsApp Business: se conectó como número de API.");
  }

  // 3. Conflictos antes de escribir.
  const existing = (await prisma.leadConnector.findFirst({
    where: { provider: "WHATSAPP", deletedAt: null, config: { path: ["phoneNumberId"], equals: info.id } },
    select: { id: true, name: true, scope: true, status: true, brandId: true, config: true, credentials: true },
  })) as ExistingConnector | null;
  if (existing) {
    const conflict = conflictWith(existing, input, display);
    if (conflict) return conflict;
  }

  // 4. Suscripción de la app a la WABA.
  const sub = await subscribeAppToWaba(input.wabaId, token, deps);
  if (!sub.ok) console.warn(`[whatsapp-coex] suscripción a la WABA rechazada (${sub.kind}${sub.code ? ` ${sub.code}` : ""})`);

  // 5. Crear o actualizar la cuenta. Sin suscripción se guarda igual (para no perder el token
  //    ni el alta), pero en ERROR y sin pedir sincronizaciones: sus webhooks no llegarían y cada
  //    sincronización solo se puede pedir una vez.
  const prev = existing ? readCoexState(existing.config) : null;
  const now = new Date().toISOString();
  const baseConfig =
    existing && typeof existing.config === "object" && existing.config !== null && !Array.isArray(existing.config)
      ? (existing.config as Record<string, unknown>)
      : {};
  const reconnect = !prev || prev.accountState !== "CONNECTED";
  const coex: CoexState = {
    ...(reconnect ? {} : prev),
    connectedAt: reconnect ? now : prev?.connectedAt ?? now,
    accountState: "CONNECTED",
    accountEventAt: now,
    disconnection: null,
    subscribed: sub.ok,
    ...(info.isOnBizApp !== undefined ? { isOnBizApp: info.isOnBizApp } : {}),
    ...(info.platformType ? { platformType: info.platformType } : {}),
  };
  const config = {
    ...baseConfig,
    phoneNumberId: info.id,
    wabaId: input.wabaId,
    displayPhone: info.displayPhoneNumber || (baseConfig.displayPhone as string | undefined) || "",
    verifiedName: info.verifiedName,
    onboarding: "coexistence",
    coex,
  };
  const prevCreds = existing ? readCredentials<Record<string, unknown>>(existing as never) ?? {} : {};
  const credentials = writeCredentials({ ...prevCreds, accessToken: token });
  const status: ConnectorStatus = sub.ok ? "ACTIVE" : "ERROR";
  const lastError = sub.ok
    ? null
    : `No se pudo suscribir la app a la cuenta de WhatsApp (${sub.error}). Vuelve a conectar el número.`;

  let connector: { id: string; name: string; status: ConnectorStatus };
  let created = false;
  try {
    if (existing) {
      connector = await prisma.leadConnector.update({
        where: { id: existing.id },
        data: {
          status,
          lastError,
          errorCount: sub.ok ? 0 : { increment: 1 },
          credentials,
          config: config as unknown as Prisma.InputJsonValue,
          ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
          ...(input.name ? { name: input.name.slice(0, 120) } : {}),
        },
        select: { id: true, name: true, status: true },
      });
    } else {
      connector = await prisma.leadConnector.create({
        data: {
          name: (input.name || defaultName(info)).slice(0, 120),
          provider: "WHATSAPP",
          scope: input.scope,
          status,
          lastError,
          credentials,
          config: config as unknown as Prisma.InputJsonValue,
          fieldMap: {} as Prisma.InputJsonValue,
          ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
        },
        select: { id: true, name: true, status: true },
      });
      created = true;
    }
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    // Índice único del número (migración 2026-10-14): otra alta del mismo número ganó la carrera.
    if (code === "P2002") {
      return fail(409, `El número ${display} se acaba de conectar desde otra ventana. Recarga la página para verlo.`);
    }
    console.error("[whatsapp-coex] no se pudo guardar la cuenta:", code ?? "sin código");
    return fail(500, "No se pudo guardar la cuenta de WhatsApp en el CRM.");
  }

  // 6. Sincronizaciones. El estado REQUESTED se escribe ANTES de pedir: los webhooks del
  //    historial pueden llegar antes de que esta petición vuelva, y su IN_PROGRESS no debe quedar
  //    pisado por un REQUESTED tardío. El request_id va en su propia clave por lo mismo.
  const sync: { contacts: SyncOutcome; history: SyncOutcome } = {
    contacts: { status: "skipped", reason: "sin suscripción a webhooks" },
    history: { status: "skipped", reason: "sin suscripción a webhooks" },
  };
  if (sub.ok) {
    for (const [key, type, out] of [
      ["contactsSync", "smb_app_state_sync", "contacts"],
      ["historySync", "history", "history"],
    ] as const) {
      if (!needsSync(prev, key)) {
        sync[out] = { status: "skipped", reason: "ya se pidió en esta conexión" };
        continue;
      }
      try {
        await mergeCoexState(connector.id, { [key]: { state: "REQUESTED", at: new Date().toISOString() } });
        const r = await requestSmbAppData(info.id, token, type, deps);
        if (r.ok) {
          await mergeCoexState(connector.id, { [`${key}RequestId`]: r.requestId } as Partial<CoexState>);
          sync[out] = { status: "requested" };
        } else {
          console.warn(`[whatsapp-coex] sincronización ${type} rechazada (${r.kind}${r.code ? ` ${r.code}` : ""})`);
          await mergeCoexState(connector.id, { [key]: { state: "FAILED", at: new Date().toISOString(), error: r.error } });
          sync[out] = { status: "failed", error: r.error };
        }
      } catch (err) {
        console.error(`[whatsapp-coex] estado de sincronización ${type} no guardado:`, (err as { code?: string } | null)?.code ?? "error");
        sync[out] = { status: "failed", error: "No se pudo guardar el estado de la sincronización." };
      }
    }
  }

  await prisma.auditLog
    .create({
      data: {
        userId: input.actorUserId,
        action: created ? "CREATE" : "UPDATE",
        entity: "LeadConnector",
        entityId: connector.id,
        changes: {
          name: connector.name,
          provider: "WHATSAPP",
          scope: input.scope,
          phoneNumberId: info.id,
          wabaId: input.wabaId,
          via: "whatsapp-coex",
        },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    created,
    connector,
    number: { phoneNumberId: info.id, wabaId: input.wabaId, displayPhone: display, verifiedName: info.verifiedName },
    subscription: sub.ok ? { ok: true } : { ok: false, error: sub.error },
    sync,
    warnings,
  };
}
