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
    (async () => {
      try {
        const token = await fetchVoiceToken();
        if (cancelled || !token) return;
        const device = new Device(token, { logLevel: "error" });

        // El token dura 1 h. El SDK avisa ~10 s antes de que venza: se pide uno
        // nuevo y se le pasa al Device sin colgar ni desregistrar.
        device.on("tokenWillExpire", async () => {
          const fresh = await fetchVoiceToken();
          if (fresh) device.updateToken(fresh);
        });
        // Si aun asi vencio (pestana dormida, equipo suspendido), se renueva y se
        // vuelve a registrar. Sin este listener el error salia como "Uncaught".
        device.on("error", async (err: { code?: number; message?: string }) => {
          if (err.code === 20104) {
            const fresh = await fetchVoiceToken();
            if (fresh && !cancelled) {
              device.updateToken(fresh);
              try { await device.register(); } catch { /* se reintenta en el proximo evento */ }
            }
          } else {
            console.warn("[TwilioVoice]", err.code, err.message);
          }
        });
        // "ready" refleja el estado real: sin registro no hay llamadas entrantes y
        // las salientes pueden fallar, asi que el boton Llamar se deshabilita.
        device.on("registered", () => { if (!cancelled) setReady(true); });
        device.on("unregistered", () => { if (!cancelled) setReady(false); });
        device.on("incoming", (call: Call) => {
          callRef.current = call;
          call.on("disconnect", () => { setState("idle"); callRef.current = null; });
          call.accept();
          setState("in-call");
        });
        await device.register();
        deviceRef.current = device;
        if (!cancelled) setReady(true);
      } catch { /* sin Twilio configurado → degrada silencioso */ }
    })();
    return () => { cancelled = true; deviceRef.current?.destroy(); deviceRef.current = null; };
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
