"use client";

// Asistente «Conectar página de Meta (DMs)» (2026-10-10): la cuenta de Messenger de una
// Página y, con «Incluir Instagram de esta Página» (marcado por defecto), la de Instagram
// vinculada, en un solo formulario. Comparten Page ID, token, App Secret, Verify Token y
// marca, así que se escriben una vez.
//
// La lógica vive en el servidor: «Probar conexión» pregunta a /meta-dms/lookup de qué
// Página es el token y qué Instagram tiene vinculado (el token nunca va del navegador a
// Graph), y «Guardar» crea las dos cuentas en una transacción en /meta-dms, que vuelve a
// comprobarlo todo. Aquí solo se capturan valores y se muestran respuestas.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { providerById } from "@/lib/connectors/registry";
import { metaDmBaseName, metaDmNames } from "@/lib/connectors/meta-dms";
import { BrandSelect, useBrandOptions } from "./brand-select";

interface Lookup {
  pageId: string;
  pageName: string;
  instagram: { id: string; username: string } | null;
  instagramError: string | null;
}
type Subscription =
  | { ok: true; changed: boolean; subscribedFields: string[]; missing: string[] }
  | { ok: false; error: string };
interface Created {
  connectors: Array<{ id: string; name: string; provider: string }>;
  subscription: Subscription;
}

const STEPS = [
  {
    title: "Abre tu app de Meta (Propyte CRM)",
    body: "Selecciona la Página de Facebook de la marca. Si también quieres su Instagram, la cuenta de Instagram Business tiene que estar vinculada a esa Página.",
    link: "https://developers.facebook.com/apps",
  },
  {
    title: "Genera un Page Access Token (System User)",
    body: "El de la Página, con permisos de mensajería (pages_messaging, instagram_manage_messages) y pages_manage_metadata para suscribirla a los webhooks.",
  },
  {
    title: "Pega los datos una sola vez, prueba y guarda",
    body: "Sirven para Messenger y para el Instagram de la misma Página. Al probar confirmamos que el token es de esa Página y llenamos el Instagram Business ID. El Verify Token lo inventas tú; ponlo igual en el webhook /api/webhooks/meta-dm de Meta.",
  },
];

// Campos compartidos con las etiquetas del registro (los de Messenger: Page ID, marca visible,
// token, App Secret, Verify Token). El de Instagram solo añade su ID.
const SHARED_FIELDS = providerById("MESSENGER")?.credFields ?? [];
const IG_LABEL = providerById("INSTAGRAM")?.credFields.find((f) => f.key === "igBusinessId")?.label ?? "Instagram Business ID";

const errorText = (data: { error?: unknown }, fallback: string) =>
  typeof data.error === "string" ? data.error : fallback;

