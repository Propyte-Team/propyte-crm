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
        const res = await fetch("/api/twilio/token");
        if (!res.ok) return;
        const { token } = await res.json();
        if (cancelled || !token) return;
        const device = new Device(token, { logLevel: "error" });
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
