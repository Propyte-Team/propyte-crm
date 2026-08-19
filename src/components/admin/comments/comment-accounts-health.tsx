// Diagnóstico de las cuentas: credenciales + suscripción al webhook.
//
// Contesta la pregunta que antes no se podía contestar sin entrar al panel de
// Meta: "las reglas están bien, ¿por qué no dispara ninguna?". Si la Página no
// tiene suscrito `feed`, Meta nunca nos manda el comentario y el silencio es
// completo — ni error, ni log, ni pista.
//
// La consulta a Meta va detrás del botón, no en la carga: son N llamadas a
// Graph y esta pestaña se abre para editar reglas, no para diagnosticar.
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Stethoscope } from "lucide-react";

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
    error: string | null;
  };
}

export function CommentAccountsHealth() {
  const [rows, setRows] = useState<HealthRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
          const grave = !r.ok || sinComentarios || !!r.webhook?.error;
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
              </div>

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
                  llegan al CRM y ninguna regla puede dispararse. Se activa en el panel de la
                  app en Meta → Webhooks → objeto <code>page</code>.
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