export function MetaDmsWizard({
  open, onOpenChange, onConnected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState<string | null>(null);
  const brands = useBrandOptions(open);
  const [values, setValues] = useState<Record<string, string>>({});
  const [includeIg, setIncludeIg] = useState(true);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  const isLast = step === STEPS.length - 1;
  const names = metaDmNames(name);
  const hasName = metaDmBaseName(name).length >= 2;
  const linked = lookup?.instagram ?? null;
  const igValue = (values.igBusinessId ?? "").trim();

  function setField(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaveError("");
    // Lo probado era otra combinación de Página y token: hay que volver a probar.
    if (key === "pageId" || key === "pageAccessToken") {
      setTestState("idle");
      setLookup(null);
      setMsg("");
    }
  }

  async function probar() {
    setTestState("testing"); setMsg(""); setSaveError("");
    try {
      const res = await fetch("/api/admin/connectors/meta-dms/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: values.pageId ?? "", pageAccessToken: values.pageAccessToken ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.data) { setTestState("fail"); setMsg(errorText(data, "No se pudo validar")); return; }
      const found = data.data as Lookup;
      setLookup(found);
      setTestState("ok");
      setMsg(`Página verificada: ${found.pageName || found.pageId}`);
      // El de la Página es el único ID que el alta va a aceptar; sigue siendo editable.
      if (found.instagram) setValues((v) => ({ ...v, igBusinessId: found.instagram!.id }));
    } catch {
      setTestState("fail"); setMsg("Error de red al probar la conexión");
    }
  }

  async function guardar() {
    if (saving) return;
    setSaving(true); setSaveError("");
    try {
      const fields = { ...values };
      if (!includeIg) delete fields.igBusinessId;
      const res = await fetch("/api/admin/connectors/meta-dms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, brandId, includeInstagram: includeIg, fields }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.data) { setSaveError(errorText(data, "Error al guardar las cuentas")); return; }
      // Ya creadas: el token y el App Secret no tienen por qué seguir en el navegador.
      setValues({});
      setCreated({ connectors: data.data.connectors ?? [], subscription: data.data.subscription });
      onConnected();
    } catch {
      setSaveError("Error de red al guardar. Revisa la lista antes de reintentar: puede que sí se hayan creado.");
      onConnected();
    } finally {
      setSaving(false);
    }
  }

  // Reintento de la suscripción con el mismo endpoint que «Suscribir página» de Comentarios.
  async function suscribir() {
    const target = created?.connectors.find((c) => c.provider === "MESSENGER") ?? created?.connectors[0];
    if (!target || subscribing) return;
    setSubscribing(true);
    let subscription: Subscription;
    try {
      const res = await fetch(`/api/admin/connectors/${target.id}/subscribe`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      subscription = res.ok
        ? {
            ok: true,
            changed: !!data.data?.changed,
            subscribedFields: data.data?.subscribedFields ?? [],
            missing: data.data?.missing ?? [],
          }
        : { ok: false, error: errorText(data, "No se pudo suscribir la Página") };
    } catch {
      subscription = { ok: false, error: "Error de red al suscribir la Página" };
    }
    setCreated((c) => (c ? { ...c, subscription } : c));
    setSubscribing(false);
  }

  function reset() {
    setStep(0); setName(""); setBrandId(null); setValues({}); setIncludeIg(true);
    setTestState("idle"); setLookup(null); setMsg(""); setSaving(false); setSaveError("");
    setCreated(null); setSubscribing(false);
  }

  const sub = created?.subscription;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conectar página de Meta (DMs)</DialogTitle>
        </DialogHeader>

        {created && sub ? (
          <div className="space-y-2 text-[12px]">
            <p className="text-green-700">
              Cuentas creadas y activas: {created.connectors.map((c) => c.name).join(" · ")}
            </p>
            {sub.ok ? (
              <p role="status" className={sub.missing.length ? "text-destructive" : "text-green-700"}>
                {sub.changed ? "Página suscrita a los webhooks" : "La Página ya estaba suscrita a los webhooks"}:{" "}
                {sub.subscribedFields.join(", ") || "—"}
                {sub.missing.length > 0 && ` · faltan: ${sub.missing.join(", ")}`}
              </p>
            ) : (
              <div role="status" className="rounded-md border border-destructive p-2 text-destructive">
                <p>No se pudo suscribir la Página a los webhooks: {sub.error}</p>
                <p className="mt-1">
                  Las cuentas sí quedaron creadas, pero sin la suscripción Meta no manda los mensajes de esta
                  Página. Reintenta con «Suscribir página» (aquí o en Comentarios → Diagnóstico de cuentas).
                </p>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              {!sub.ok || sub.missing.length > 0 ? (
                <button className="btn-secondary" onClick={suscribir} disabled={subscribing}>
                  {subscribing ? "Suscribiendo…" : "Suscribir página"}
                </button>
              ) : <span />}
              <button className="btn-primary" onClick={() => { reset(); onOpenChange(false); }}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-[11px] font-mono text-muted-foreground">{step + 1}/{STEPS.length}</div>
            <div className="mt-1">
              <h4 className="text-sm font-semibold">{STEPS[step].title}</h4>
              <p className="mt-1 text-[12px] text-muted-foreground">{STEPS[step].body}</p>
              {STEPS[step].link && (
                <a href={STEPS[step].link} target="_blank" rel="noreferrer" className="text-[12px] underline">
                  Abrir →
                </a>
              )}
            </div>

            {isLast && (
              <div className="mt-3 space-y-2">
                <div className="space-y-1">
                  <label htmlFor="metadm-name" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Nombre (marca o Página)
                  </label>
                  <input
                    id="metadm-name"
                    className="form-input w-full"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setSaveError(""); }}
                    placeholder="Nativa Tulum"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {hasName
                      ? `Se crearán: «${names.messenger}»${includeIg ? ` e «${names.instagram}»` : ""}`
                      : "Los prefijos «Messenger | DM» e «IG -» se ponen solos."}
                  </p>
                </div>
                <BrandSelect id="metadm-brand" value={brandId} onChange={setBrandId} brands={brands} />
                {SHARED_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <label htmlFor={`metadm-${f.key}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {f.label}
                    </label>
                    <input
                      id={`metadm-${f.key}`}
                      className="form-input w-full"
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setField(f.key, e.target.value)}
                    />
                    {f.help && <p className="text-[10px] text-muted-foreground">{f.help}</p>}
                  </div>
                ))}

                <label className="flex items-center gap-2 pt-1 text-[12px]">
                  <input
                    type="checkbox"
                    checked={includeIg}
                    onChange={(e) => { setIncludeIg(e.target.checked); setSaveError(""); }}
                  />
                  Incluir Instagram de esta Página
                </label>

                {includeIg && (
                  <div className="space-y-1">
                    <label htmlFor="metadm-igBusinessId" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {IG_LABEL}
                    </label>
                    <input
                      id="metadm-igBusinessId"
                      className="form-input w-full font-mono"
                      autoComplete="off"
                      spellCheck={false}
                      value={values.igBusinessId ?? ""}
                      onChange={(e) => setField("igBusinessId", e.target.value)}
                      placeholder={lookup ? "" : "Se llena solo al probar la conexión"}
                    />
                    {!lookup ? (
                      <p className="text-[10px] text-muted-foreground">
                        Al probar la conexión lo tomamos de la Página. También puedes escribirlo.
                      </p>
                    ) : linked ? (
                      igValue === linked.id ? (
                        <p className="text-[11px] text-green-700">
                          Cuenta vinculada a la Página: {linked.username ? `@${linked.username}` : linked.id}
                        </p>
                      ) : (
                        <p className="text-[11px] text-destructive">
                          No coincide con la cuenta vinculada a la Página
                          ({linked.username ? `@${linked.username} · ` : ""}{linked.id}): al guardar se rechazará.
                        </p>
                      )
                    ) : lookup.instagramError ? (
                      <p className="text-[11px] text-destructive">
                        {lookup.instagramError} · Puedes escribir el ID a mano.
                      </p>
                    ) : (
                      <p className="text-[11px] text-destructive">
                        Esta Página no tiene una cuenta de Instagram Business vinculada. Desmarca «Incluir
                        Instagram» para crear solo Messenger, o vincúlala en Meta y vuelve a probar.
                      </p>
                    )}
                  </div>
                )}

                {msg && <p className={`text-[12px] ${testState === "ok" ? "text-green-700" : "text-destructive"}`}>{msg}</p>}
                {saveError && <p role="alert" className="text-[12px] text-destructive">{saveError}</p>}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button className="btn-secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>← Atrás</button>
              {!isLast ? (
                <button className="btn-primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>Siguiente →</button>
              ) : testState !== "ok" ? (
                <button className="btn-primary" onClick={probar} disabled={testState === "testing"}>
                  {testState === "testing" ? "Probando…" : "Probar conexión"}
                </button>
              ) : (
                <button
                  className="btn-primary"
                  onClick={guardar}
                  disabled={saving || !hasName || (includeIg && !igValue)}
                >
                  {saving ? "Guardando…" : includeIg ? "Guardar las dos y activar" : "Guardar y activar"}
                </button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
