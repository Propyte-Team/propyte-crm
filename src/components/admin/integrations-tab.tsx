// Tab de integraciones: webhooks salientes y API keys
"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Copy, RefreshCw } from "lucide-react";
import {
  createWebhookConfig,
  updateWebhookConfig,
  deleteWebhookConfig,
  regenerateWebhookSecret,
  generateNewApiKey,
  revokeApiKey,
} from "@/server/admin";
import Link from "next/link";
import { useToast } from "@/components/ui/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

// Eventos disponibles para webhooks
const WEBHOOK_EVENTS = [
  { value: "contact.created", label: "Contacto creado" },
  { value: "contact.updated", label: "Contacto actualizado" },
  { value: "deal.created", label: "Oportunidad creada" },
  { value: "deal.stage_changed", label: "Oportunidad cambió de etapa" },
  { value: "deal.won", label: "Oportunidad ganada" },
  { value: "deal.lost", label: "Oportunidad perdida" },
  { value: "deal.updated", label: "Oportunidad actualizada" },
  { value: "activity.created", label: "Actividad creada" },
];

// El servidor nunca manda el secret en las listas: solo `secretHint` («••••ab12»). El valor
// completo llega una única vez, en la respuesta de crear o regenerar, y no se guarda en la lista.
interface WebhookData {
  id: string;
  event: string;
  url: string;
  isActive: boolean;
  secretHint: string;
  createdAt: Date;
}

