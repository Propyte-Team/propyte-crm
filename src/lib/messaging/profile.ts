// Perfil del remitente IG/Messenger vía Graph API (best-effort, nunca lanza).
// Se consulta UNA vez por contacto (nuevo o aún "(por identificar)"), no por mensaje.
import prisma from "@/lib/db";
import { getSocialPageToken } from "./social-accounts";
import type { IncomingMessage } from "./types";

const GRAPH = "https://graph.facebook.com/v24.0";
const TIMEOUT_MS = 4000; // llamadas largas → 502 en Hostinger

export interface SocialProfile {
  firstName: string;
  lastName: string | null;
  avatarUrl: string | null;
}

interface GraphProfileResponse {
  first_name?: string;
  last_name?: string;
  name?: string;
  username?: string;
  profile_pic?: string;
  error?: { code?: number; message?: string };
}

/** Perfil público del PSID (Messenger) o IGSID (Instagram) con el page token del conector. */
export async function fetchSocialProfile(
  channel: "MESSENGER" | "INSTAGRAM",
  senderId: string,
  pageToken: string
): Promise<SocialProfile | null> {
  const fields = channel === "MESSENGER" ? "first_name,last_name,profile_pic" : "name,username,profile_pic";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(
        `${GRAPH}/${senderId}?fields=${fields}&access_token=${encodeURIComponent(pageToken)}`,
        { signal: ctrl.signal }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as GraphProfileResponse;
    if (!data || data.error) return null;

    const avatarUrl = data.profile_pic?.trim() || null;

    if (channel === "MESSENGER") {
      const firstName = data.first_name?.trim();
      if (!firstName) return null;
      return { firstName, lastName: data.last_name?.trim() || null, avatarUrl };
    }

    const name = data.name?.trim();
    const username = data.username?.trim();
    if (name) {
      const [first, ...rest] = name.split(/\s+/);
      return {
        firstName: first,
        lastName: rest.join(" ") || (username ? `(@${username})` : null),
        avatarUrl,
      };
    }
    if (username) return { firstName: `@${username}`, lastName: null, avatarUrl };
    return null;
  } catch {
    return null;
  }
}

/** Resuelve conector → token descifrado → perfil. null si el canal no aplica o falta algo. */
export async function fetchProfileForMessage(
  msg: Pick<IncomingMessage, "channel" | "senderId" | "connectorId">
): Promise<SocialProfile | null> {
  if (msg.channel === "WHATSAPP" || !msg.connectorId) return null;
  try {
    const connector = await prisma.leadConnector.findUnique({ where: { id: msg.connectorId } });
    if (!connector) return null;
    const token = getSocialPageToken(connector);
    if (!token) return null;
    return await fetchSocialProfile(msg.channel, msg.senderId, token);
  } catch {
    return null;
  }
}
