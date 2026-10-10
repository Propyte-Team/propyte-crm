"use client";

import { useState, useCallback, type FormEvent } from "react";
import { PROVIDERS, type ProviderGroup } from "@/lib/connectors/registry";
import { ConnectWizard } from "./connect-wizard";
import { MetaDmsWizard } from "./meta-dms-wizard";
import { MappingEditor } from "./mapping-editor";
import { BrandSelect, useBrandOptions } from "./brand-select";
import { formatDate } from "@/lib/format-date";

interface Conn {
  id: string; name: string; provider: string; status: string;
  lastLeadAt: string | null; errorCount: number; lastError: string | null;
  fieldMap?: unknown;
  // 2026-10-09: marca del agente de la cuenta (null = Predeterminada).
  brandId: string | null;
  brand: { id: string; name: string } | null;
  _count: { leadLogs: number };
}

const MAPPING_PROVIDERS = new Set(["META", "INSTAGRAM"]);
// 2026-10-10: cuentas cuyo Page Access Token se puede cambiar sin borrar la cuenta.
const TOKEN_PROVIDERS = new Set(["INSTAGRAM", "MESSENGER"]);
// 2026-10-10: Messenger se conecta con el asistente «Meta DMs», que crea también el Instagram
// de la misma Página. El de Instagram se queda por proveedor para el caso en que la Página ya
// tiene su Messenger y solo falta el IG.
const META_DMS_PROVIDER = "MESSENGER";

const STATUS_DOT: Record<string, string> = { ACTIVE: "bg-green-600", PAUSED: "bg-neutral-300", ERROR: "bg-red-600" };
const GROUP_ORDER: ProviderGroup[] = ["meta", "tiktok", "google", "linkedin", "pinterest"];