interface ApiKeyData {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

interface IntegrationsTabProps {
  initialWebhooks: WebhookData[];
  initialApiKeys: ApiKeyData[];
}

export function IntegrationsTab({
  initialWebhooks,
  initialApiKeys,
}: IntegrationsTabProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const confirmar = useConfirm();
  const [webhooks, setWebhooks] = useState<WebhookData[]>(initialWebhooks);
  const [apiKeys, setApiKeys] = useState(initialApiKeys);

  // Formulario nuevo webhook
  const [newWebhookEvent, setNewWebhookEvent] = useState("");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");

  // Formulario nueva API key
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  // Secret del webhook recién creado: se muestra una sola vez (E6).
  const [secretNuevo, setSecretNuevo] = useState<{ url: string; secret: string } | null>(null);

  async function handleCreateWebhook() {
    if (!newWebhookEvent || !newWebhookUrl) {
      toast({ title: "Error", description: "Selecciona un evento e ingresa una URL", variant: "destructive" });
      return;
    }

    startTransition(async () => {
      try {
        const config = await createWebhookConfig({
          event: newWebhookEvent,
          url: newWebhookUrl,
        });
        const { secret, ...fila } = config;
        setWebhooks((prev) => [...prev, fila as WebhookData]);
        setSecretNuevo({ url: newWebhookUrl, secret });
        setNewWebhookEvent("");
        setNewWebhookUrl("");
        toast({ title: "Webhook creado", description: "Ya está activo. Cópialo ahora, no se volverá a mostrar." });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleToggleWebhook(webhook: WebhookData) {
    // Pausar corta el envío de eventos; se avisa antes. Activar no necesita confirmación.
    if (webhook.isActive) {
      const ok = await confirmar({
        titulo: "¿Pausar este webhook?",
        descripcion: `Mientras esté en pausa no se enviará nada a ${webhook.url}, y los eventos que ocurran en ese tiempo no se reenvían al reactivarlo.`,
        confirmar: "Pausar webhook",
        peligroso: true,
      });
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        await updateWebhookConfig(webhook.id, { isActive: !webhook.isActive });
        setWebhooks((prev) =>
          prev.map((w) =>
            w.id === webhook.id ? { ...w, isActive: !w.isActive } : w
          )
        );
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleRegenerateSecret(webhook: WebhookData) {
    const ok = await confirmar({
      titulo: "¿Regenerar la clave secreta?",
      descripcion: `La clave actual deja de valer al instante. El sistema que recibe ${webhook.url} (Zapier u otro) tendrá que actualizarse con la clave nueva, o rechazará las firmas.`,
      confirmar: "Regenerar clave",
      peligroso: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const { secret, ...fila } = await regenerateWebhookSecret(webhook.id);
        setWebhooks((prev) => prev.map((w) => (w.id === webhook.id ? { ...w, secretHint: fila.secretHint } : w)));
        setSecretNuevo({ url: webhook.url, secret });
        toast({ title: "Clave regenerada", description: "Cópiala ahora, no se volverá a mostrar." });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleDeleteWebhook(id: string) {
    const w = webhooks.find((x) => x.id === id);
    const ok = await confirmar({
      titulo: "¿Borrar este webhook?",
      descripcion: `${w ? `Dejará de enviarse a ${w.url}. ` : ""}Se pierde su clave secreta y no se puede recuperar: si lo vuelves a crear, el servicio que lo recibe tendrá que configurarse con la clave nueva. Si solo quieres detenerlo un tiempo, desactívalo.`,
      confirmar: "Borrar webhook",
      peligroso: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteWebhookConfig(id);
        setWebhooks((prev) => prev.filter((w) => w.id !== id));
        toast({ title: "Webhook eliminado" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleGenerateApiKey() {
    if (!newApiKeyName) {
      toast({ title: "Error", description: "Ingresa un nombre para la API key", variant: "destructive" });
      return;
    }

    startTransition(async () => {
      try {
        const result = await generateNewApiKey(newApiKeyName);
        setGeneratedKey(result.key);
        setApiKeys((prev) => [result.apiKey as ApiKeyData, ...prev]);
        setNewApiKeyName("");
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleRevokeApiKey(id: string) {
    const k = apiKeys.find((x) => x.id === id);
    const ok = await confirmar({
      titulo: k ? `¿Revocar la API key "${k.name}"?` : "¿Revocar esta API key?",
      descripcion:
        "Los servicios que la usan (por ejemplo Zapier) dejarán de poder crear datos en el CRM de inmediato. No se puede deshacer: tendrías que generar una llave nueva y actualizarla en cada servicio.",
      confirmar: "Revocar llave",
      peligroso: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await revokeApiKey(id);
        setApiKeys((prev) =>
          prev.map((k) => (k.id === id ? { ...k, isActive: false } : k))
        );
        toast({ title: "API key revocada" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiado al portapapeles" });
  }

  return (
    <div className="space-y-6">
      {/* Conectores de leads (Meta/TikTok/Web) */}
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Conectores de Leads</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Gestiona tus cuentas de redes y ads (multicuenta) en el nuevo Centro de Conexiones.
        </p>
        <Link href="/conexiones" className="mt-2 inline-block text-[12px] underline">Ir a Conexiones →</Link>
      </div>

      {/* Webhooks salientes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Webhooks Salientes</CardTitle>
          <CardDescription>
            Configura endpoints que reciban notificaciones cuando ocurren eventos en el CRM (ideal para Zapier)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Formulario nuevo webhook */}
          <div className="mb-4 flex gap-3 items-end">
            <div className="w-56">
              <Label>Evento</Label>
              <Select value={newWebhookEvent} onValueChange={setNewWebhookEvent}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar evento" />
                </SelectTrigger>
                <SelectContent>
                  {WEBHOOK_EVENTS.map((evt) => (
                    <SelectItem key={evt.value} value={evt.value}>
                      {evt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label>URL del webhook</Label>
              <Input
                placeholder="https://hooks.zapier.com/..."
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
              />
            </div>
            <Button onClick={handleCreateWebhook} disabled={isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar
            </Button>
          </div>

          {secretNuevo && (
            <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
              <p className="mb-1 text-sm font-semibold text-yellow-800">
                Clave secreta del webhook. Cópiala ahora, no se volverá a mostrar:
              </p>
              <p className="mb-2 break-all text-xs text-yellow-800">Para {secretNuevo.url}. Úsala en el servicio que lo recibe para verificar la firma.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-xs break-all">{secretNuevo.secret}</code>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(secretNuevo.secret)}>
                  <Copy className="mr-1 h-3 w-3" />
                  Copiar
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setSecretNuevo(null)}>
                Ya la guardé, cerrar
              </Button>
            </div>
          )}

          {/* Tabla de webhooks */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Evento</th>
                  <th className="pb-2 font-medium">URL</th>
                  <th className="pb-2 font-medium">Clave secreta</th>
                  <th className="pb-2 font-medium">Estado</th>
                  <th className="pb-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((webhook) => {
                  const eventLabel = WEBHOOK_EVENTS.find(
                    (e) => e.value === webhook.event
                  )?.label ?? webhook.event;

                  return (
                    <tr key={webhook.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2">
                        <Badge variant="outline">{eventLabel}</Badge>
                      </td>
                      <td className="py-2 max-w-[200px] truncate font-mono text-xs">
                        {webhook.url}
                      </td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">{webhook.secretHint}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={webhook.isActive}
                            aria-label={webhook.isActive ? "Pausar webhook" : "Activar webhook"}
                            disabled={isPending}
                            onClick={() => handleToggleWebhook(webhook)}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${webhook.isActive ? "bg-green-500" : "bg-neutral-300"}`}
                          >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${webhook.isActive ? "translate-x-4" : "translate-x-0.5"}`} />
                          </button>
                          <span className="text-xs text-muted-foreground">{webhook.isActive ? "Activo" : "En pausa"}</span>
                        </div>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Regenerar clave secreta"
                            aria-label="Regenerar clave secreta"
                            onClick={() => handleRegenerateSecret(webhook)}
                            disabled={isPending}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Borrar webhook"
                            onClick={() => handleDeleteWebhook(webhook.id)}
                            disabled={isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {webhooks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No hay webhooks configurados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">API Keys</CardTitle>
          <CardDescription>
            Genera API keys para que servicios externos (Zapier, etc.) puedan crear datos en el CRM
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Key recien generada */}
          {generatedKey && (
            <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
              <p className="mb-2 text-sm font-semibold text-yellow-800">
                API Key generada (solo se muestra una vez):
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-xs break-all">
                  {generatedKey}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(generatedKey)}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  Copiar
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setGeneratedKey(null)}
              >
                Cerrar
              </Button>
            </div>
          )}

          {/* Formulario nueva API key */}
          <div className="mb-4 flex gap-3 items-end">
            <div className="flex-1">
              <Label>Nombre</Label>
              <Input
                placeholder="ej: Zapier Facebook Ads"
                value={newApiKeyName}
                onChange={(e) => setNewApiKeyName(e.target.value)}
              />
            </div>
            <Button onClick={handleGenerateApiKey} disabled={isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Generar API Key
            </Button>
          </div>

          {/* Tabla de API keys */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Nombre</th>
                  <th className="pb-2 font-medium">Prefijo</th>
                  <th className="pb-2 font-medium">Último uso</th>
                  <th className="pb-2 font-medium">Estado</th>
                  <th className="pb-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-2 font-medium">{key.name}</td>
                    <td className="py-2 font-mono text-xs">{key.prefix}...</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleString("es-MX")
                        : "Nunca"}
                    </td>
                    <td className="py-2">
                      <Badge
                        variant={key.isActive ? "default" : "secondary"}
                        className={key.isActive ? "bg-green-500" : ""}
                      >
                        {key.isActive ? "Activa" : "Revocada"}
                      </Badge>
                    </td>
                    <td className="py-2">
                      {key.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeApiKey(key.id)}
                          disabled={isPending}
                        >
                          Revocar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No hay API keys generadas
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
