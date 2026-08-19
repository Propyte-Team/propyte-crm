// Probador en seco: qué regla ganaría y con qué textos. No llama a Graph.
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ConnectorOption } from "./comment-rule-dialog";

interface TestResult {
  match: { ruleName: string; phrase: string; publicText: string; dmText: string } | null;
  pausedMatch: { ruleName: string; phrase: string } | null;
  excluded: { ruleName: string; phrase: string; excludedBy: string } | null;
}

export function CommentRuleTester({ connectors }: { connectors: ConnectorOption[] }) {
  const [connectorId, setConnectorId] = useState(connectors[0]?.id ?? "");
  const [commentText, setCommentText] = useState("");
  const [usuario, setUsuario] = useState("");
  const [postId, setPostId] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!connectorId || !commentText.trim()) return;
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/comment-rules/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectorId,
        commentText,
        usuario: usuario.trim() || undefined,
        postId: postId.trim() || undefined,
      }),
    });
    setLoading(false);
    if (res.ok) {
      setResult(await res.json());
      return;
    }
    setResult(null);
    const data = await res.json().catch(() => ({}));
    setError(typeof data.error === "string" ? data.error : "No se pudo probar la regla");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Probar una regla</CardTitle>
        <CardDescription>
          Escribe un comentario de ejemplo y mira qué pasaría. No publica nada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Cuenta</Label>
            <Select value={connectorId} onValueChange={setConnectorId}>
              <SelectTrigger><SelectValue placeholder="Cuenta" /></SelectTrigger>
              <SelectContent>
                {connectors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Usuario (opcional)</Label>
            <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="luisf" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Comentario</Label>
          <Input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="mándame info porfa" />
        </div>
        <div className="space-y-1.5">
          <Label>ID de publicación (opcional, para probar el filtro)</Label>
          <Input value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="MEDIA-1" />
        </div>
        <Button size="sm" onClick={run} disabled={loading || !commentText.trim() || !connectorId}>
          {loading ? "Probando…" : "Probar"}
        </Button>

        {error && <p className="text-[12px] text-destructive">{error}</p>}

        {result && (
          <div className="rounded-md border p-3 text-sm space-y-2" style={{ borderColor: "var(--border-default)" }}>
            {result.match ? (
              <>
                <p><span className="font-medium">Regla:</span> {result.match.ruleName} (frase &quot;{result.match.phrase}&quot;)</p>
                <p><span className="font-medium">Respuesta pública:</span> {result.match.publicText}</p>
                <p><span className="font-medium">DM:</span> {result.match.dmText}</p>
              </>
            ) : result.excluded ? (
              <p className="text-muted-foreground">
                La regla <strong>{result.excluded.ruleName}</strong> coincidió con
                &quot;{result.excluded.phrase}&quot; pero la descartó su negativa{" "}
                <strong>&quot;{result.excluded.excludedBy}&quot;</strong>. No se contestaría nada.
              </p>
            ) : result.pausedMatch ? (
              <p className="text-muted-foreground">
                Ninguna regla activa coincide, pero la regla <strong>en pausa</strong>{" "}
                &quot;{result.pausedMatch.ruleName}&quot; habría disparado con &quot;{result.pausedMatch.phrase}&quot;.
              </p>
            ) : (
              <p className="text-muted-foreground">Ninguna regla coincide con ese comentario.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
