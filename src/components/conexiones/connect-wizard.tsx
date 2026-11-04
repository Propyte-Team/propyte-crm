"use client";

import { useState } from "react";
import { mensajeDeError } from "@/lib/api-errors";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { providerById, splitConnectorFields } from "@/lib/connectors/registry";
import { generarVerifyToken, urlDeWebhook } from "@/lib/connectors/verify-token";
import { toast } from "@/components/ui/use-toast";
import { BrandSelect, useBrandOptions } from "./brand-select";

// Solo Facebook Lead Ads: su webhook compara el verify_token contra el de cada cuenta. El de los
// mensajes directos (IG/Messenger) es uno global del servidor, así que ahí no se genera.
const PROVEEDOR_CON_TOKEN_GENERADO = "META";

function copiar(texto: string) {
  navigator.clipboard?.writeText(texto).then(
    () => toast({ title: "Copiado" }),
    () => toast({ title: "No se pudo copiar", variant: "destructive" }),
  );
}

function CampoCopiable({ id, etiqueta, valor }: { id: string; etiqueta: string; valor: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[10px] uppercase tracking-wide text-muted-foreground">{etiqueta}</label>
      <div className="flex items-center gap-2">
        <input id={id} readOnly className="form-input w-full font-mono text-[12px]" value={valor} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn-secondary shrink-0 text-[12px]" onClick={() => copiar(valor)}>Copiar</button>
      </div>
    </div>
  );
}

export function ConnectWizard({
  provider, open, onOpenChange, onConnected,
}: {
  provider: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: () => void;
}) {
  const def = providerById(provider);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  // 2026-10-09: marca del agente de la cuenta. null = Predeterminada (igual que antes de las marcas).
  const [brandId, setBrandId] = useState<string | null>(null);
  const brands = useBrandOptions(open);
  // Facebook Lead Ads: el Verify Token se genera aquí (no se le pide a la persona) y se muestra al final.
  const generaToken = provider === PROVEEDOR_CON_TOKEN_GENERADO;
  const [creds, setCreds] = useState<Record<string, string>>((): Record<string, string> => (generaToken ? { verifyToken: generarVerifyToken() } : {}));
  // Pantalla «Pega esto en Meta» tras crear la cuenta.
  const [entrega, setEntrega] = useState<{ url: string; verifyToken: string } | null>(null);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState<string>("");

  if (!def) return null;
  const lastStep = def.wizardSteps.length - 1;
  const isLast = step === lastStep;

  async function probar() {
    setTestState("testing"); setMsg("");
    const res = await fetch("/api/admin/connectors/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, credentials: creds }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) { setTestState("ok"); setMsg(data.accountName ? `Conectado: ${data.accountName}` : "Conexión válida"); }
    else { setTestState("fail"); setMsg(data.detail ?? "No se pudo validar"); }
  }

  async function guardar() {
    setMsg("");
    const defLabel = def!.label;
    const { config, credentials } = splitConnectorFields(provider, creds);
    const create = await fetch("/api/admin/connectors", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || defLabel, provider, credentials, config, brandId }),
    });
    const created = await create.json().catch(() => null);
    if (!create.ok || !created?.data?.id) {
      setTestState("fail"); setMsg(mensajeDeError(created, "No se pudo guardar la cuenta"));
      return;
    }
    const patch = await fetch(`/api/admin/connectors/${created.data.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    if (!patch.ok) {
      setTestState("fail");
      setMsg("Cuenta creada, pero no se pudo activar. Actívala desde la lista.");
      onConnected();
      return;
    }
    onConnected();
    if (generaToken && def!.webhookPath && creds.verifyToken) {
      // No se cierra: primero hay que llevarse la URL y el token a Meta.
      setEntrega({ url: urlDeWebhook(window.location.origin, def!.webhookPath), verifyToken: creds.verifyToken });
      return;
    }
    reset(); onOpenChange(false);
  }

  function reset() {
    setStep(0); setName(""); setBrandId(null);
    setCreds(generaToken ? { verifyToken: generarVerifyToken() } : {});
    setTestState("idle"); setMsg(""); setEntrega(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar cuenta · {def.label}</DialogTitle>
        </DialogHeader>

        {entrega ? (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Pega esto en Meta</h4>
            <p className="text-[12px] text-muted-foreground">
              La cuenta ya quedó guardada y activa. Para que Meta mande los prospectos, en tu app de Meta abre
              Webhooks, agrega la suscripción de la Página y pega estos dos datos.
            </p>
            <CampoCopiable id="entrega-url" etiqueta="URL del webhook" valor={entrega.url} />
            <CampoCopiable id="entrega-token" etiqueta="Verify Token" valor={entrega.verifyToken} />
            <p className="text-[10px] text-muted-foreground">
              El Verify Token queda guardado cifrado y no se vuelve a mostrar. Si lo necesitas de nuevo, vuelve a conectar la cuenta.
            </p>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => { reset(); onOpenChange(false); }}>Listo</button>
            </div>
          </div>
        ) : (<>
        <div className="text-[11px] font-mono text-muted-foreground">{step + 1}/{def.wizardSteps.length}</div>
        <div className="mt-1">
          <h4 className="text-sm font-semibold">{def.wizardSteps[step].title}</h4>
          <p className="mt-1 text-[12px] text-muted-foreground">{def.wizardSteps[step].body}</p>
          {def.wizardSteps[step].link && (
            <a href={def.wizardSteps[step].link} target="_blank" rel="noreferrer" className="text-[12px] underline">
              Abrir →
            </a>
          )}
        </div>

        {isLast && (
          <div className="mt-3 space-y-2">
            <div className="space-y-1">
              <label htmlFor="conn-name" className="text-[10px] uppercase tracking-wide text-muted-foreground">Nombre de la cuenta</label>
              <input id="conn-name" className="form-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={def.label} />
            </div>
            <BrandSelect id="conn-brand" value={brandId} onChange={setBrandId} brands={brands} />
            {def.credFields.filter((f) => !(generaToken && f.key === "verifyToken")).map((f) => (
              <div key={f.key} className="space-y-1">
                <label htmlFor={`cred-${f.key}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</label>
                <input
                  id={`cred-${f.key}`}
                  className="form-input w-full"
                  type={f.secret ? "password" : "text"}
                  value={creds[f.key] ?? ""}
                  onChange={(e) => { setCreds({ ...creds, [f.key]: e.target.value }); setTestState("idle"); }}
                />
                {f.help && <p className="text-[10px] text-muted-foreground">{f.help}</p>}
              </div>
            ))}
            {msg && <p className={`text-[12px] ${testState === "ok" ? "text-green-700" : "text-destructive"}`}>{msg}</p>}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button className="btn-secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>← Atrás</button>
          {!isLast ? (
            <button className="btn-primary" onClick={() => setStep((s) => Math.min(lastStep, s + 1))}>Siguiente →</button>
          ) : testState !== "ok" ? (
            <button className="btn-primary" onClick={probar} disabled={testState === "testing"}>
              {testState === "testing" ? "Probando…" : "Probar conexión"}
            </button>
          ) : (
            <button className="btn-primary" onClick={guardar}>Guardar y activar</button>
          )}
        </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
