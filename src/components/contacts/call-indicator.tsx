// Indicador flotante de llamada activa VoIP via Twilio
"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface CallIndicatorProps {
  contactId: string;
  contactName: string;
  contactPhone: string;
  onClose: () => void;
}

export function CallIndicator({
  contactId,
  contactName,
  contactPhone,
  onClose,
}: CallIndicatorProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"connecting" | "ringing" | "active" | "ended">("connecting");
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Iniciar llamada al montar
  useEffect(() => {
    async function startCall() {
      try {
        const res = await fetch("/api/twilio/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId }),
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "Error al iniciar llamada");
        }

        setStatus("ringing");

        // Simular cambio a activa despues de 3s (en produccion viene del webhook)
        setTimeout(() => {
          setStatus("active");
          // Iniciar timer
          timerRef.current = setInterval(() => {
            setDuration((prev) => prev + 1);
          }, 1000);
        }, 3000);
      } catch (error: any) {
        toast({
          title: "Error en llamada",
          description: error.message,
          variant: "destructive",
        });
        setStatus("ended");
        setTimeout(onClose, 2000);
      }
    }

    startCall();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [contactId, onClose, toast]);

  function handleEndCall() {
    if (timerRef.current) clearInterval(timerRef.current);
    setStatus("ended");
    setTimeout(onClose, 1500);
  }

  // Formato mm:ss
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const timeDisplay = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  // Colores por estado
  const statusConfig = {
    connecting: { bg: "bg-yellow-500", text: "Conectando..." },
    ringing: { bg: "bg-blue-500", text: "Sonando..." },
    active: { bg: "bg-green-500", text: timeDisplay },
    ended: { bg: "bg-gray-500", text: "Finalizada" },
  };

  const config = statusConfig[status];

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div
        className={`flex items-center gap-3 rounded-full px-5 py-3 text-white shadow-lg ${config.bg} animate-in slide-in-from-bottom-4`}
      >
        <Phone className="h-4 w-4 animate-pulse" />
        <div className="text-sm">
          <p className="font-medium">{contactName}</p>
          <p className="text-xs opacity-80">{config.text}</p>
        </div>
        {status !== "ended" && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 rounded-full bg-red-600 text-white hover:bg-red-700 hover:text-white h-8 w-8 p-0"
            onClick={handleEndCall}
          >
            <PhoneOff className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
