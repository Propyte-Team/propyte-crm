// Resumen "¿Quién contesta?": tabla corta, arriba de las pestañas Bot, Agentes y Marcas, que dice
// por cada cuenta conectada qué estilo, guion y autonomía aplican y de dónde vienen (marca ->
// agente por tipo de contacto -> general). Hace su propio fetch a /api/admin/bot/resumen para no
// depender de admin-content; la precedencia se calcula con la función pura de src/lib/bot.
"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBotGeneral } from "./use-bot-general";
import { providerById } from "@/lib/connectors/registry";
import {
  resolverQuienContesta,
  type AgenteLite,
  type BotConfigLite,
  type FilaQuienContesta,
} from "@/lib/bot/quien-contesta";

interface Props {
  /** Valores en pantalla de la pestaña que lo monta (si aún no se guardan), para que el resumen los refleje. */
  botConfig?: Partial<BotConfigLite>;
  agentes?: AgenteLite[];
}

function Fila({ f, primera }: { f: FilaQuienContesta; primera?: string }) {
  return (
    <tr className="border-t align-top">
      <td className="py-2 pr-3">
        <div className="font-medium">{f.cuenta}</div>
        {primera && <div className="text-[11px] text-muted-foreground">{primera}</div>}
      </td>
      <td className="py-2 pr-3">{f.marca}</td>
      <td className="py-2 pr-3">
        {f.contesta}
        {!f.contestaSolo && (
          <Badge variant="outline" className="ml-1.5">
            sin bot
          </Badge>
        )}
      </td>
      <td className="py-2 pr-3">{f.estilo.etiqueta}</td>
      <td className="py-2 pr-3">{f.guion.etiqueta}</td>
      <td className="py-2 pr-3">{f.autonomia.etiqueta}</td>
      <td className="py-2 text-muted-foreground">{f.origen}</td>
    </tr>
  );
}

export function BotResumen({ botConfig, agentes }: Props) {
  const { datos, cargando, error, recargar: cargar } = useBotGeneral();

  const resultado = useMemo(() => {
    if (!datos) return null;
    return resolverQuienContesta({
      botConfig: { ...datos.botConfig, ...botConfig },
      agentes: agentes ?? datos.agentes,
      marcas: datos.marcas,
      cuentas: datos.cuentas,
      playbooks: datos.playbooks,
    });
  }, [datos, botConfig, agentes]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">¿Quién contesta?</CardTitle>
          <CardDescription>
            Por cada cuenta: manda primero la marca; si no tiene marca, el agente del tipo de contacto; y si
            tampoco, la configuración general. Si cambias algo abajo, guarda y pulsa «Actualizar».
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="shrink-0">
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Actualizar
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto text-[13px]">
        {cargando && !datos && <p className="py-2 text-muted-foreground">Cargando…</p>}
        {error && <p className="py-2 text-destructive">{error}</p>}
        {resultado && resultado.cuentas.length === 0 && (
          <p className="py-2 text-muted-foreground">
            Aún no hay cuentas de WhatsApp, Instagram o Messenger conectadas (se conectan en Conexiones).
          </p>
        )}
        {resultado && (resultado.cuentas.length > 0 || resultado.porTipo.length > 0) && (
          <table className="w-full min-w-[760px] text-left">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-1 pr-3 font-medium">Cuenta</th>
                <th className="pb-1 pr-3 font-medium">Marca</th>
                <th className="pb-1 pr-3 font-medium">Quién contesta</th>
                <th className="pb-1 pr-3 font-medium">Estilo</th>
                <th className="pb-1 pr-3 font-medium">Guion</th>
                <th className="pb-1 pr-3 font-medium">Autonomía</th>
                <th className="pb-1 font-medium">Origen</th>
              </tr>
            </thead>
            <tbody>
              {resultado.cuentas.map((f) => {
                const c = datos?.cuentas.find((x) => x.id === f.cuentaId);
                return <Fila key={f.cuentaId} f={f} primera={c?.provider ? providerById(c.provider)?.label ?? c.provider : undefined} />;
              })}
              {resultado.porTipo.length > 0 && (
                <tr className="border-t">
                  <td colSpan={7} className="pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    En las cuentas sin marca, según el tipo de contacto
                  </td>
                </tr>
              )}
              {resultado.porTipo.map((f, i) => (
                <Fila key={`t-${i}`} f={f} />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
