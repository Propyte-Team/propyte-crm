"use client";

import { useState, useCallback } from "react";
import { PROVIDERS, type ProviderGroup } from "@/lib/connectors/registry";
import { ConnectWizard } from "./connect-wizard";

interface Conn {
  id: string; name: string; provider: string; status: string;
  lastLeadAt: string | null; errorCount: number; lastError: string | null;
  _count: { leadLogs: number };
}

const STATUS_DOT: Record<string, string> = { ACTIVE: "bg-green-600", PAUSED: "bg-neutral-300", ERROR: "bg-red-600" };
const GROUP_ORDER: ProviderGroup[] = ["meta", "tiktok", "google", "linkedin", "pinterest"];

export function ConnectionsView({ initial }: { initial: Conn[] }) {
  const [connectors, setConnectors] = useState<Conn[]>(initial);
  const [wizardProvider, setWizardProvider] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/admin/connectors");
    if (res.ok) setConnectors((await res.json()).data ?? []);
  }, []);

  async function toggle(c: Conn) {
    await fetch(`/api/admin/connectors/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: c.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }),
    });
    reload();
  }

  async function remove(c: Conn) {
    if (!confirm(`¿Eliminar conexión "${c.name}"?`)) return;
    await fetch(`/api/admin/connectors/${c.id}`, { method: "DELETE" });
    reload();
  }

  const byGroup = GROUP_ORDER.map((g) => ({
    group: g,
    label: PROVIDERS.find((p) => p.group === g)?.groupLabel ?? g,
    providers: PROVIDERS.filter((p) => p.group === g),
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Admin</p>
        <h1 className="text-[28px] font-semibold tracking-tight">Conexiones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecta tus cuentas para jalar leads al CRM. Multicuenta por plataforma.
        </p>
      </header>

      {byGroup.map((grp) => (
        <section key={grp.group} className="mb-8">
          <h2 className="border-t border-foreground pt-2 text-[12px] font-semibold uppercase tracking-wide">
            {grp.label}
          </h2>
          {grp.providers.map((p) => {
            const accounts = connectors.filter((c) => c.provider === p.id);
            const pushOnly = p.pull === "none";
            return (
              <div key={p.id} className="mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium">{p.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {pushOnly
                      ? "push-only · v2"
                      : `${accounts.filter((a) => a.status === "ACTIVE").length}/${accounts.length}`}
                  </span>
                </div>

                {pushOnly ? (
                  <p className="mt-1 rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
                    {p.note}
                  </p>
                ) : (
                  <>
                    {accounts.map((c) => (
                      <div
                        key={c.id}
                        className="mt-1.5 flex items-center justify-between rounded-md border p-2 text-[12px]"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[c.status] ?? "bg-neutral-300"}`}
                          />
                          <span className="truncate">{c.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {c._count.leadLogs} ·{" "}
                            {c.lastLeadAt
                              ? new Date(c.lastLeadAt).toLocaleDateString("es-MX")
                              : "—"}
                          </span>
                          <button className="text-[11px] underline" onClick={() => toggle(c)}>
                            {c.status === "ACTIVE" ? "Pausar" : "Activar"}
                          </button>
                          <button
                            className="text-[11px] text-destructive underline"
                            onClick={() => remove(c)}
                          >
                            Eliminar
                          </button>
                        </span>
                      </div>
                    ))}
                    {accounts.some((c) => c.lastError) && (
                      <p className="mt-1 truncate text-[11px] text-destructive">
                        {accounts.find((c) => c.lastError)?.lastError}
                      </p>
                    )}
                    <button
                      className="mt-1.5 w-full rounded-md border border-dashed p-2 text-left text-[12px] text-muted-foreground hover:text-foreground"
                      onClick={() => setWizardProvider(p.id)}
                    >
                      ＋ Conectar cuenta
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {wizardProvider && (
        <ConnectWizard
          provider={wizardProvider}
          open={!!wizardProvider}
          onOpenChange={(v) => {
            if (!v) setWizardProvider(null);
          }}
          onConnected={reload}
        />
      )}
    </div>
  );
}
