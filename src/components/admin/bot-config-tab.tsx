// Tab de configuracion del bot: tono, autonomia, arranque, modelo y data-gate
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
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estado</CardTitle>
          <CardDescription>Enciende o apaga el bot globalmente.</CardDescription>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tono</CardTitle>
          <CardDescription>Elige el registro de voz. Las reglas de marca no cambian.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Preset</Label>
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
          <CardTitle className="text-lg">Comportamiento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Autonomía</Label>
            <Select
              value={cfg.autonomyLevel}
              onValueChange={(v) => setCfg({ ...cfg, autonomyLevel: v as BotConfigData["autonomyLevel"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="L0">L0 — sólo sugiere</SelectItem>
                <SelectItem value="L1">L1 — envío con aprobación</SelectItem>
                <SelectItem value="L2">L2 — autónomo con red</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Arranque</Label>
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
          <div className="space-y-2">
            <Label>Longitud máxima (líneas)</Label>
            <Input
              type="number"
              min={1}
              max={8}
              value={cfg.maxLines}
              onChange={(e) => setCfg({ ...cfg, maxLines: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfg.dataGateStrict}
              onChange={(e) => setCfg({ ...cfg, dataGateStrict: e.target.checked })}
            />
            <span>Data-gate estricto (no inventar cifras)</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Modelo</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={cfg.model} onValueChange={(v) => setCfg({ ...cfg, model: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-sonnet-5">Claude Sonnet 5 (recomendado)</SelectItem>
              <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
              <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (más barato)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar configuración"}
      </Button>
    </div>
  );
}
