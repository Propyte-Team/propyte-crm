// Diagnóstico de las cuentas: credenciales + suscripción al webhook.
//
// Contesta la pregunta que antes no se podía contestar sin entrar al panel de
// Meta: "las reglas están bien, ¿por qué no dispara ninguna?". Si la Página no
// tiene suscrito `feed`, Meta nunca nos manda el comentario y el silencio es
// completo — ni error, ni log, ni pista.
//
// La consulta a Meta va detrás del botón, no en la carga: son N llamadas a
// Graph y esta pestaña se abre para editar reglas, no para diagnosticar.
//
// 2026-10-10: si a la Página le faltan campos, "Suscribir página" los agrega
// desde aquí (antes había que hacerlo a mano en Meta con un token).
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Stethoscope, PlugZap } from "lucide-react";

interface HealthRow {
  id: string;
  name: string;
  provider: "INSTAGRAM" | "MESSENGER";
  status: string;
  ok: boolean;
  missing: string[];
  webhook?: {
    subscribedFields: string[];
    missingForComments: string[];
    missingPageFields: string[];
    error: string | null;
  };
}

export function CommentAccountsHealth() {
  const [rows, setRows] = useState<HealthRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [subscribeMsg, setSubscribeMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function subscribe(id: string) {
    setSubscribing(id);
    const res = await fetch(`/api/admin/connectors/${id}/subscribe`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSubscribing(null);
    setSubscribeMsg((m) => ({
      ...m,
      [id]: res.ok
        ? { ok: true, text: `Suscrita a: ${(body.data?.subscribedFields ?? []).join(", ")}` }
        : { ok: false, text: body.error ?? "No se pudo suscribir" },
    }));
    if (res.ok) await run();
  }

  async function run() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/connectors/health?probe=1");
    setLoading(false);
    if (!res.ok) {
      setRows(null);
      setError(
        res.status === 403
          ? "Tu rol no puede consultar el diagnóstico"
          : "No se pudo consultar el diagnóstico"
      );
      return;
    }
    setRows((await res.json()).data ?? []);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Diagnóstico de cuentas</CardTitle>
          <CardDescription>
            Si una regla no dispara nunca, empieza aquí: revisa que la cuenta tenga
            credenciales y que Meta nos esté mandando los comentarios.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading}>
          <Stethoscope className="mr-1 h-4 w-4" />
          {loading ? "Revisando…" : "Revisar"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        {!error && rows === null && (
          <p className="py-2 text-[12px] text-muted-foreground">
            Sin revisar. El botón consulta a Meta en ese momento.
          </p>
        )}
        {rows?.length === 0 && (
          <p className="py-2 text-[12px] text-muted-foreground">
            No hay cuentas de Instagram ni Messenger configuradas.
          </p>
        )}
        {rows?.map((r) => {
          const sinComentarios = (r.webhook?.missingForComments ?? []).length > 0;
          const faltanCampos = r.webhook?.missingPageFields ?? [];
          const grave = !r.ok || sinComentarios || faltanCampos.length > 0 || !!r.webhook?.error;
          const msg = subscribeMsg[r.id];
          return (
            <div
              key={r.id}
              className="rounded-lg border p-3"
              style={{ borderColor: "var(--border-default)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                {grave ? (
                  <AlertTriangle className="h-4 w-4 text-[color:var(--color-warning)]" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-[color:var(--color-success)]" />
                )}
                <span className="text-[13px] font-semibold">{r.name}</span>
                <span className="badge badge-neutral">
                  {r.provider === "INSTAGRAM" ? "Instagram" : "Facebook"}
                </span>
                <span className={`badge ${r.status === "ACTIVE" ? "badge-success" : "badge-neutral"}`}>
                  {r.status}
                </span>
                {faltanCampos.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => subscribe(r.id)}
                    disabled={subscribing !== null}
                  >
                    <PlugZap className="mr-1 h-4 w-4" />
                    {subscribing === r.id ? "Suscribiendo…" : "Suscribir página"}
                  </Button>
                )}
              </div>

              {faltanCampos.length > 0 && (
                <p className="mt-1 text-[12px] text-destructive">
                  A la Página le falta <code>{faltanCampos.join(", ")}</code>: Meta no nos manda esos
                  eventos. «Suscribir página» los agrega sin quitar lo que ya tiene.
                </p>
              )}

              {msg && (
                <p className={`mt-1 text-[12px] ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}>
                  {msg.text}
                </p>
              )}

              {!r.ok && (
                <p className="mt-1 text-[12px] text-destructive">
                  Falta configurar: {r.missing.join(", ")}
                </p>
              )}

              {r.webhook?.error && (
                <p className="mt-1 text-[12px] text-destructive">
                  Meta respondió: {r.webhook.error}
                </p>
              )}

              {sinComentarios && (
                <p className="mt-1 text-[12px] text-destructive">
                  La Página no tiene suscrito{" "}
                  <code>{r.webhook?.missingForComments.join(", ")}</code>: sus comentarios NO
                  llegan al CRM y ninguna regla puede dispararse.
                </p>
              )}

              {r.webhook && !r.webhook.error && !sinComentarios && r.provider === "MESSENGER" && (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Recibe comentarios de la Página. Suscrito a:{" "}
                  {r.webhook.subscribedFields.join(", ") || "—"}
                </p>
              )}

              {r.webhook && !r.webhook.error && r.provider === "INSTAGRAM" && (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Página vinculada suscrita a: {r.webhook.subscribedFields.join(", ") || "—"}.
                  Los comentarios de Instagram no vienen por aquí: se habilitan a nivel de
                  aplicación en Meta (objeto <code>instagram</code>, campo{" "}
                  <code>comments</code>) y eso no se puede leer con el token de la Página.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
