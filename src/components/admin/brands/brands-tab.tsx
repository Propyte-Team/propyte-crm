// Pestaña Admin → "Marcas del agente" (2026-10-09, spec marcas-agente): una tarjeta por marca con su
// estado (agente encendido/apagado, plaza, desarrollos) y las cuentas que la usan. Hace su propio
// fetch (GET /api/admin/brands) para no depender de page.tsx. Solo ADMIN/DIRECTOR/GERENTE editan
// (`canWrite`); el API vuelve a validar el rol.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLAZA_LABELS } from "@/lib/constants";
import { providerById } from "@/lib/connectors/registry";
import { apiErrorMessage, type BrandRow } from "./brand-helpers";
import { BrandFormDialog } from "./brand-form-dialog";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Activa", PAUSED: "Pausada", ERROR: "Con error" };

interface Props {
  canWrite: boolean;
  /** Playbooks del bot (mismo origen que la pestaña Playbook). */
  playbooks: Array<{ id: string; name: string }>;
  /** Usuarios activos, para elegir al responsable de marketing. */
  users: Array<{ id: string; name: string }>;
}

export function BrandsTab({ canWrite, playbooks, users }: Props) {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BrandRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/brands");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(apiErrorMessage(data, "No se pudieron cargar las marcas"));
        return;
      }
      setBrands(Array.isArray(data.data) ? data.data : []);
    } catch {
      setLoadError("Error de red al cargar las marcas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
          Cada marca contesta con su propia presentación, conocimiento, catálogo y canales. Las cuentas de
          Conexiones se asignan a una marca; las que no tienen marca usan la predeterminada y la configuración
          global del bot.
        </p>
        {canWrite && (
          <Button size="sm" className="shrink-0" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Nueva marca
          </Button>
        )}
      </div>

      {loading && <p className="py-4 text-center text-sm text-muted-foreground">Cargando…</p>}
      {!loading && loadError && <p className="py-4 text-center text-sm text-destructive">{loadError}</p>}
      {!loading && !loadError && brands.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">Sin marcas. Crea la primera.</p>
      )}

      {!loading &&
        !loadError &&
        brands.map((b) => (
          <Card key={b.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{b.name}</CardTitle>
                  {b.isDefault && <Badge variant="secondary">Predeterminada</Badge>}
                  {/* La predeterminada lee la config GLOBAL del bot: su propio `botEnabled` no se usa,
                      así que mostrar "apagado" sería engañoso. */}
                  {b.isDefault ? (
                    <Badge variant="outline">Usa el bot global</Badge>
                  ) : b.botEnabled ? (
                    <Badge>Agente encendido</Badge>
                  ) : (
                    <Badge variant="outline">Agente apagado</Badge>
                  )}
                </div>
                {!b.isDefault && (
                  <CardDescription>
                    Plaza: {b.defaultPlaza ? PLAZA_LABELS[b.defaultPlaza] ?? b.defaultPlaza : "sin plaza fija"} ·{" "}
                    {b.developmentIds.length} {b.developmentIds.length === 1 ? "desarrollo" : "desarrollos"}
                  </CardDescription>
                )}
              </div>
              {canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => { setEditing(b); setDialogOpen(true); }}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cuentas asignadas</p>
              {b.isDefault && (
                <p className="text-[12px] text-muted-foreground">Incluye todas las cuentas que no tienen marca asignada.</p>
              )}
              {b.connectors.length === 0 && !b.isDefault && (
                <p className="text-[12px] text-muted-foreground">
                  Sin cuentas asignadas. Asígnalas desde Conexiones.
                </p>
              )}
              {b.connectors.map((c) => (
                <p key={c.id} className="text-[12px]">
                  {c.name} · {providerById(c.provider)?.label ?? c.provider} · {STATUS_LABEL[c.status] ?? c.status}
                </p>
              ))}
            </CardContent>
          </Card>
        ))}

      <BrandFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        brand={editing}
        playbooks={playbooks}
        users={users}
        onSaved={load}
      />
    </div>
  );
}
