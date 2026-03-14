// Panel de conversacion con un contacto — SMS y WhatsApp via Twilio
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, MessageSquare, Phone, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface Message {
  id: string;
  channel: "WHATSAPP" | "SMS";
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: string;
  templateName: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

interface ConversationPanelProps {
  contactId: string;
  contactName: string;
  contactPhone: string;
}

export function ConversationPanel({
  contactId,
  contactName,
  contactPhone,
}: ConversationPanelProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Cargar mensajes
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages?contactId=${contactId}&limit=100`);
      if (!res.ok) throw new Error("Error cargando mensajes");
      const data = await res.json();
      setMessages(data.messages.reverse()); // Mas recientes al final
    } catch {
      // Silenciar errores de polling
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchMessages();
    // Poll cada 10s para mensajes nuevos
    const interval = setInterval(fetchMessages, 10000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Auto-scroll al fondo cuando llegan mensajes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!messageText.trim()) return;

    setSending(true);
    try {
      const endpoint = channel === "whatsapp" ? "/api/twilio/whatsapp" : "/api/twilio/sms";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, body: messageText }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Error al enviar");
      }

      setMessageText("");
      // Recargar mensajes inmediatamente
      await fetchMessages();
    } catch (error: any) {
      toast({
        title: "Error al enviar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  // Formato de hora
  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  }

  // Agrupar mensajes por fecha
  const groupedMessages: { date: string; messages: Message[] }[] = [];
  let currentDate = "";
  for (const msg of messages) {
    const date = formatDate(msg.createdAt);
    if (date !== currentDate) {
      currentDate = date;
      groupedMessages.push({ date, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  }

  // Color del badge de canal
  const channelColors: Record<string, string> = {
    WHATSAPP: "bg-green-100 text-green-700",
    SMS: "bg-blue-100 text-blue-700",
  };

  // Color del badge de estado
  const statusColors: Record<string, string> = {
    QUEUED: "bg-gray-100 text-gray-600",
    SENT: "bg-blue-100 text-blue-600",
    DELIVERED: "bg-green-100 text-green-600",
    READ: "bg-green-200 text-green-700",
    FAILED: "bg-red-100 text-red-600",
  };

  return (
    <div className="flex h-[500px] flex-col rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="font-semibold">{contactName}</h3>
          <p className="text-xs text-muted-foreground">{contactPhone}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchMessages}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loading && (
          <p className="text-center text-sm text-muted-foreground">
            Cargando mensajes...
          </p>
        )}

        {!loading && messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            No hay mensajes con este contacto
          </p>
        )}

        {groupedMessages.map((group) => (
          <div key={group.date}>
            {/* Separador de fecha */}
            <div className="flex items-center gap-2 my-3">
              <div className="flex-1 border-t" />
              <span className="text-xs text-muted-foreground">{group.date}</span>
              <div className="flex-1 border-t" />
            </div>

            {/* Mensajes del dia */}
            {group.messages.map((msg) => (
              <div
                key={msg.id}
                className={`mb-2 flex ${
                  msg.direction === "OUTBOUND" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 ${
                    msg.direction === "OUTBOUND"
                      ? "bg-[#1E3A5F] text-white"
                      : "bg-muted"
                  }`}
                >
                  {/* Badge de canal */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium ${
                        channelColors[msg.channel]
                      }`}
                    >
                      {msg.channel === "WHATSAPP" ? (
                        <MessageSquare className="mr-0.5 h-2.5 w-2.5" />
                      ) : (
                        <Phone className="mr-0.5 h-2.5 w-2.5" />
                      )}
                      {msg.channel}
                    </span>
                    {msg.templateName && (
                      <span className="text-[10px] opacity-70">
                        Template: {msg.templateName}
                      </span>
                    )}
                  </div>

                  {/* Cuerpo del mensaje */}
                  <p className="text-sm whitespace-pre-wrap">{msg.body}</p>

                  {/* Hora y estado */}
                  <div className="mt-1 flex items-center justify-end gap-1.5">
                    <span
                      className={`text-[10px] ${
                        msg.direction === "OUTBOUND"
                          ? "text-white/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {formatTime(msg.createdAt)}
                    </span>
                    {msg.direction === "OUTBOUND" && (
                      <span
                        className={`inline-flex rounded px-1 py-0.5 text-[9px] font-medium ${
                          statusColors[msg.status] || ""
                        }`}
                      >
                        {msg.status}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input de mensaje */}
      <div className="border-t px-4 py-3">
        <div className="flex gap-2">
          <Select
            value={channel}
            onValueChange={(v) => setChannel(v as "whatsapp" | "sms")}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Escribe un mensaje..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={sending}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={sending || !messageText.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
