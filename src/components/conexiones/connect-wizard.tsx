"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { providerById } from "@/lib/connectors/registry";

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
  const [creds, setCreds] = useState<Record<string, string>>({});
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
    const create = await fetch("/api/admin/connectors", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || def!.label, provider, credentials: creds }),
    });
    if (!create.ok) { setMsg("Error al guardar"); return; }
    const { data } = await create.json();
    await fetch(`/api/admin/connectors/${data.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    reset(); onConnected(); onOpenChange(false);
  }

  function reset() { setStep(0); setName(""); setCreds({}); setTestState("idle"); setMsg(""); }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar cuenta · {def.label}</DialogTitle>
        </DialogHeader>

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
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Nombre de la cuenta</label>
              <input className="form-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={def.label} />
            </div>
            {def.credFields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</label>
                <input
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
      </DialogContent>
    </Dialog>
  );
}
