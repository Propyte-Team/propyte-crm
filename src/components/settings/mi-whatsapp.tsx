"use client";

// «Mi WhatsApp» en Mi Perfil (2026-10-14, coexistencia PR 2): conectar el WhatsApp Business propio
// y decidir sobre los «posibles prospectos». Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §7.
//
// Lo que se le explica al asesor, porque decide qué entra al CRM (decisión 1 del dueño): de su
// número solo se guardan los chats de contactos que ya están en el CRM. Quien no lo está aparece
// aquí con nombre de perfil y cuántas veces escribió —nunca qué escribió—, y él decide «Es
// prospecto» (desde ese momento se guardan sus mensajes) o «Ignorar».
import { useCallback, useEffect, useState } from "react";
import { WhatsAppCoexConnect } from "@/components/conexiones/whatsapp-coex-connect";
import type { EmbeddedSignupAvailability } from "@/lib/whatsapp/coex/public-config";
import type { CoexStatus } from "@/lib/whatsapp/coex/status";
import { formatDate } from "@/lib/format-date";

interface MyConnector {
  id: string;
  name: string;
  status: string;
  lastError: string | null;
  displayPhone: string | null;
  verifiedName: string | null;
  coex: CoexStatus | null;
}
interface Pending {
  id: string;
  phone: string | null;
  waUserId: string | null;
  profileName: string | null;
  contactName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  messageCount: number;
}

export function MiWhatsApp({ availability }: { availability: EmbeddedSignupAvailability }) {
  const [connectors, setConnectors] = useState<MyConnector[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me/whatsapp");
      if (!res.ok) {
        setError("No se pudo cargar tu WhatsApp.");
        return;
      }
      const data = (await res.json()).data ?? {};
      setConnectors(Array.isArray(data.connectors) ? data.connectors : []);
      setPending(Array.isArray(data.pending) ? data.pending : []);
      setError(null);
    } catch {
      setError("Error de red al cargar tu WhatsApp.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (p: Pending, action: "prospecto" | "ignorar") => {
      setBusy(p.id);
      setNotice(null);
      try {
        const res = await fetch(`/api/me/whatsapp/posibles-prospectos/${p.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setNotice(typeof data.error === "string" ? data.error : "No se pudo guardar.");
          return;
        }
        setPending((list) => list.filter((x) => x.id !== p.id));
        setNotice(
          action === "prospecto"
            ? `${p.profileName || p.phone || "El contacto"} ya es prospecto y está asignado a ti. Sus mensajes nuevos se guardan en el CRM.`
            : "Listo: no se volverá a listar.",
        );
      } catch {
        setNotice("Error de red. Vuelve a intentarlo.");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const connected = (connectors ?? []).length > 0;

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Mi WhatsApp</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Conecta tu WhatsApp Business al CRM y sigue usándolo en el teléfono. Solo se guardan los chats de contactos del CRM;
        tus chats personales no entran. El agente automático nunca contesta en tu número: solo tú, desde el teléfono o
        desde la bandeja.
      </p>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {(connectors ?? []).map((c) => (
        <div key={c.id} className="mt-3 rounded-md border p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.displayPhone || c.name}</span>
            {c.verifiedName && <span className="text-muted-foreground">({c.verifiedName})</span>}
            {c.coex && <span className="rounded-full border px-2 text-xs">{c.coex.label}</span>}
          </div>
          {c.coex?.detail && <p className="mt-1 text-xs text-muted-foreground">{c.coex.detail}</p>}
          {c.lastError && <p className="mt-1 text-xs text-destructive">{c.lastError}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Para desconectarlo: en la app de WhatsApp Business, Configuración → Cuenta → Plataforma para empresas → Desconectar.
          </p>
        </div>
      ))}

      {connectors !== null && (
        <WhatsAppCoexConnect
          availability={availability}
          endpoint="/api/me/whatsapp"
          buttonLabel={connected ? "Volver a conectar mi WhatsApp" : "Conectar mi WhatsApp"}
          description="Necesitas WhatsApp Business (versión 2.24.17 o más nueva) en tu teléfono. Se importa el historial (hasta 6 meses) solo de contactos que ya están en el CRM."
          onConnected={() => void load()}
        />
      )}

      {connected && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">Posibles prospectos</h3>
          <p className="text-xs text-muted-foreground">
            Personas que no están en el CRM y te escribieron. No se guardó lo que escribieron. Solo tú las ves.
          </p>
          {notice && (
            <p role="status" className="mt-1 text-xs">
              {notice}
            </p>
          )}
          {pending.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Nadie pendiente.</p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border text-sm">
              {pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <span className="min-w-0">
                    <span className="font-medium">{p.contactName || p.profileName || "Sin nombre"}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">{p.phone ?? "sin teléfono"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.messageCount} {p.messageCount === 1 ? "mensaje" : "mensajes"} · primero {formatDate(p.firstSeenAt)} · último{" "}
                      {formatDate(p.lastSeenAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-3">
                    <button
                      type="button"
                      className="text-xs underline disabled:opacity-50"
                      disabled={busy === p.id}
                      onClick={() => void act(p, "prospecto")}
                    >
                      Es prospecto
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline disabled:opacity-50"
                      disabled={busy === p.id}
                      onClick={() => void act(p, "ignorar")}
                    >
                      Ignorar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
