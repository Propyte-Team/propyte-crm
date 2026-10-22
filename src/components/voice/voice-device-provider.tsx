"use client";
import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Device } from "@twilio/voice-sdk";
import type { Call } from "@twilio/voice-sdk";

type CallState = "idle" | "connecting" | "ringing" | "in-call";
interface VoiceCtx {
  ready: boolean;
  state: CallState;
  activeContactId: string | null;
  startCall: (to: string, contactId: string, userId: string) => Promise<void>;
  hangup: () => void;
}
const Ctx = createContext<VoiceCtx | null>(null);
export const useVoice = () => useContext(Ctx);

// Errores de token que se curan pidiendo uno nuevo:
//   20104 AccessTokenExpired — la pestaña durmió más de 1 h.
//   20101 AccessTokenInvalid — con @twilio/voice-sdk < 2.18.5 salía FALSO tras una caída del
//         WebSocket (el SDK reenviaba el registro antes de que el servidor validara el token;
//         ver CHANGELOG 2.18.5). El token de producción se verificó bien formado el 2026-10-22.
const ERRORES_DE_TOKEN = new Set([20104, 20101]);
// Caídas de red transitorias. El SDK ya las imprime en consola y reconecta solo: repetirlas
// con console.warn solo duplicaba cada línea roja con una amarilla.
const ERRORES_DE_RED = new Set([31005, 31009]);
// Tope de renovaciones seguidas: si el token falla de verdad (API key revocada, secret
// equivocado), no se queda pidiendo tokens para siempre.
const MAX_RENOVACIONES = 3;

/** Pide un token de voz nuevo. null = Twilio no configurado o petición fallida. */
async function fetchVoiceToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/twilio/token");
    if (!res.ok) return null;
    const { token } = await res.json();
    return token ?? null;
  } catch {
    return null;
  }
}

export function VoiceDeviceProvider({ userId, children }: { userId?: string; children: React.ReactNode }) {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<CallState>("idle");
  const [activeContactId, setActiveContactId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // El Device vive en el closure del efecto, no solo en deviceRef: antes se asignaba a
    // deviceRef DESPUÉS de `await device.register()`, así que si el registro fallaba o el
    // efecto se limpiaba a medio registro, el cleanup no lo encontraba y el Device quedaba
    // vivo, reconectando y llenando la consola sin que nada lo pudiera destruir.
    let device: Device | null = null;
    let renovaciones = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const renovarYRegistrar = async () => {
      const fresh = await fetchVoiceToken();
      if (cancelled || !device || !fresh) return;
      device.updateToken(fresh);
      try {
        await device.register();
      } catch {
        /* el evento "error" ya lo reportó */
      }
    };

    (async () => {
      const token = await fetchVoiceToken();
      if (cancelled || !token) return; // sin Twilio configurado → degrada silencioso

      device = new Device(token, { logLevel: "error" });
      deviceRef.current = device;

      // El token dura 1 h. El SDK avisa ~10 s antes de que venza: se pide uno
      // nuevo y se le pasa al Device sin colgar ni desregistrar.
      device.on("tokenWillExpire", async () => {
        const fresh = await fetchVoiceToken();
        if (fresh && !cancelled) device?.updateToken(fresh);
      });

      device.on("error", (err: { code?: number; message?: string }) => {
        if (err.code !== undefined && ERRORES_DE_TOKEN.has(err.code)) {
          if (renovaciones >= MAX_RENOVACIONES) {
            console.warn("[TwilioVoice] el token sigue rechazado tras renovarlo; voz deshabilitada", err.code);
            return;
          }
          renovaciones += 1;
          if (timer) clearTimeout(timer);
          // Espera creciente (2 s, 4 s, 6 s) para no reintentar en ráfaga contra una red caída.
          timer = setTimeout(renovarYRegistrar, 2000 * renovaciones);
          return;
        }
        if (err.code !== undefined && ERRORES_DE_RED.has(err.code)) return;
        console.warn("[TwilioVoice]", err.code, err.message);
      });

      // "ready" refleja el estado real: sin registro no hay llamadas entrantes y las salientes
      // pueden fallar, así que el botón Llamar se oculta. Desde voice-sdk 2.18.4, al entrar y
      // salir del back/forward cache el Device emite unregistered → registered: es esperado.
      device.on("registered", () => {
        renovaciones = 0;
        if (!cancelled) setReady(true);
      });
      device.on("unregistered", () => {
        if (!cancelled) setReady(false);
      });
      device.on("incoming", (call: Call) => {
        callRef.current = call;
        call.on("disconnect", () => { setState("idle"); callRef.current = null; });
        call.accept();
        setState("in-call");
      });

      try {
        await device.register();
      } catch {
        /* el evento "error" ya lo reportó y, si es de token, ya programó la renovación */
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      device?.destroy();
      device = null;
      deviceRef.current = null;
      setReady(false);
    };
  }, [userId]);

  const startCall = useCallback(async (to: string, contactId: string, uid: string) => {
    if (!deviceRef.current) return;
    setState("connecting"); setActiveContactId(contactId);
    const call = await deviceRef.current.connect({ params: { To: to, contactId, userId: uid } });
    callRef.current = call;
    call.on("accept", () => setState("in-call"));
    call.on("ringing", () => setState("ringing"));
    call.on("disconnect", () => { setState("idle"); setActiveContactId(null); callRef.current = null; });
    call.on("error", () => { setState("idle"); setActiveContactId(null); });
  }, []);

  const hangup = useCallback(() => { callRef.current?.disconnect(); setState("idle"); setActiveContactId(null); }, []);

  return <Ctx.Provider value={{ ready, state, activeContactId, startCall, hangup }}>{children}</Ctx.Provider>;
}
