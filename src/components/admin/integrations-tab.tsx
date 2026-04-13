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
import { Plus, Trash2, Copy, Eye, EyeOff } from "lucide-react";
import {
  createWebhookConfig,
  updateWebhookConfig,
  deleteWebhookConfig,
  generateNewApiKey,
  revokeApiKey,
} from "@/server/admin";
import { useToast } from "@/components/ui/use-toast";

// Eventos disponibles para webhooks
const WEBHOOK_EVENTS = [
  { value: "contact.created", label: "Contacto creado" },
  { value: "contact.updated", label: "Contacto actualizado" },
  { value: "deal.created", label: "Deal creado" },
  { value: "deal.stage_changed", label: "Deal cambio de etapa" },
  { value: "deal.won", label: "Deal ganado" },
  { value: "deal.lost", label: "Deal perdido" },
  { value: "deal.updated", label: "Deal actualizado" },
  { value: "activity.created", label: "Actividad creada" },
  { value: "walk_in.created", label: "Walk-in registrado" },
];

interface WebhookData {
  id: string;
  event: string;
  url: string;
  isActive: boolean;
  secret: string;
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

  const [webhooks, setWebhooks] = useState(initialWebhooks);
  const [apiKeys, setApiKeys] = useState(initialApiKeys);

  // Formulario nuevo webhook
  const [newWebhookEvent, setNewWebhookEvent] = useState("");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");

  // Formulario nueva API key
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  // Visibilidad de secrets
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());

  function toggleSecretVisibility(id: string) {
    setVisibleSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        setWebhooks((prev) => [...prev, config as WebhookData]);
        setNewWebhookEvent("");
        setNewWebhookUrl("");
        toast({ title: "Webhook creado", description: `Secret: ${(config as any).secret.substring(0, 16)}...` });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleToggleWebhook(webhook: WebhookData) {
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

  async function handleDeleteWebhook(id: string) {
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

          {/* Tabla de webhooks */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Evento</th>
                  <th className="pb-2 font-medium">URL</th>
                  <th className="pb-2 font-medium">Secret</th>
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
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-xs">
                            {visibleSecrets.has(webhook.id)
                              ? webhook.secret
                              : webhook.secret.substring(0, 8) + "..."}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleSecretVisibility(webhook.id)}
                          >
                            {visibleSecrets.has(webhook.id) ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(webhook.secret)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                      <td className="py-2">
                        <Badge
                          variant={webhook.isActive ? "default" : "secondary"}
                          className={`cursor-pointer ${webhook.isActive ? "bg-green-500" : ""}`}
                          onClick={() => handleToggleWebhook(webhook)}
                        >
                          {webhook.isActive ? "Activo" : "Inactivo"}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteWebhook(webhook.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
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
                  <th className="pb-2 font-medium">Ultimo uso</th>
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