export function ConnectionsView({ initial }: { initial: Conn[] }) {
  const [connectors, setConnectors] = useState<Conn[]>(initial);
  const [wizardProvider, setWizardProvider] = useState<string | null>(null);
  const [metaDmsOpen, setMetaDmsOpen] = useState(false);
  const [mappingFor, setMappingFor] = useState<Conn | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cuenta cuyo selector de marca está abierto, y las marcas asignables.
  const [brandFor, setBrandFor] = useState<string | null>(null);
  const brands = useBrandOptions(true);
  // 2026-10-10: cambiar el token de una cuenta de IG/Messenger. El token solo vive en
  // `tokenDraft` mientras se escribe; al enviarlo se vacía (ver saveToken).
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenNotice, setTokenNotice] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/connectors");
      if (!res.ok) { setError("No se pudieron cargar las conexiones."); return; }
      setConnectors((await res.json()).data ?? []);
      setError(null);
    } catch {
      setError("Error de red al cargar las conexiones.");
    }
  }, []);

  const toggle = useCallback(async (c: Conn) => {
    const res = await fetch(`/api/admin/connectors/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: c.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }),
    });
    if (!res.ok) { setError(`No se pudo cambiar el estado de "${c.name}".`); return; }
    reload();
  }, [reload]);

  const changeBrand = useCallback(async (c: Conn, brandId: string | null) => {
    const res = await fetch(`/api/admin/connectors/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : `No se pudo cambiar la marca de "${c.name}".`);
      return;
    }
    setBrandFor(null);
    reload();
  }, [reload]);

  const toggleToken = useCallback((c: Conn) => {
    setTokenDraft("");
    setTokenNotice(null);
    setTokenFor((open) => (open === c.id ? null : c.id));
  }, []);

  const saveToken = useCallback(async (c: Conn, e: FormEvent) => {
    e.preventDefault();
    const pageAccessToken = tokenDraft.trim();
    if (!pageAccessToken || tokenBusy) return;
    // Fuera del estado antes de mandarlo: salga bien o mal, el token no se queda en React.
    // Si falla hay que pegarlo otra vez, que es el precio de no guardarlo.
    setTokenDraft("");
    setTokenBusy(true);
    try {
      const res = await fetch(`/api/admin/connectors/${c.id}/token`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageAccessToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTokenNotice({
          id: c.id, ok: false,
          text: typeof data.error === "string" ? data.error : `No se pudo actualizar el token de "${c.name}".`,
        });
        return;
      }
      setTokenFor(null);
      // Un token por Página: el servidor lo aplica también a la otra cuenta (IG/Messenger) de esa
      // Página y dice en cuáles quedó, para que no se vuelva a pegar en la hermana.
      const updated: string[] = Array.isArray(data.data?.updated) ? data.data.updated : [];
      const skipped: string[] = Array.isArray(data.data?.skipped) ? data.data.skipped : [];
      const page = data.data?.pageName || data.data?.pageId || "";
      setTokenNotice({
        id: c.id, ok: skipped.length === 0,
        text:
          `Token actualizado · página ${page}` +
          (updated.length > 1 ? ` · en ${updated.join(" y ")}` : "") +
          (skipped.length ? ` · NO se pudo en ${skipped.join(", ")} (sus credenciales no se pudieron leer)` : ""),
      });
      reload();
    } catch {
      setTokenNotice({ id: c.id, ok: false, text: `Error de red al actualizar el token de "${c.name}".` });
    } finally {
      setTokenBusy(false);
    }
  }, [tokenDraft, tokenBusy, reload]);

  const remove = useCallback(async (c: Conn) => {
    if (!confirm(`¿Eliminar conexión "${c.name}"?`)) return;
    const res = await fetch(`/api/admin/connectors/${c.id}`, { method: "DELETE" });
    if (!res.ok) { setError(`No se pudo eliminar "${c.name}".`); return; }
    reload();
  }, [reload]);

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

      {error && (
        <p className="mb-4 rounded-md border border-destructive p-2 text-[12px] text-destructive">{error}</p>
      )}

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
                      <div key={c.id} className="mt-1.5 rounded-md border p-2 text-[12px]">
                        <div className="flex items-center justify-between">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[c.status] ?? "bg-neutral-300"}`}
                            />
                            <span className="truncate">{c.name}</span>
                            {c.brand && (
                              <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground">
                                {c.brand.name}
                              </span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {c._count.leadLogs} ·{" "}
                              {c.lastLeadAt ? formatDate(c.lastLeadAt) : "—"}
                            </span>
                            <button className="text-[11px] underline" onClick={() => toggle(c)}>
                              {c.status === "ACTIVE" ? "Pausar" : "Activar"}
                            </button>
                            <button
                              className="text-[11px] underline"
                              onClick={() => setBrandFor(brandFor === c.id ? null : c.id)}
                            >
                              Marca
                            </button>
                            {MAPPING_PROVIDERS.has(c.provider) && (
                              <button className="text-[11px] underline" onClick={() => setMappingFor(c)}>
                                Editar mapeo
                              </button>
                            )}
                            {TOKEN_PROVIDERS.has(c.provider) && (
                              <button className="text-[11px] underline" onClick={() => toggleToken(c)}>
                                Token
                              </button>
                            )}
                            <button
                              className="text-[11px] text-destructive underline"
                              onClick={() => remove(c)}
                            >
                              Eliminar
                            </button>
                          </span>
                        </div>
                        {brandFor === c.id && (
                          <div className="mt-2">
                            <BrandSelect
                              id={`brand-${c.id}`}
                              value={c.brandId}
                              current={c.brand}
                              brands={brands}
                              onChange={(brandId) => changeBrand(c, brandId)}
                            />
                          </div>
                        )}
                        {tokenFor === c.id && (
                          <form className="mt-2 space-y-1" onSubmit={(e) => saveToken(c, e)}>
                            <label
                              htmlFor={`token-${c.id}`}
                              className="text-[10px] uppercase tracking-wide text-muted-foreground"
                            >
                              Nuevo Page Access Token
                            </label>
                            <input
                              id={`token-${c.id}`}
                              type="password"
                              className="form-input w-full font-mono"
                              autoComplete="off"
                              spellCheck={false}
                              value={tokenDraft}
                              disabled={tokenBusy}
                              onChange={(e) => setTokenDraft(e.target.value)}
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Solo cambia el token: App Secret y Verify Token se conservan. Antes de guardar
                              se confirma con Meta que el token es de la página de esta cuenta.
                            </p>
                            <div className="flex gap-3">
                              <button
                                type="submit"
                                className="text-[11px] underline disabled:no-underline disabled:opacity-50"
                                disabled={tokenBusy || !tokenDraft.trim()}
                              >
                                {tokenBusy ? "Verificando…" : "Guardar"}
                              </button>
                              <button
                                type="button"
                                className="text-[11px] underline"
                                onClick={() => toggleToken(c)}
                              >
                                Cancelar
                              </button>
                            </div>
                          </form>
                        )}
                        {tokenNotice?.id === c.id && (
                          <p
                            role="status"
                            className={`mt-1 text-[11px] ${tokenNotice.ok ? "text-green-700" : "text-destructive"}`}
                          >
                            {tokenNotice.text}
                          </p>
                        )}
                      </div>
                    ))}
                    {accounts.filter((c) => c.lastError).map((c) => (
                      <p key={`err-${c.id}`} className="mt-1 truncate text-[11px] text-destructive">
                        {c.name}: {c.lastError}
                      </p>
                    ))}
                    {p.id === META_DMS_PROVIDER ? (
                      <button
                        className="mt-1.5 w-full rounded-md border border-dashed p-2 text-left text-[12px] text-muted-foreground hover:text-foreground"
                        onClick={() => setMetaDmsOpen(true)}
                      >
                        ＋ Conectar página de Meta (DMs)
                        <span className="block text-[10px]">Messenger y, si quieres, el Instagram de la misma Página</span>
                      </button>
                    ) : (
                      <button
                        className="mt-1.5 w-full rounded-md border border-dashed p-2 text-left text-[12px] text-muted-foreground hover:text-foreground"
                        onClick={() => setWizardProvider(p.id)}
                      >
                        ＋ Conectar cuenta
                      </button>
                    )}
                    {p.id === "INSTAGRAM" && (
                      <button
                        className="mt-1 text-[11px] text-muted-foreground underline hover:text-foreground"
                        onClick={() => setMetaDmsOpen(true)}
                      >
                        ¿Messenger e Instagram de la misma Página? Conéctalos juntos
                      </button>
                    )}
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

      <MetaDmsWizard open={metaDmsOpen} onOpenChange={setMetaDmsOpen} onConnected={reload} />

      {mappingFor && (
        <MappingEditor
          key={mappingFor.id}
          connectorId={mappingFor.id}
          name={mappingFor.name}
          fieldMap={mappingFor.fieldMap}
          onClose={() => setMappingFor(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
