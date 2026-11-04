// Tab de configuracion del bot: estado y canales, estilo de conversacion, cuando contesta solo y, plegado en "Avanzado", arranque, modelo y cifras
"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { TONE_PRESETS } from "@/lib/bot/tone-presets";
import { updateBotConfig } from "@/server/bot-config";
import { AUTONOMY_LABELS } from "@/lib/labels";
import { BOT_CHANNELS, toggleBotChannel } from "./bot-channels";
import type { BotTonePreset } from "@prisma/client";

export interface BotConfigData {
  botEnabled: boolean;
  tonePreset: BotTonePreset;
  autonomyLevel: "L0" | "L1" | "L2";
  model: string;
  openerStyle: "WARM_NAME" | "DIRECT";
  maxLines: number;
  dataGateStrict: boolean;
  escalationTriggers: string[];
  enabledChannels: string[];
}

const TONE_KEYS = Object.keys(TONE_PRESETS) as BotTonePreset[];

export function BotConfigTab({ initial }: { initial: BotConfigData }) {
  const [cfg, setCfg] = useState<BotConfigData>(initial);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const preset = TONE_PRESETS[cfg.tonePreset];

  function save() {
    startTransition(async () => {
      try {
        await updateBotConfig({
          botEnabled: cfg.botEnabled,
          tonePreset: cfg.tonePreset,
          autonomyLevel: cfg.autonomyLevel,
          model: cfg.model as any,
          openerStyle: cfg.openerStyle,
          maxLines: cfg.maxLines,
          dataGateStrict: cfg.dataGateStrict,
          escalationTriggers: cfg.escalationTriggers,
          enabledChannels: cfg.enabledChannels as any,
        });
        toast({ title: "Configuración del bot guardada" });
      } catch (error: any) {
        toast({
          title: "No se pudo guardar la configuración del bot",
          description: error?.message || "Intenta de nuevo; si sigue fallando, avisa a sistemas.",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estado</CardTitle>
          <CardDescription>Enciende o apaga el bot y elige en qué canales contesta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfg.botEnabled}
              onChange={(e) => setCfg({ ...cfg, botEnabled: e.target.checked })}
            />
            <span>Bot activo</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Apagado: nadie contesta solo en las cuentas sin marca. Las marcas con agente encendido siguen contestando.
          </p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Canales en que contesta</legend>
            <div className="flex flex-wrap gap-4">
              {BOT_CHANNELS.map((ch) => (
                <label key={ch.value} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cfg.enabledChannels.includes(ch.value)}
                    onChange={(e) =>
                      setCfg({ ...cfg, enabledChannels: toggleBotChannel(cfg.enabledChannels, ch.value, e.target.checked) })
                    }
                  />
                  <span>{ch.label}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Aplica a todas las cuentas sin marca. Las marcas con canales propios (Marcas del agente) no cambian.
            </p>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estilo de conversación</CardTitle>
          <CardDescription>
            Cómo suena el bot al escribir. Las marcas y los agentes que tienen su propio estilo no cambian.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Estilo</Label>
            <Select
              value={cfg.tonePreset}
              onValueChange={(v) => setCfg({ ...cfg, tonePreset: v as BotTonePreset })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TONE_PRESETS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border p-3 text-sm space-y-2 bg-muted/30">
            <p className="text-muted-foreground">{preset.description}</p>
            <div className="space-y-1">
              {preset.fewShot.slice(0, 4).map((ex, i) => (
                <p key={i}>
                  <span className="font-medium">{ex.role === "user" ? "Cliente" : "Sage"}:</span> {ex.content}
                </p>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cuándo contesta solo</CardTitle>
          <CardDescription>Define si el bot responde por su cuenta o espera a que un asesor lo apruebe.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nivel de autonomía</Label>
            <Select
              value={cfg.autonomyLevel}
              onValueChange={(v) => setCfg({ ...cfg, autonomyLevel: v as BotConfigData["autonomyLevel"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["L0", "L1", "L2"] as const).map((lvl) => (
                  <SelectItem key={lvl} value={lvl}>
                    {AUTONOMY_LABELS[lvl]} <span className="text-[10px] text-muted-foreground">({lvl})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Longitud máxima de cada respuesta (líneas)</Label>
            <Input
              type="number"
              min={1}
              max={8}
              value={cfg.maxLines}
              onChange={(e) => setCfg({ ...cfg, maxLines: Number(e.target.value) })}
            />
          </div>
        </CardContent>
      </Card>

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer select-none px-6 py-4 text-lg font-semibold">
          Avanzado
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Ajustes técnicos; normalmente no hace falta tocarlos
          </span>
        </summary>
        <div className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <Label>Cómo saluda al empezar</Label>
            <Select
              value={cfg.openerStyle}
              onValueChange={(v) => setCfg({ ...cfg, openerStyle: v as BotConfigData["openerStyle"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WARM_NAME">Cálido con nombre</SelectItem>
                <SelectItem value="DIRECT">Directo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfg.dataGateStrict}
              onChange={(e) => setCfg({ ...cfg, dataGateStrict: e.target.checked })}
            />
            <span>No inventar cifras ni precios (recomendado)</span>
          </label>
          <div className="space-y-2">
            <Label>Modelo de inteligencia artificial</Label>
            <Select value={cfg.model} onValueChange={(v) => setCfg({ ...cfg, model: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-sonnet-5-5">Claude Sonnet 5.5 (recomendado)</SelectItem>
                <SelectItem value="claude-sonnet-5">Claude Sonnet 5</SelectItem>
                <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (más barato)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Cambia el costo y la calidad de las respuestas. Déjalo en el recomendado salvo indicación de sistemas.</p>
          </div>
        </div>
      </details>

      <Button onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar configuración"}
      </Button>
    </div>
  );
}
