"use client";
import { Phone, PhoneOff } from "lucide-react";
import { useVoice } from "./voice-device-provider";

export function CallButton({
  phone,
  contactId,
  userId,
  doNotContact,
}: {
  phone: string;
  contactId: string;
  userId: string;
  doNotContact?: boolean;
}) {
  const voice = useVoice();
  if (!voice?.ready) return null;
  const busy = voice.state !== "idle" && voice.activeContactId === contactId;
  if (doNotContact) {
    return (
      <button className="btn-secondary text-[13px]" disabled title="Contacto marcado No contactar">
        <Phone className="h-3.5 w-3.5" /> Llamar
      </button>
    );
  }
  if (busy) {
    return (
      <button className="btn-secondary text-[13px]" onClick={() => voice.hangup()}>
        <PhoneOff className="h-3.5 w-3.5" /> {voice.state === "in-call" ? "Colgar" : "Cancelar"}
      </button>
    );
  }
  return (
    <button className="btn-secondary text-[13px]" onClick={() => voice.startCall(phone, contactId, userId)}>
      <Phone className="h-3.5 w-3.5" /> Llamar
    </button>
  );
}
