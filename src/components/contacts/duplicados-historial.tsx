"use client";

// "Marcadas como no duplicado" y "Fusiones recientes", con su deshacer (E7 #977).
import { useCallback, useEffect, useState } from "react";
import { leerError } from "@/lib/api-errors";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";

interface Revisado {
  key: string;
  contacts: Array<{ id: string; firstName: string; lastName: string; email: string | null; phone: string }>;
}
interface Fusion {
  id: string;
  fecha: string;
  survivorNombre: string;
  loserNombre: string;
  deshechaEn: string | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });

/** `version` cambia cuando la lista principal se recarga (fusión nueva, marca nueva). */
export function DuplicadosHistorial({ version, onCambio }: { version: number; onCambio: () => void }) {
  const confirmar = useConfirm();
  const [revisados, setRevisados] = useState<Revisado[]>([]);
  const [fusiones, setFusiones] = useState<Fusion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/api/contacts/duplicates/revisados"), fetch("/api/contacts/fusiones")]);
    if (a.ok) setRevisados(((await a.json().catch(() => ({}))).data as Revisado[]) ?? []);
    if (b.ok) setFusiones(((await b.json().catch(() => ({}))).data as Fusion[]) ?? []);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, version]);

  async function volverARevisar(r: Revisado) {
    setBusy(r.key);
    const res = await fetch("/api/contacts/duplicates/revisados", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: r.key }),
    });
    setBusy(null);
    if (!res.ok) {
      toast({ title: "No se pudo volver a revisar", description: await leerError(res), variant: "destructive" });
      return;
    }
    toast({ title: "El grupo volvió a la lista de duplicados" });
    onCambio();
    await cargar();
  }

  async function deshacer(f: Fusion) {
    const ok = await confirmar({
      titulo: "¿Deshacer esta fusión?",
      descripcion: `${f.loserNombre} se restaura como contacto aparte y recupera sus negocios, actividades y demás registros que pasaron a ${f.survivorNombre}. Lo que se haya agregado después a ${f.survivorNombre} no se toca.`,
      confirmar: "Deshacer fusión",
      peligroso: true,
    });
    if (!ok) return;
    setBusy(f.id);
    const res = await fetch("/api/contacts/fusiones/deshacer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: f.id }),
    });
    setBusy(null);
    if (!res.ok) {
      toast({ title: "No se pudo deshacer la fusión", description: await leerError(res), variant: "destructive" });
      return;
    }
    toast({ title: "Fusión deshecha", description: `${f.loserNombre} volvió a ser un contacto aparte` });
    onCambio();
    await cargar();
  }

  const borde = { borderColor: "var(--border-subtle)" };
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Marcadas como no duplicado ({revisados.length})</h2>
        {revisados.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-tertiary)]">Ninguna por ahora.</p>
        ) : (
          revisados.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-[13px]" style={borde}>
              <span className="text-[color:var(--text-secondary)]">
                {r.contacts.map((c) => `${c.firstName} ${c.lastName}`.trim() || c.email || c.phone).join(" · ")}
              </span>
              <button className="btn-secondary text-xs disabled:opacity-40" disabled={busy === r.key} onClick={() => volverARevisar(r)}>
                Volver a revisar
              </button>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Fusiones recientes</h2>
        {fusiones.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-tertiary)]">Aún no hay fusiones registradas. Solo se pueden deshacer las hechas desde esta versión.</p>
        ) : (
          fusiones.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-[13px]" style={borde}>
              <span className="text-[color:var(--text-secondary)]">
                <span className="font-medium text-[color:var(--text-primary)]">{f.loserNombre}</span> se unió a{" "}
                <span className="font-medium text-[color:var(--text-primary)]">{f.survivorNombre}</span>
                <span className="block text-[12px] text-[color:var(--text-tertiary)]">
                  {fmt(f.fecha)}
                  {f.deshechaEn ? ` · deshecha el ${fmt(f.deshechaEn)}` : ""}
                </span>
              </span>
              {!f.deshechaEn && (
                <button className="btn-secondary text-xs disabled:opacity-40" disabled={busy === f.id} onClick={() => deshacer(f)}>
                  Deshacer
                </button>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
