// Panel "Probar con un mensaje" de la pestaña Bot: escribe como si fueras un cliente y mira qué
// contestaría el bot con la configuración elegida. No envía nada ni guarda mensajes ni contactos
// (POST /api/admin/bot/probar). Misma idea que el probador de Comentarios.
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { leerError } from "@/lib/api-errors";
import { useBotGeneral } from "./use-bot-general";

interface Turno {
  role: "user" | "assistant";
  content: string;
  escalaria?: boolean;
}

export interface OverridesProbador {
  tonePreset?: string;
  maxLines?: number;
  openerStyle?: string;
  dataGateStrict?: boolean;
  escalationTriggers?: string[];
}

const GENERAL = "general";

export function BotProbador({ overrides }: { overrides?: OverridesProbador }) {
  const { datos } = useBotGeneral();
  // "general" | "brand:<id>" | "agent:<id>"
  const [contexto, setContexto] = useState(GENERAL);
  const [mensaje, setMensaje] = useState("");
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [origen, setOrigen] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const marcas = (datos?.marcas ?? []).filter((m) => !m.isDefault);
  const agentes = (datos?.agentes ?? []).filter((a) => a.isActive);

  function cambiarContexto(v: string) {
    setContexto(v);
    setTurnos([]); // otra configuración = otra conversación
    setOrigen("");
    setError("");
  }

  async function enviar() {
    const texto = mensaje.trim();
    if (!texto || cargando) return;
    setCargando(true);
    setError("");
    const previos = turnos.map(({ role, content }) => ({ role, content }));
    try {
      const res = await fetch("/api/admin/bot/probar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: texto,
          history: previos,
          brandId: contexto.startsWith("brand:") ? contexto.slice(6) : undefined,
          agentId: contexto.startsWith("agent:") ? contexto.slice(6) : undefined,
          overrides: contexto === GENERAL ? overrides : undefined,
        }),
      });
      if (!res.ok) {
        setError(await leerError(res, "No se pudo probar el bot"));
        return;
      }
      const data = await res.json();
      setTurnos([...turnos, { role: "user", content: texto }, { role: "assistant", content: data.respuesta, escalaria: data.escalaria }]);
      setOrigen(data.origen ?? "");
      setMensaje("");
    } catch {
      setError("No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Probar con un mensaje</CardTitle>
        <CardDescription>
          Escribe como si fueras un cliente y mira qué contestaría el bot. No envía nada ni guarda mensajes ni
          contactos. En la prueba el bot no tiene el catálogo de desarrollos, así que no cita precios. Con el
          contexto «Configuración general» usa lo que ves en pantalla aunque no lo hayas guardado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="probador-contexto">Probar como</Label>
          <select
            id="probador-contexto"
            className="form-input w-full max-w-sm !py-1.5 text-[13px]"
            value={contexto}
            onChange={(e) => cambiarContexto(e.target.value)}
          >
            <option value={GENERAL}>Configuración general (cuentas sin marca)</option>
            {marcas.map((m) => (
              <option key={m.id} value={`brand:${m.id}`}>Marca: {m.name}</option>
            ))}
            {agentes.map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>Agente: {a.name}</option>
            ))}
          </select>
          {contexto !== GENERAL && (
            <p className="text-xs text-muted-foreground">Usa lo ya guardado de esa marca o agente.</p>
          )}
        </div>

        {turnos.length > 0 && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            {turnos.map((t, i) => (
              <div key={i} className={t.role === "user" ? "text-right" : ""}>
                <span
                  className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-left ${
                    t.role === "user" ? "bg-primary text-primary-foreground" : "bg-background border"
                  }`}
                >
                  {t.content}
                </span>
                {t.escalaria && (
                  <div className="mt-1">
                    <Badge variant="outline">Aquí pasaría a un asesor</Badge>
                  </div>
                )}
              </div>
            ))}
            {origen && <p className="text-[11px] text-muted-foreground">Contestó: {origen}</p>}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Input
            value={mensaje}
            maxLength={1000}
            placeholder="Ej. Hola, busco un departamento en Tulum"
            aria-label="Mensaje de prueba"
            onChange={(e) => setMensaje(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                enviar();
              }
            }}
          />
          <Button onClick={enviar} disabled={cargando || !mensaje.trim()}>
            {cargando ? "Pensando…" : "Probar"}
          </Button>
          {turnos.length > 0 && (
            <Button variant="outline" onClick={() => { setTurnos([]); setOrigen(""); }}>
              Nueva conversación
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
